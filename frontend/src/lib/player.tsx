import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, API, ApiError, NetworkError } from './api';
import { artistNames, mediaUrl } from './format';
import { isOfflineMode, offlineUrl } from './offline';
import { flushPending, queueEvent } from './pending';
import type { Track } from './types';

export type QItem = { uid: string; track: Track };
export type Repeat = 'off' | 'all' | 'one';
export type PlayContext = { type: 'playlist' | 'album' | 'artist' | 'liked' | 'search' | 'radio' | 'track' | 'genre' | 'downloads' | 'queue'; id?: string; name?: string };

type PlayerState = {
  queue: QItem[];
  index: number;
  current: QItem | null;
  playing: boolean;
  loading: boolean;
  position: number; // ms
  duration: number; // ms
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
  autoRadio: boolean;
  context: PlayContext | null;
  offlineSource: boolean;
};
type PlayerApi = PlayerState & {
  playTracks: (tracks: Track[], start?: number, ctx?: PlayContext) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (ms: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setAutoRadio: (v: boolean) => void;
  addToQueue: (tracks: Track[]) => void;
  playNext: (tracks: Track[]) => void;
  removeFromQueue: (uid: string) => void;
  moveInQueue: (uid: string, toIndex: number) => void;
  clearUpcoming: () => void;
  jumpTo: (uid: string) => void;
  startRadio: (seedType: 'track' | 'artist' | 'genre', id: string | number, name?: string) => Promise<void>;
  patchTrack: (id: string, patch: Partial<Track>) => void;
  ytHost: React.RefObject<HTMLDivElement>;
  videoMode: boolean;
  setVideoMode: (v: boolean) => void;
};

const Ctx = createContext<PlayerApi>(null as unknown as PlayerApi);
export const usePlayer = () => useContext(Ctx);

let uidSeq = 0;
const mkItem = (track: Track): QItem => ({ uid: `${Date.now().toString(36)}-${++uidSeq}`, track });
const STORE = 'spx.player';

function shuffleArr<T>(a: T[]) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

// ----- YouTube IFrame API (player oficial incorporado) -----
let ytReady: Promise<any> | null = null;
function loadYT(): Promise<any> {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve, reject) => {
    const w = window as any;
    if (w.YT?.Player) return resolve(w.YT);
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(w.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      ytReady = null;
      reject(new Error('Não foi possível carregar o player do YouTube'));
    };
    document.head.appendChild(s);
  });
  return ytReady;
}

export function PlayerProvider({ children, onError }: { children: ReactNode; onError: (msg: string) => void }) {
  const saved = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(STORE) || 'null');
    } catch {
      return null;
    }
  }, []);
  const [queue, setQueue] = useState<QItem[]>(saved?.queue || []);
  const [index, setIndex] = useState<number>(saved?.index ?? -1);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState<number>(saved?.position || 0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolumeState] = useState<number>(saved?.volume ?? 0.9);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState<boolean>(!!saved?.shuffle);
  const [repeat, setRepeat] = useState<Repeat>(saved?.repeat || 'off');
  const [autoRadio, setAutoRadioState] = useState<boolean>(saved?.autoRadio ?? true);
  const [context, setContext] = useState<PlayContext | null>(saved?.context || null);
  const [offlineSource, setOfflineSource] = useState(false);
  const originalOrder = useRef<string[] | null>(saved?.originalOrder || null);

  const audio = useRef<HTMLAudioElement>(null as unknown as HTMLAudioElement);
  if (!audio.current) {
    audio.current = new Audio();
    audio.current.preload = 'auto';
  }
  const ytHost = useRef<HTMLDivElement>(null);
  const [videoMode, setVideoModeState] = useState(() => localStorage.getItem('spx:video-mode') === '1');
  const setVideoMode = useCallback((v: boolean) => {
    localStorage.setItem('spx:video-mode', v ? '1' : '0');
    setVideoModeState(v);
  }, []);
  const yt = useRef<any>(null);
  const engine = useRef<'audio' | 'yt' | null>(null);
  const loadSeq = useRef(0);
  const listened = useRef(0); // ms ouvidos da faixa atual
  const lastTick = useRef<number | null>(null);
  const blobUrl = useRef<string | null>(null);
  const resumeAt = useRef<number>(saved?.position || 0);
  const autoplay = useRef(false);

  const stateRef = useRef({ queue, index, repeat, autoRadio, context, shuffle });
  stateRef.current = { queue, index, repeat, autoRadio, context, shuffle };
  const current = index >= 0 && index < queue.length ? queue[index] : null;

  // ----- persistência da fila (restaurada ao abrir o app) -----
  useEffect(() => {
    const t = setTimeout(() => {
      localStorage.setItem(
        STORE,
        JSON.stringify({ queue: queue.slice(0, 1000), index, position, volume, shuffle, repeat, autoRadio, context, originalOrder: originalOrder.current })
      );
    }, 500);
    return () => clearTimeout(t);
  }, [queue, index, position, volume, shuffle, repeat, autoRadio, context]);

  // ----- eventos de escuta -----
  const report = useCallback((track: Track | undefined, event: 'end' | 'skip') => {
    if (!track) return;
    const ms = Math.round(listened.current);
    listened.current = 0;
    if (ms < 1000) return;
    const ctx = stateRef.current.context;
    queueEvent({
      track_id: track.id, event, ms_played: ms, context_type: ctx?.type, context_id: ctx?.id,
      played_at: new Date().toISOString(), offline: isOfflineMode(),
    });
    flushPending();
  }, []);

  const tick = useCallback((isPlaying: boolean) => {
    const now = performance.now();
    if (lastTick.current !== null && isPlaying) listened.current += Math.min(now - lastTick.current, 2000);
    lastTick.current = isPlaying ? now : null;
  }, []);

  const stopEngines = useCallback(() => {
    audio.current.pause();
    if (yt.current?.pauseVideo) {
      try {
        yt.current.stopVideo();
      } catch {
        /* */
      }
    }
    if (blobUrl.current) {
      URL.revokeObjectURL(blobUrl.current);
      blobUrl.current = null;
    }
  }, []);

  // ----- carregar a faixa atual -----
  const load = useCallback(
    async (item: QItem, play: boolean, startMs = 0) => {
      const seq = ++loadSeq.current;
      const t = item.track;
      listened.current = 0;
      lastTick.current = null;
      setPosition(startMs);
      setDuration(t.duration_ms);
      stopEngines();
      if (!t.playable) {
        onError(`"${t.title}" indisponível: ${t.unavailable_reason || ''}`);
        setPlaying(false);
        return;
      }
      setLoading(true);
      try {
        if (t.source === 'youtube') {
          if (isOfflineMode()) throw new Error('Faixas do YouTube só tocam com internet');
          engine.current = 'yt';
          setOfflineSource(false);
          const YT = await loadYT();
          if (seq !== loadSeq.current) return;
          if (!yt.current) {
            await new Promise<void>((resolve) => {
              const el = document.createElement('div');
              ytHost.current!.innerHTML = '';
              ytHost.current!.appendChild(el);
              yt.current = new YT.Player(el, {
                width: '100%',
                height: '100%',
                videoId: t.youtube_id,
                playerVars: { autoplay: play ? 1 : 0, playsinline: 1, rel: 0, start: Math.floor(startMs / 1000) },
                events: {
                  onReady: () => resolve(),
                  onStateChange: (e: any) => window.dispatchEvent(new CustomEvent('spx:yt-state', { detail: e.data })),
                  onError: () => window.dispatchEvent(new CustomEvent('spx:yt-state', { detail: 'error' })),
                },
              });
            });
            if (play) yt.current.playVideo();
          } else if (play) yt.current.loadVideoById({ videoId: t.youtube_id, startSeconds: startMs / 1000 });
          else yt.current.cueVideoById({ videoId: t.youtube_id, startSeconds: startMs / 1000 });
          setLoading(false);
          return;
        }
        engine.current = 'audio';
        let src: string | null = null;
        // prefere o arquivo baixado (economia de dados e funciona sem rede)
        try {
          src = await offlineUrl(t.id);
        } catch (e) {
          if (isOfflineMode()) throw e;
        }
        if (seq !== loadSeq.current) {
          if (src) URL.revokeObjectURL(src);
          return;
        }
        if (src) {
          blobUrl.current = src;
          setOfflineSource(true);
        } else {
          if (isOfflineMode()) throw new Error('Sem conexão: baixe a faixa para ouvir offline');
          const s = await api<{ url: string }>('playback/session', { body: { track_id: t.id, quality: 'high', context: stateRef.current.context } });
          if (seq !== loadSeq.current) return;
          src = `${API}${s.url}`;
          setOfflineSource(false);
        }
        const a = audio.current;
        a.src = src;
        a.volume = muted ? 0 : volume;
        if (startMs) a.currentTime = startMs / 1000;
        if (play) await a.play();
      } catch (e) {
        if (seq !== loadSeq.current) return;
        setPlaying(false);
        const msg = e instanceof ApiError || e instanceof NetworkError ? e.message : (e as Error).message || 'Falha ao tocar';
        if ((e as Error).name === 'NotAllowedError') return; // navegador bloqueou autoplay
        onError(msg);
        if (e instanceof ApiError && ['TRACK_UNAVAILABLE', 'EXPLICIT_BLOCKED'].includes(e.code)) {
          setTimeout(() => nextRef.current(true), 600);
        }
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopEngines, volume, muted, onError]
  );

  // ----- avançar -----
  const nextRef = useRef<(auto: boolean) => void>(() => {});
  const advance = useCallback(
    async (auto: boolean) => {
      const { queue: q, index: i, repeat: rep, autoRadio: radio } = stateRef.current;
      const cur = q[i];
      report(cur?.track, auto ? 'end' : 'skip');
      if (auto && rep === 'one' && cur) {
        load(cur, true);
        return;
      }
      if (i + 1 < q.length) {
        setIndex(i + 1);
        load(q[i + 1], true);
        return;
      }
      if (rep === 'all' && q.length) {
        setIndex(0);
        load(q[0], true);
        return;
      }
      if (radio && cur && !isOfflineMode()) {
        try {
          const exclude = q.slice(-200).map((x) => x.track.id).join(',');
          const r = await api<{ items: Track[] }>(`radio?seed_type=track&id=${cur.track.id}&limit=20&exclude=${exclude}`);
          if (r.items.length) {
            const items = r.items.map(mkItem);
            const nq = [...stateRef.current.queue, ...items];
            setQueue(nq);
            setIndex(i + 1);
            load(items[0], true);
            return;
          }
        } catch {
          /* sem rádio */
        }
      }
      setPlaying(false);
      setPosition(0);
      if (engine.current === 'audio') audio.current.currentTime = 0;
    },
    [load, report]
  );
  nextRef.current = advance;

  // ----- eventos do <audio> -----
  useEffect(() => {
    const a = audio.current;
    const onTime = () => {
      if (engine.current !== 'audio') return;
      setPosition(a.currentTime * 1000);
      tick(!a.paused);
    };
    const onPlay = () => {
      setPlaying(true);
      tick(true);
    };
    const onPause = () => {
      tick(false);
      if (engine.current === 'audio') setPlaying(false);
    };
    const onMeta = () => {
      if (Number.isFinite(a.duration)) setDuration(a.duration * 1000);
    };
    const onEnded = () => {
      tick(false);
      advance(true);
    };
    const onErr = () => {
      if (engine.current === 'audio' && a.src) {
        setPlaying(false);
        onError('Erro ao carregar o áudio');
      }
    };
    const onWait = () => setLoading(true);
    const onCan = () => setLoading(false);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onErr);
    a.addEventListener('waiting', onWait);
    a.addEventListener('canplay', onCan);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('error', onErr);
      a.removeEventListener('waiting', onWait);
      a.removeEventListener('canplay', onCan);
    };
  }, [advance, tick, onError]);

  // ----- eventos do YouTube -----
  useEffect(() => {
    const h = (e: Event) => {
      const s = (e as CustomEvent).detail;
      if (engine.current !== 'yt') return;
      if (s === 'error') {
        onError('O YouTube não permitiu tocar este vídeo');
        setPlaying(false);
        return;
      }
      if (s === 1) {
        setPlaying(true);
        setLoading(false);
        tick(true);
        const d = yt.current?.getDuration?.();
        const cur = stateRef.current.queue[stateRef.current.index]?.track;
        if (d && cur) {
          setDuration(d * 1000);
          if (!cur.duration_ms) queueEvent({ track_id: cur.id, event: 'duration', duration_ms: Math.round(d * 1000) });
        }
      } else if (s === 2) {
        tick(false);
        setPlaying(false);
      } else if (s === 3) setLoading(true);
      else if (s === 0) {
        tick(false);
        advance(true);
      }
    };
    window.addEventListener('spx:yt-state', h);
    const iv = setInterval(() => {
      if (engine.current === 'yt' && yt.current?.getCurrentTime) {
        setPosition(yt.current.getCurrentTime() * 1000);
        tick(yt.current.getPlayerState?.() === 1);
      }
    }, 500);
    return () => {
      window.removeEventListener('spx:yt-state', h);
      clearInterval(iv);
    };
  }, [advance, tick, onError]);

  // ----- controles -----
  const playTracks = useCallback(
    (tracks: Track[], start = 0, ctx?: PlayContext) => {
      const playable = tracks.filter((t) => t.playable);
      if (!playable.length) {
        onError('Nenhuma faixa disponível para tocar');
        return;
      }
      const startTrack = tracks[start]?.playable ? tracks[start] : playable[0];
      const cur = stateRef.current.queue[stateRef.current.index];
      if (cur) report(cur.track, 'skip');
      let items = playable.map(mkItem);
      let idx = items.findIndex((x) => x.track.id === startTrack.id);
      originalOrder.current = null;
      if (stateRef.current.shuffle) {
        originalOrder.current = items.map((x) => x.uid);
        const first = items[idx];
        items = [first, ...shuffleArr(items.filter((x) => x !== first))];
        idx = 0;
      }
      setQueue(items);
      setIndex(idx);
      setContext(ctx || null);
      autoplay.current = true;
      load(items[idx], true);
    },
    [load, report, onError]
  );

  const toggle = useCallback(() => {
    if (!current) return;
    if (engine.current === null) {
      load(current, true, resumeAt.current);
      resumeAt.current = 0;
      return;
    }
    if (engine.current === 'yt') {
      if (playing) yt.current?.pauseVideo();
      else yt.current?.playVideo();
      return;
    }
    const a = audio.current;
    if (!a.src) {
      load(current, true, position);
      return;
    }
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }, [current, playing, position, load]);

  const prev = useCallback(() => {
    const { queue: q, index: i } = stateRef.current;
    if (position > 3000 || i <= 0) {
      if (engine.current === 'yt') yt.current?.seekTo(0, true);
      else if (engine.current === 'audio') audio.current.currentTime = 0;
      else if (q[i]) load(q[i], true);
      return;
    }
    report(q[i]?.track, 'skip');
    setIndex(i - 1);
    load(q[i - 1], true);
  }, [position, load, report]);

  const seek = useCallback((ms: number) => {
    setPosition(ms);
    if (engine.current === 'yt') yt.current?.seekTo(ms / 1000, true);
    else if (engine.current === 'audio') audio.current.currentTime = ms / 1000;
    else resumeAt.current = ms;
  }, []);

  const setVolume = useCallback((v: number) => {
    const vol = Math.max(0, Math.min(1, v));
    setVolumeState(vol);
    setMuted(false);
    audio.current.volume = vol;
    yt.current?.setVolume?.(Math.round(vol * 100));
    yt.current?.unMute?.();
  }, []);
  const toggleMute = useCallback(() => {
    setMuted((m) => {
      audio.current.volume = !m ? 0 : volume;
      if (!m) yt.current?.mute?.();
      else yt.current?.unMute?.();
      return !m;
    });
  }, [volume]);

  const toggleShuffle = useCallback(() => {
    const { queue: q, index: i, shuffle: sh } = stateRef.current;
    const done = q.slice(0, i + 1);
    const upcoming = q.slice(i + 1);
    if (!sh) {
      originalOrder.current = q.map((x) => x.uid);
      setQueue([...done, ...shuffleArr(upcoming)]);
    } else if (originalOrder.current) {
      const pos = new Map(originalOrder.current.map((u, k) => [u, k]));
      setQueue([...done, ...[...upcoming].sort((a, b) => (pos.get(a.uid) ?? 1e9) - (pos.get(b.uid) ?? 1e9))]);
      originalOrder.current = null;
    }
    setShuffle(!sh);
  }, []);
  const cycleRepeat = useCallback(() => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')), []);

  const addToQueue = useCallback((tracks: Track[]) => {
    const items = tracks.filter((t) => t.playable).map(mkItem);
    setQueue((q) => [...q, ...items]);
    if (stateRef.current.index < 0 && items.length) setIndex(0);
  }, []);
  const playNext = useCallback((tracks: Track[]) => {
    const items = tracks.filter((t) => t.playable).map(mkItem);
    setQueue((q) => {
      const i = stateRef.current.index;
      return [...q.slice(0, i + 1), ...items, ...q.slice(i + 1)];
    });
    if (stateRef.current.index < 0 && items.length) setIndex(0);
  }, []);
  const removeFromQueue = useCallback((uid: string) => {
    const { queue: q, index: i } = stateRef.current;
    const k = q.findIndex((x) => x.uid === uid);
    if (k < 0 || k === i) return;
    setQueue(q.filter((x) => x.uid !== uid));
    if (k < i) setIndex(i - 1);
  }, []);
  const moveInQueue = useCallback((uid: string, to: number) => {
    const { queue: q, index: i } = stateRef.current;
    const from = q.findIndex((x) => x.uid === uid);
    if (from < 0) return;
    const nq = [...q];
    const [it] = nq.splice(from, 1);
    nq.splice(to, 0, it);
    setQueue(nq);
    const curUid = q[i]?.uid;
    setIndex(nq.findIndex((x) => x.uid === curUid));
  }, []);
  const clearUpcoming = useCallback(() => {
    const { queue: q, index: i } = stateRef.current;
    setQueue(q.slice(0, i + 1));
  }, []);
  const jumpTo = useCallback(
    (uid: string) => {
      const { queue: q, index: i } = stateRef.current;
      const k = q.findIndex((x) => x.uid === uid);
      if (k < 0) return;
      report(q[i]?.track, 'skip');
      setIndex(k);
      load(q[k], true);
    },
    [load, report]
  );
  const startRadio = useCallback(
    async (seedType: 'track' | 'artist' | 'genre', id: string | number, name?: string) => {
      try {
        const r = await api<{ items: Track[] }>(`radio?seed_type=${seedType}&id=${id}&limit=40`);
        if (!r.items.length) return onError('Ainda não há músicas suficientes para o rádio');
        playTracks(r.items, 0, { type: 'radio', id: String(id), name: name ? `Rádio ${name}` : 'Rádio' });
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Falha ao iniciar o rádio');
      }
    },
    [playTracks, onError]
  );
  const patchTrack = useCallback((id: string, patch: Partial<Track>) => {
    setQueue((q) => (q.some((x) => x.track.id === id) ? q.map((x) => (x.track.id === id ? { ...x, track: { ...x.track, ...patch } } : x)) : q));
  }, []);

  // ----- Media Session: tela de bloqueio, notificação e fones Bluetooth -----
  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return;
    const t = current.track;
    const art = mediaUrl(t.cover_url);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: artistNames(t.artists),
      album: t.album?.title || '',
      artwork: art ? [{ src: new URL(art, location.href).href, sizes: '512x512' }] : [{ src: new URL(`${import.meta.env.BASE_URL}icon-512.png`, location.href).href, sizes: '512x512', type: 'image/png' }],
    });
  }, [current]);
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.playbackState = playing ? 'playing' : 'paused';
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(a, h);
      } catch {
        /* não suportado */
      }
    };
    set('play', () => toggle());
    set('pause', () => toggle());
    set('nexttrack', () => advance(false));
    set('previoustrack', () => prev());
    set('seekto', (d) => d.seekTime !== undefined && seek(d.seekTime * 1000));
    set('seekbackward', () => seek(Math.max(0, position - 10000)));
    set('seekforward', () => seek(Math.min(duration, position + 10000)));
  }, [playing, toggle, advance, prev, seek, position, duration]);
  useEffect(() => {
    if (!('mediaSession' in navigator) || !duration || !navigator.mediaSession.setPositionState) return;
    try {
      navigator.mediaSession.setPositionState({ duration: duration / 1000, position: Math.min(position, duration) / 1000, playbackRate: 1 });
    } catch {
      /* */
    }
  }, [position, duration]);

  // envia contagens pendentes ao fechar a aba
  useEffect(() => {
    const h = () => {
      const cur = stateRef.current.queue[stateRef.current.index];
      if (cur && listened.current > 1000) report(cur.track, 'skip');
    };
    window.addEventListener('pagehide', h);
    return () => window.removeEventListener('pagehide', h);
  }, [report]);

  const value: PlayerApi = {
    queue, index, current, playing, loading, position, duration: duration || current?.track.duration_ms || 0, volume, muted, shuffle, repeat,
    autoRadio, context, offlineSource,
    playTracks, toggle, next: () => advance(false), prev, seek, setVolume, toggleMute, toggleShuffle, cycleRepeat,
    setAutoRadio: setAutoRadioState, addToQueue, playNext, removeFromQueue, moveInQueue, clearUpcoming, jumpTo, startRadio, patchTrack, ytHost, videoMode, setVideoMode,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
