import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, CircleArrowDown, Disc3, Heart, ListEnd, ListPlus, ListStart, Mic2, Plus, Radio, Share2, Trash2, UserRound, Info, Youtube,
} from 'lucide-react';
import { api, ApiError, errText } from '../lib/api';
import { artistNames, shareUrl } from '../lib/format';
import { downloadTracks, effectiveState, offlineSupported, removeDownload, useDownloads, type DlRecord, type DlState } from '../lib/offline';
import { mutate } from '../lib/pending';
import { usePlayer } from '../lib/player';
import { useToast } from '../lib/toast';
import type { PlaylistCard, Track } from '../lib/types';
import { Cover, Sheet, Spinner } from './ui';
import { focusOnMount } from '../lib/focus';

type MenuOpts = { onRemove?: () => void; removeLabel?: string };
type UiApi = {
  openTrackMenu: (t: Track, o?: MenuOpts) => void;
  openAddToPlaylist: (tracks: Track[]) => void;
  toggleLike: (t: Track) => Promise<void>;
  isLiked: (t: Track) => boolean;
  dlState: (trackId: string) => DlState | null;
  dlProgress: (trackId: string) => number | undefined;
  download: (tracks: Track[]) => Promise<void>;
  share: (path: string, title: string) => Promise<void>;
  saveFromYoutube: (t: Track) => Promise<void>;
  saveTracks: (tracks: Track[]) => Promise<void>;
  isSaving: (trackId: string) => boolean;
};
const Ctx = createContext<UiApi>(null as unknown as UiApi);
export const useUi = () => useContext(Ctx);

export function UiProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const player = usePlayer();
  const nav = useNavigate();
  const [menu, setMenu] = useState<{ track: Track; opts: MenuOpts } | null>(null);
  const [addTracks, setAddTracks] = useState<Track[] | null>(null);
  const [likes, setLikes] = useState<Map<string, boolean>>(new Map());
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const downloads = useDownloads();
  const dlMap = useMemo(() => new Map<string, DlRecord>(downloads.map((d) => [d.track_id, d])), [downloads]);

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.type === 'track' && Array.isArray(d.ids)) {
        setLikes((m) => {
          const n = new Map(m);
          for (const id of d.ids) n.set(id, !!d.saved);
          return n;
        });
      }
    };
    window.addEventListener('spx:library.changed', h);
    return () => window.removeEventListener('spx:library.changed', h);
  }, []);

  const isLiked = useCallback((t: Track) => likes.get(t.id) ?? t.liked, [likes]);
  const toggleLike = useCallback(
    async (t: Track) => {
      const now = !(likes.get(t.id) ?? t.liked);
      setLikes((m) => new Map(m).set(t.id, now));
      player.patchTrack(t.id, { liked: now });
      try {
        await mutate('me/library/track', now ? 'PUT' : 'DELETE', { ids: [t.id] });
        window.dispatchEvent(new CustomEvent('spx:liked', { detail: { id: t.id, liked: now } }));
        toast(now ? 'Adicionada às Músicas Curtidas' : 'Removida das Músicas Curtidas');
      } catch (e) {
        setLikes((m) => new Map(m).set(t.id, !now));
        toast(errText(e), 'error');
      }
    },
    [likes, player, toast]
  );

  const download = useCallback(
    async (tracks: Track[]) => {
      try {
        const n = await downloadTracks(tracks);
        toast(n ? `${n} faixa(s) na fila de download` : 'Já está baixado', 'ok');
      } catch (e) {
        const msg = (e as Error).message;
        toast(msg, 'error', /pasta/i.test(msg) ? { label: 'Abrir', run: () => nav('/settings') } : undefined);
      }
    },
    [toast, nav]
  );

  const mark = (ids: string[], on: boolean) =>
    setSaving((s) => {
      const n = new Set(s);
      for (const id of ids) (on ? n.add(id) : n.delete(id));
      return n;
    });

  /**
   * Baixa uma lista de faixas (uma música, playlist ou álbum inteiro). As de arquivo vão direto para Downloads;
   * as do YouTube o servidor baixa com o yt-dlp (fila, uma por vez) e, conforme ficam prontas, entram em Downloads.
   */
  const saveTracks = useCallback(
    async (list: Track[]) => {
      const files = list.filter((t) => t.source === 'file' && t.downloadable);
      const yts = list.filter((t) => t.source === 'youtube' && t.playable && !saving.has(t.id));
      let offlineOk = offlineSupported();
      // Leva para Downloads em silêncio (sem um aviso por lote); só avisa se faltar a pasta ou der erro
      const toDevice = async (tracks: Track[]) => {
        if (!offlineOk || !tracks.length) return;
        try {
          await downloadTracks(tracks);
        } catch (e) {
          offlineOk = false;
          const msg = (e as Error).message;
          toast(msg, 'error', /pasta/i.test(msg) ? { label: 'Abrir', run: () => nav('/settings') } : undefined);
        }
      };
      if (!files.length && !yts.length) return;
      if (files.length && !yts.length) return download(files);
      await toDevice(files);
      const ids = yts.map((t) => t.id);
      mark(ids, true);
      try {
        const r = await api<{ items: { track_id: string; status: string; job_id: string | null; error?: string }[] }>('youtube/downloads', { body: { track_ids: ids } });
        let saved = 0;
        let failed = r.items.filter((i) => i.status === 'failed').length;
        const pending = new Map(r.items.filter((i) => i.job_id && i.status !== 'done' && i.status !== 'failed').map((i) => [i.job_id!, i.track_id]));
        // Já eram arquivo no servidor: só falta baixar para o aparelho
        const ready = r.items.filter((i) => i.status === 'done').map((i) => ({ ...yts.find((t) => t.id === i.track_id)!, source: 'file' as const, downloadable: true }));
        saved += ready.length;
        mark(r.items.filter((i) => !i.job_id || i.status === 'done' || i.status === 'failed').map((i) => i.track_id), false);
        await toDevice(ready);
        if (pending.size) {
          toast(yts.length === 1 ? 'Baixando do YouTube no servidor. Avisamos quando terminar.' : `Baixando ${pending.size} músicas do YouTube no servidor. Pode continuar usando o app.`);
        }
        const deadline = Date.now() + Math.min(3 * 3600, 120 + pending.size * 60) * 1000;
        while (pending.size && Date.now() < deadline) {
          await new Promise((ok) => setTimeout(ok, 4000));
          let j: { items: { id: string; status: string; track_id: string; track: Track | null }[] };
          try {
            j = await api(`youtube/jobs?ids=${[...pending.keys()].slice(0, 200).join(',')}`);
          } catch (e) {
            if (e instanceof ApiError) throw e;
            continue; // sem rede por um instante: tenta de novo
          }
          const now: Track[] = [];
          for (const x of j.items) {
            if (x.status === 'done') { if (x.track) now.push(x.track); saved++; }
            else if (x.status === 'failed' || x.status === 'canceled') failed++;
            else continue;
            pending.delete(x.id);
            mark([x.track_id], false);
          }
          await toDevice(now);
        }
        if (yts.length === 1 && saved) toast(`"${yts[0].title}" agora está salva no app`, 'ok');
        else if (yts.length > 1) toast(`${saved} músicas salvas no app${failed ? `, ${failed} com erro` : ''}${pending.size ? `, ${pending.size} ainda na fila` : ''}`, failed ? 'error' : 'ok');
        else if (failed) toast('Não foi possível baixar esta música do YouTube', 'error');
      } catch (e) {
        toast(errText(e), 'error');
      } finally {
        mark(ids, false);
      }
    },
    [saving, toast, download, nav]
  );
  const saveFromYoutube = useCallback((t: Track) => saveTracks([t]), [saveTracks]);

  const share = useCallback(
    async (path: string, title: string) => {
      const url = shareUrl(path);
      try {
        if (navigator.share) await navigator.share({ title, url });
        else {
          await navigator.clipboard.writeText(url);
          toast('Link copiado', 'ok');
        }
      } catch {
        /* cancelado */
      }
    },
    [toast]
  );

  const api_: UiApi = {
    openTrackMenu: (track, opts = {}) => setMenu({ track, opts }),
    openAddToPlaylist: (tracks) => setAddTracks(tracks),
    toggleLike,
    isLiked,
    dlState: (id) => {
      const r = dlMap.get(id);
      return r ? effectiveState(r) : null;
    },
    dlProgress: (id) => dlMap.get(id)?.progress,
    download,
    share,
    saveFromYoutube,
    saveTracks,
    isSaving: (id) => saving.has(id),
  };

  const m = menu?.track;
  const st = m ? api_.dlState(m.id) : null;
  const close = () => setMenu(null);
  const go = (to: string) => {
    close();
    nav(to);
  };

  return (
    <Ctx.Provider value={api_}>
      {children}
      <Sheet open={!!menu} onClose={close}>
        {m && (
          <div className="pt-3">
            <div className="mb-3 flex items-center gap-3 border-b border-line pb-4">
              <Cover url={m.cover_url} alt={m.title} className="h-14 w-14 shrink-0" />
              <div className="min-w-0">
                <p className="truncate font-semibold">{m.title}</p>
                <p className="truncate text-sm text-muted">{artistNames(m.artists)}</p>
              </div>
            </div>
            <button className="menu-item" onClick={() => { toggleLike(m); close(); }}>
              <Heart className={`h-5 w-5 ${isLiked(m) ? 'fill-accent text-accent' : ''}`} />
              {isLiked(m) ? 'Remover das curtidas' : 'Curtir'}
            </button>
            <button className="menu-item" onClick={() => { close(); setAddTracks([m]); }}>
              <ListPlus className="h-5 w-5" /> Adicionar à playlist
            </button>
            <button className="menu-item" disabled={!m.playable} onClick={() => { player.playNext([m]); toast('Vai tocar a seguir'); close(); }}>
              <ListStart className="h-5 w-5" /> Tocar a seguir
            </button>
            <button className="menu-item" disabled={!m.playable} onClick={() => { player.addToQueue([m]); toast('Adicionada à fila'); close(); }}>
              <ListEnd className="h-5 w-5" /> Adicionar à fila
            </button>
            <button className="menu-item" onClick={() => { close(); player.startRadio('track', m.id, m.title); }}>
              <Radio className="h-5 w-5" /> Iniciar rádio
            </button>
            {m.downloadable && (
              st === 'READY' || st === 'EXPIRING' || st === 'QUEUED' || st === 'DOWNLOADING' ? (
                <button className="menu-item" onClick={() => { void removeDownload(m.id); close(); toast('Download removido'); }}>
                  <Trash2 className="h-5 w-5" /> Remover download
                </button>
              ) : (
                <button className="menu-item" onClick={() => { close(); download([m]); }}>
                  <CircleArrowDown className="h-5 w-5" /> Baixar
                </button>
              )
            )}
            {m.source === 'youtube' && (
              <button className="menu-item" disabled={saving.has(m.id)} onClick={() => { close(); saveFromYoutube(m); }}>
                {saving.has(m.id) ? <Spinner className="h-5 w-5" /> : <Youtube className="h-5 w-5" />}
                {saving.has(m.id) ? 'Baixando do YouTube…' : 'Baixar (salvar no app)'}
              </button>
            )}
            {m.artists.map((a) => (
              <button key={a.id} className="menu-item" onClick={() => go(`/artist/${a.id}`)}>
                <UserRound className="h-5 w-5" /> <span className="truncate">Ir para {a.name}</span>
              </button>
            ))}
            {m.album && (
              <button className="menu-item" onClick={() => go(`/album/${m.album!.id}`)}>
                <Disc3 className="h-5 w-5" /> Ir para o álbum
              </button>
            )}
            <button className="menu-item" onClick={() => go(`/track/${m.id}`)}>
              {m.has_lyrics ? <Mic2 className="h-5 w-5" /> : <Info className="h-5 w-5" />} {m.has_lyrics ? 'Letra e créditos' : 'Créditos'}
            </button>
            <button className="menu-item" onClick={() => { close(); share(`track/${m.id}`, m.title); }}>
              <Share2 className="h-5 w-5" /> Compartilhar
            </button>
            {menu?.opts.onRemove && (
              <button className="menu-item text-red-300" onClick={() => { menu.opts.onRemove!(); close(); }}>
                <Trash2 className="h-5 w-5" /> {menu.opts.removeLabel || 'Remover desta playlist'}
              </button>
            )}
          </div>
        )}
      </Sheet>
      <AddToPlaylist tracks={addTracks} onClose={() => setAddTracks(null)} />
    </Ctx.Provider>
  );
}

function AddToPlaylist({ tracks, onClose }: { tracks: Track[] | null; onClose: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const [lists, setLists] = useState<PlaylistCard[] | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [dup, setDup] = useState<{ pl: PlaylistCard; count: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (!tracks) return;
    setLists(null);
    setFilter('');
    setDup(null);
    api<{ items: PlaylistCard[] }>('playlists?editable=1').then((r) => setLists(r.items)).catch((e) => { toast(errText(e), 'error'); onClose(); });
  }, [tracks, toast, onClose]);

  const add = async (pl: PlaylistCard, duplicates: 'ask' | 'add' | 'skip' = 'ask') => {
    if (!tracks) return;
    setBusy(pl.id);
    try {
      const ids = tracks.map((t) => t.id);
      let added = 0;
      for (let i = 0; i < ids.length; i += 100) {
        const r = await api<{ added: number }>(`playlists/${pl.id}/items`, { body: { track_ids: ids.slice(i, i + 100), duplicates } });
        added += r.added;
      }
      toast(added ? `Adicionada(s) a "${pl.name}"` : 'Nada novo para adicionar', 'ok');
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE_TRACKS') setDup({ pl, count: (e.extra.duplicates as string[]).length });
      else toast(errText(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const create = async () => {
    if (!tracks || !newName.trim()) return;
    setBusy('new');
    try {
      const p = await api<{ id: string; name: string }>('playlists', { body: { name: newName.trim(), track_ids: tracks.slice(0, 100).map((t) => t.id) } });
      if (tracks.length > 100) {
        for (let i = 100; i < tracks.length; i += 100) await api(`playlists/${p.id}/items`, { body: { track_ids: tracks.slice(i, i + 100).map((t) => t.id), duplicates: 'add' } });
      }
      toast(`Playlist "${p.name}" criada`, 'ok');
      onClose();
      nav(`/playlist/${p.id}`);
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const shown = (lists || []).filter((l) => l.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Sheet open={!!tracks} onClose={onClose} title="Adicionar à playlist">
      {dup ? (
        <div className="py-2">
          <p className="mb-1 font-semibold">Já está na playlist</p>
          <p className="mb-5 text-sm text-muted">
            {dup.count === 1 ? 'Esta faixa já está' : `${dup.count} faixas já estão`} em "{dup.pl.name}". Quer adicionar mesmo assim?
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button className="btn-secondary" onClick={() => add(dup.pl, 'skip')}>
              {tracks && tracks.length > 1 ? 'Só as novas' : 'Não adicionar'}
            </button>
            <button className="btn-primary" onClick={() => add(dup.pl, 'add')}>
              Adicionar mesmo assim
            </button>
          </div>
        </div>
      ) : (
        <>
          {creating ? (
            <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
              <input className="input" ref={focusOnMount} maxLength={100} placeholder="Nome da playlist" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button type="submit" className="btn-primary shrink-0" disabled={!newName.trim() || busy === 'new'}>
                {busy === 'new' ? <Spinner className="h-4 w-4" /> : 'Criar'}
              </button>
            </form>
          ) : (
            <button className="btn-primary mb-4 w-full" onClick={() => setCreating(true)}>
              <Plus className="h-5 w-5" /> Nova playlist
            </button>
          )}
          {lists && lists.length > 6 && <input className="input mb-3" placeholder="Buscar playlist" value={filter} onChange={(e) => setFilter(e.target.value)} />}
          {!lists ? (
            <div className="flex justify-center py-8"><Spinner className="h-6 w-6 text-muted" /></div>
          ) : !shown.length ? (
            <p className="py-6 text-center text-sm text-muted">Nenhuma playlist editável ainda.</p>
          ) : (
            <ul className="space-y-1">
              {shown.map((p) => (
                <li key={p.id}>
                  <button className="menu-item" disabled={!!busy} onClick={() => add(p)}>
                    <Cover url={p.cover_url} mosaic={p.mosaic} alt={p.name} className="h-11 w-11 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-muted">{p.track_count} faixas{p.is_collaborative ? ' · colaborativa' : ''}</span>
                    </span>
                    {busy === p.id ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4 opacity-0" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Sheet>
  );
}

/** Botão de download da faixa: do YouTube, salva no app (servidor) e baixa; de arquivo, baixa para ouvir offline. */
export function DownloadButton({ track: t, big, className = '' }: { track: Track; big?: boolean; className?: string }) {
  const ui = useUi();
  const st = ui.dlState(t.id);
  const size = big ? 'h-7 w-7' : 'h-5 w-5';
  if (st === 'READY' || st === 'EXPIRING') {
    return (
      <span className={`icon-btn ${st === 'READY' ? 'text-accent-soft' : 'text-amber-400'} ${className}`} role="img" aria-label="Baixada" title="Baixada">
        <Check className={size} />
      </span>
    );
  }
  if (ui.isSaving(t.id) || st === 'QUEUED' || st === 'DOWNLOADING') {
    const pct = ui.dlProgress(t.id);
    return (
      <span className={`icon-btn text-accent-soft ${className}`} role="img" aria-label={pct != null ? `Baixando ${pct}%` : 'Baixando'} title="Baixando">
        <Spinner className={size} />
      </span>
    );
  }
  if (t.source !== 'youtube' && !t.downloadable) return null;
  return (
    <button
      className={`icon-btn ${st === 'FAILED' || st === 'EXPIRED' ? 'text-red-400' : ''} ${className}`}
      aria-label="Baixar"
      title={t.source === 'youtube' ? 'Baixar (salvar no app)' : 'Baixar para ouvir offline'}
      onClick={() => (t.source === 'youtube' ? ui.saveFromYoutube(t) : ui.download([t]))}
    >
      <CircleArrowDown className={size} />
    </button>
  );
}
