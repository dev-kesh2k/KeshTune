import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DndContext, PointerSensor, TouchSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown, GripVertical, Heart, ListMusic, Loader2, MicVocal, MoreHorizontal, Pause, Play, Radio, Repeat, Repeat1, Shuffle,
  SkipBack, SkipForward, Volume1, Volume2, VolumeX, WifiOff, X, Youtube,
} from 'lucide-react';
import { api } from '../lib/api';
import { artistNames, fmtTime } from '../lib/format';
import { usePlayer, usePlayerPosition, type QItem } from '../lib/player';
import { DownloadButton, useUi } from './TrackActions';
import { Explicit } from './TrackList';
import { Cover, Sheet, Spinner, Toggle } from './ui';

export function ProgressBar({ compact }: { compact?: boolean }) {
  const p = usePlayer();
  const position = usePlayerPosition();
  const [drag, setDrag] = useState<number | null>(null);
  const dur = p.duration || 0;
  const val = drag ?? Math.min(position, dur);
  const pct = dur ? (val / dur) * 100 : 0;
  return (
    <div className="flex w-full min-w-0 items-center gap-2 text-[11px] tabular-nums text-muted">
      {!compact && <span className="w-10 shrink-0 text-right">{fmtTime(val)}</span>}
      <input
        type="range"
        className="range min-w-0 flex-1"
        min={0}
        max={dur || 1}
        step={1000}
        value={val}
        disabled={!dur}
        aria-label="Posição da música"
        style={{ ['--p' as string]: `${pct}%` }}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => {
          if (drag !== null) p.seek(drag);
          setDrag(null);
        }}
        onKeyUp={() => {
          if (drag !== null) p.seek(drag);
          setDrag(null);
        }}
        onTouchEnd={() => {
          if (drag !== null) p.seek(drag);
          setDrag(null);
        }}
      />
      {!compact && <span className="w-10 shrink-0">{fmtTime(dur)}</span>}
    </div>
  );
}

export function VolumeControl() {
  const p = usePlayer();
  const v = p.muted ? 0 : p.volume;
  const Icon = v === 0 ? VolumeX : v < 0.5 ? Volume1 : Volume2;
  return (
    <div className="flex items-center gap-1">
      <button className="icon-btn" aria-label={p.muted ? 'Ativar som' : 'Silenciar'} onClick={p.toggleMute}>
        <Icon className="h-5 w-5" />
      </button>
      <input
        type="range"
        className="range w-24 lg:w-28"
        min={0}
        max={1}
        step={0.01}
        value={v}
        aria-label="Volume"
        style={{ ['--p' as string]: `${v * 100}%` }}
        onChange={(e) => p.setVolume(Number(e.target.value))}
      />
    </div>
  );
}

export function MainControls({ big }: { big?: boolean }) {
  const p = usePlayer();
  const RepeatIcon = p.repeat === 'one' ? Repeat1 : Repeat;
  const sz = big ? 'h-7 w-7' : 'h-5 w-5';
  return (
    <div className={`flex items-center justify-center ${big ? 'gap-3 sm:gap-6' : 'gap-2'}`}>
      <button className={`icon-btn relative ${p.shuffle ? 'text-accent-soft' : ''}`} aria-label="Ordem aleatória" aria-pressed={p.shuffle} onClick={p.toggleShuffle}>
        <Shuffle className={big ? 'h-6 w-6' : 'h-[18px] w-[18px]'} />
        {p.shuffle && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-accent-soft" />}
      </button>
      <button className="icon-btn" aria-label="Anterior" onClick={p.prev} disabled={!p.current}>
        <SkipBack className={`${sz} fill-current`} />
      </button>
      <button
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-white text-black transition hover:scale-105 active:scale-95 disabled:opacity-40 ${big ? 'h-16 w-16' : 'h-10 w-10'}`}
        aria-label={p.playing ? 'Pausar' : 'Tocar'}
        disabled={!p.current}
        onClick={p.toggle}
      >
        {p.loading ? <Loader2 className={`${sz} animate-spin`} /> : p.playing ? <Pause className={`${sz} fill-current`} /> : <Play className={`${sz} translate-x-[1px] fill-current`} />}
      </button>
      <button className="icon-btn" aria-label="Próxima" onClick={p.next} disabled={!p.current}>
        <SkipForward className={`${sz} fill-current`} />
      </button>
      <button
        className={`icon-btn relative ${p.repeat !== 'off' ? 'text-accent-soft' : ''}`}
        aria-label={p.repeat === 'off' ? 'Repetir lista' : p.repeat === 'all' ? 'Repetir faixa' : 'Não repetir'}
        onClick={p.cycleRepeat}
      >
        <RepeatIcon className={big ? 'h-6 w-6' : 'h-[18px] w-[18px]'} />
        {p.repeat !== 'off' && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-accent-soft" />}
      </button>
    </div>
  );
}

function LikeButton({ big }: { big?: boolean }) {
  const p = usePlayer();
  const ui = useUi();
  if (!p.current) return null;
  const t = p.current.track;
  const liked = ui.isLiked(t);
  return (
    <button className={`icon-btn ${liked ? 'text-accent' : ''}`} aria-label={liked ? 'Remover das curtidas' : 'Curtir'} onClick={() => ui.toggleLike(t)}>
      <Heart className={`${big ? 'h-7 w-7' : 'h-5 w-5'} ${liked ? 'fill-accent' : ''}`} />
    </button>
  );
}

/** Barra do player no desktop. */
export function PlayerBar({ onOpenQueue, onOpenLyrics, onOpenNow }: { onOpenQueue: () => void; onOpenLyrics: () => void; onOpenNow: () => void }) {
  const p = usePlayer();
  const t = p.current?.track;
  return (
    <div className="hidden h-[84px] grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] items-center gap-4 border-t border-line bg-black px-4 lg:grid">
      <div className="flex min-w-0 items-center gap-3">
        {t ? (
          <>
            <button onClick={onOpenNow} aria-label="Abrir tela do player" className="shrink-0">
              <Cover url={t.cover_url} alt={t.title} className="h-14 w-14" />
            </button>
            <div className="min-w-0">
              <button onClick={onOpenNow} className="block max-w-full truncate text-left text-sm font-semibold hover:underline">
                {t.title}
              </button>
              <p className="flex items-center gap-1 truncate text-xs text-muted">
                {t.explicit && <Explicit />}
                {p.offlineSource && <WifiOff className="h-3 w-3 shrink-0 text-accent-soft" aria-label="Tocando do download" />}
                {t.artists.map((a, i) => (
                  <span key={a.id} className="truncate">
                    {i > 0 && ', '}
                    <Link to={`/artist/${a.id}`} className="hover:text-white hover:underline">{a.name}</Link>
                  </span>
                ))}
              </p>
            </div>
            <LikeButton />
            <DownloadButton track={t} />
          </>
        ) : (
          <p className="text-sm text-muted">Escolha uma música para tocar</p>
        )}
      </div>
      <div className="flex min-w-0 flex-col items-center gap-0.5">
        <MainControls />
        <div className="w-full max-w-xl">
          <ProgressBar />
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1">
        <button className="icon-btn" aria-label="Letra" disabled={!t?.has_lyrics} onClick={onOpenLyrics}>
          <MicVocal className="h-5 w-5" />
        </button>
        <button className="icon-btn" aria-label="Fila" onClick={onOpenQueue}>
          <ListMusic className="h-5 w-5" />
        </button>
        <div className="hidden xl:block">
          <VolumeControl />
        </div>
      </div>
    </div>
  );
}

/** Barrinha de progresso do mini player: só ela acompanha a posição (o resto do mini player não se redesenha). */
function MiniProgress({ duration }: { duration: number }) {
  const position = usePlayerPosition();
  const pct = duration ? Math.min(100, (position / duration) * 100) : 0;
  return (
    <div className="h-[3px] bg-white/15">
      <div className="h-full bg-white" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Mini player no celular (acima da barra inferior). */
export function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const p = usePlayer();
  const t = p.current?.track;
  if (!t) return null;
  return (
    <div className="mx-2 mb-1 overflow-hidden rounded-xl bg-[#2a2140] shadow-2xl lg:hidden">
      <div className="flex items-center gap-2 py-1.5 pl-1.5 pr-1">
        <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={onOpen} aria-label="Abrir tela do player">
          <Cover url={t.cover_url} alt={t.title} className="h-11 w-11 shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{t.title}</span>
            <span className="flex items-center gap-1 truncate text-xs text-white/70">
              {p.offlineSource && <WifiOff className="h-3 w-3 shrink-0" />}
              {t.source === 'youtube' && <Youtube className="h-3 w-3 shrink-0" />}
              <span className="truncate">{artistNames(t.artists)}</span>
            </span>
          </span>
        </button>
        <LikeButton />
        <DownloadButton track={t} className="max-[359px]:hidden" />
        <button className="icon-btn" aria-label={p.playing ? 'Pausar' : 'Tocar'} onClick={p.toggle}>
          {p.loading ? <Loader2 className="h-6 w-6 animate-spin" /> : p.playing ? <Pause className="h-6 w-6 fill-white" /> : <Play className="h-6 w-6 fill-white" />}
        </button>
      </div>
      <MiniProgress duration={p.duration} />
    </div>
  );
}

/** Tela cheia "tocando agora". */
export function NowPlaying({ open, onClose, onOpenQueue, onOpenLyrics }: { open: boolean; onClose: () => void; onOpenQueue: () => void; onOpenLyrics: () => void }) {
  const p = usePlayer();
  const ui = useUi();
  const t = p.current?.track;
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);

  // O player do YouTube vive no Layout; aqui só avisamos onde ele deve ficar (clipe grande ou janelinha sobre a capa)
  const slot = useRef<HTMLDivElement>(null);
  const isYT = t?.source === 'youtube';
  useEffect(() => {
    const el = slot.current;
    if (!open || !isYT || !el) return;
    const send = () => {
      const r = el.getBoundingClientRect();
      window.dispatchEvent(new CustomEvent('spx:video-slot', { detail: { top: r.top, left: r.left, width: r.width, height: r.height } }));
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    const scroller = el.closest('[role="dialog"]');
    scroller?.addEventListener('scroll', send);
    window.addEventListener('resize', send);
    return () => {
      ro.disconnect();
      scroller?.removeEventListener('scroll', send);
      window.removeEventListener('resize', send);
      window.dispatchEvent(new CustomEvent('spx:video-slot', { detail: null }));
    };
  }, [open, isYT, p.videoMode, t?.id]);

  if (!open || !t) return null;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-gradient-to-b from-[#3b2a6b] via-[#16121f] to-bg" role="dialog" aria-label="Tocando agora">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-[max(1.25rem,env(safe-area-inset-left))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <button className="icon-btn" aria-label="Fechar" onClick={onClose}>
            <ChevronDown className="h-7 w-7" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-[11px] uppercase tracking-widest text-white/60">{p.context?.type === 'radio' ? 'Rádio' : 'Tocando de'}</p>
            <p className="truncate text-sm font-semibold">{p.context?.name || (p.offlineSource ? 'Downloads' : 'Sua fila')}</p>
          </div>
          <button className="icon-btn" aria-label="Mais opções" onClick={() => ui.openTrackMenu(t)}>
            <MoreHorizontal className="h-6 w-6" />
          </button>
        </div>
        {t.source === 'youtube' && (
          <div className="mt-3 flex justify-center" role="group" aria-label="Modo de exibição">
            <div className="flex rounded-full bg-white/10 p-1">
              {([['audio', 'Música'], ['video', 'Clipe']] as const).map(([m, label]) => (
                <button
                  key={m}
                  className={`min-h-9 rounded-full px-4 text-sm font-semibold transition ${p.videoMode === m ? 'bg-white text-black' : 'text-white/80 hover:text-white'}`}
                  aria-pressed={p.videoMode === m}
                  onClick={() => p.setVideoMode(m)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-1 items-center justify-center py-6">
          {isYT && p.videoMode === 'video' ? (
            <div ref={slot} className="aspect-video w-full" aria-hidden /> /* o player do YouTube flutua sobre este espaço */
          ) : (
            <div className="relative w-full max-w-[min(100%,26rem,52dvh)]">
              {isYT && t.cover_url?.startsWith('https://i.ytimg.com/') ? (
                // A miniatura do YouTube (4:3) vem com faixas pretas embutidas: amplia para mostrar só a imagem
                <div className="aspect-square w-full overflow-hidden rounded-md bg-surface2 shadow-2xl">
                  <img src={t.cover_url} alt={t.title} className="h-full w-full scale-[1.34] object-cover" />
                </div>
              ) : (
                <Cover url={t.cover_url} alt={t.title} className="w-full shadow-2xl" />
              )}
              {/* Modo "Música": o player do YouTube continua tocando, invisível, atrás da capa */}
              {isYT && <div ref={slot} className="absolute inset-0" aria-hidden />}
            </div>
          )}
        </div>
        <div className="mb-3 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate text-[clamp(1.25rem,5.5vw,1.6rem)] font-bold">
              <span className="truncate">{t.title}</span>
            </p>
            <p className="flex items-center gap-1.5 truncate text-white/70">
              {t.explicit && <Explicit />}
              {p.offlineSource && <WifiOff className="h-4 w-4 shrink-0 text-accent-soft" aria-label="Tocando do download" />}
              <span className="truncate">
                {t.artists.map((a, i) => (
                  <span key={a.id}>
                    {i > 0 && ', '}
                    <Link to={`/artist/${a.id}`} onClick={onClose} className="hover:underline">{a.name}</Link>
                  </span>
                ))}
              </span>
            </p>
          </div>
          <DownloadButton track={t} big />
          <LikeButton big />
        </div>
        <ProgressBar />
        <div className="my-3">
          <MainControls big />
        </div>
        <div className="flex items-center justify-between gap-2">
          <button className="icon-btn" aria-label="Letra" disabled={!t.has_lyrics} onClick={onOpenLyrics}>
            <MicVocal className="h-5 w-5" />
          </button>
          <div className="hidden sm:block">
            <VolumeControl />
          </div>
          <button className={`icon-btn ${p.autoRadio ? 'text-accent-soft' : ''}`} aria-label="Rádio automático ao fim da fila" aria-pressed={p.autoRadio} onClick={() => p.setAutoRadio(!p.autoRadio)}>
            <Radio className="h-5 w-5" />
          </button>
          <button className="icon-btn" aria-label="Fila" onClick={onOpenQueue}>
            <ListMusic className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function QueueRow({ item, isCurrent, onRemove, onJump }: { item: QItem; isCurrent?: boolean; onRemove?: () => void; onJump: () => void }) {
  const s = useSortable({ id: item.uid, disabled: isCurrent });
  const t = item.track;
  return (
    <li
      ref={s.setNodeRef}
      style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }}
      className={`flex items-center gap-2 rounded-lg py-1 ${s.isDragging ? 'z-10 bg-surface shadow-xl' : ''}`}
    >
      {!isCurrent && (
        <button className="icon-btn cursor-grab touch-none text-muted" aria-label="Arrastar para reordenar" {...s.attributes} {...s.listeners}>
          <GripVertical className="h-5 w-5" />
        </button>
      )}
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={onJump}>
        <Cover url={t.cover_url} alt={t.title} className="h-10 w-10 shrink-0" />
        <span className="min-w-0">
          <span className={`block truncate text-sm font-medium ${isCurrent ? 'text-accent-soft' : ''}`}>{t.title}</span>
          <span className="block truncate text-xs text-muted">{artistNames(t.artists)}</span>
        </span>
      </button>
      {onRemove && (
        <button className="icon-btn text-muted" aria-label={`Remover ${t.title} da fila`} onClick={onRemove}>
          <X className="h-5 w-5" />
        </button>
      )}
    </li>
  );
}

export function QueueSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const p = usePlayer();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const upcoming = p.queue.slice(p.index + 1);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const to = p.queue.findIndex((x) => x.uid === e.over!.id);
    p.moveInQueue(String(e.active.id), to);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Fila de reprodução" wide>
      {p.current && (
        <>
          <p className="mb-1 mt-1 text-sm font-semibold text-muted">Tocando agora</p>
          <ul className="mb-4">
            <QueueRow item={p.current} isCurrent onJump={() => {}} />
          </ul>
        </>
      )}
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted">A seguir{p.context?.name ? ` · ${p.context.name}` : ''}</p>
        {upcoming.length > 0 && (
          <button className="min-h-11 px-2 text-sm font-semibold text-white/80 hover:text-white" onClick={p.clearUpcoming}>
            Limpar fila
          </button>
        )}
      </div>
      {!upcoming.length ? (
        <p className="py-6 text-center text-sm text-muted">
          {p.autoRadio ? 'Quando a fila acabar, o rádio automático continua com músicas parecidas.' : 'Nada na fila.'}
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={upcoming.map((x) => x.uid)} strategy={verticalListSortingStrategy}>
            <ul>
              {upcoming.slice(0, 300).map((it) => (
                <QueueRow key={it.uid} item={it} onRemove={() => p.removeFromQueue(it.uid)} onJump={() => p.jumpTo(it.uid)} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-sm">
          <span className="block font-medium">Rádio automático</span>
          <span className="block text-xs text-muted">Continua tocando músicas parecidas ao fim da fila</span>
        </span>
        <Toggle checked={p.autoRadio} onChange={p.setAutoRadio} label="Rádio automático" />
      </div>
    </Sheet>
  );
}

type Line = { t: number; text: string };
function parseLrc(text: string): Line[] | null {
  const out: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const content = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) out.push({ t: (+m[1] * 60 + +m[2]) * 1000 + (m[3] ? +m[3].padEnd(3, '0') : 0), text: content });
  }
  return out.length ? out.sort((a, b) => a.t - b.t) : null;
}

export function LyricsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const p = usePlayer();
  const t = p.current?.track;
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const activeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!open || !t) return;
    setLoading(true);
    setLyrics(null);
    api<{ lyrics: string | null }>(`tracks/${t.id}`)
      .then((r) => setLyrics(r.lyrics))
      .catch(() => setLyrics(null))
      .finally(() => setLoading(false));
  }, [open, t?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = useMemo(() => (lyrics ? parseLrc(lyrics) : null), [lyrics]);
  const position = usePlayerPosition();
  const active = lines ? lines.reduce((acc, l, i) => (l.t <= position ? i : acc), -1) : -1;
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);
  return (
    <Sheet open={open} onClose={onClose} title={t ? `Letra · ${t.title}` : 'Letra'} wide>
      {loading ? (
        <div className="flex justify-center py-10"><Spinner className="h-6 w-6 text-muted" /></div>
      ) : !lyrics ? (
        <p className="py-10 text-center text-muted">Letra não disponível para esta música.</p>
      ) : lines ? (
        <div className="space-y-3 py-4">
          {lines.map((l, i) => (
            <p
              key={i}
              ref={i === active ? activeRef : undefined}
              onClick={() => p.seek(l.t)}
              className={`cursor-pointer text-[clamp(1.1rem,4.5vw,1.5rem)] font-bold leading-snug transition ${i === active ? 'text-white' : i < active ? 'text-white/40' : 'text-white/25'}`}
            >
              {l.text || '♪'}
            </p>
          ))}
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words py-4 text-lg leading-relaxed text-white/90">{lyrics}</p>
      )}
    </Sheet>
  );
}
