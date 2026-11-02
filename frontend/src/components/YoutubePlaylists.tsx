import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListMusic } from 'lucide-react';
import { api, ApiError, errText } from '../lib/api';
import { useToast } from '../lib/toast';
import { tileGrid } from './Tiles';
import { Section, Spinner } from './ui';

type YtPlaylist = { playlist_id: string; title: string; channel: string; thumbnail_url: string | null };

/** Playlists do YouTube na busca: abrir uma importa como playlist sua (as faixas tocam online). */
export function YoutubePlaylists({ q }: { q: string }) {
  const nav = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState<YtPlaylist[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  // Espera a pessoa parar de digitar: cada busca no YouTube gasta cota da API (ou roda o yt-dlp)
  useEffect(() => {
    const ctl = new AbortController();
    setItems(null);
    setErr(null);
    const t = setTimeout(() => {
      api<{ items: YtPlaylist[] }>(`youtube/playlists?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => setItems(r.items))
        .catch((e) => {
          if (e.name === 'AbortError') return;
          if (e instanceof ApiError && e.code === 'YOUTUBE_DISABLED') setOff(true);
          else setErr(errText(e));
        });
    }, 700);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  const open = async (p: YtPlaylist) => {
    if (opening) return;
    setOpening(p.playlist_id);
    try {
      const r = await api<{ id: string; tracks: number }>('youtube/playlists/import', { body: { playlist_id: p.playlist_id } });
      toast(`Playlist adicionada à sua biblioteca (${r.tracks} músicas)`, 'ok');
      nav(`/playlist/${r.id}`);
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setOpening(null);
    }
  };

  if (off) return null;
  return (
    <Section title="Playlists do YouTube">
      {err ? (
        <p className="text-sm text-muted">{err}</p>
      ) : !items ? (
        <div className="flex items-center gap-2 text-sm text-muted"><Spinner className="h-4 w-4" /> Buscando playlists no YouTube…</div>
      ) : !items.length ? (
        <p className="text-sm text-muted">Nenhuma playlist encontrada no YouTube.</p>
      ) : (
        <div className={tileGrid}>
          {items.map((p) => (
            <button key={p.playlist_id} className="block min-w-0 rounded-xl p-2 text-left hover:bg-white/[0.06] disabled:opacity-60" disabled={!!opening} onClick={() => open(p)}>
              <span className="relative mb-2 block aspect-square overflow-hidden rounded-md bg-surface2">
                {p.thumbnail_url ? (
                  <img src={p.thumbnail_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-muted"><ListMusic className="h-1/3 w-1/3" /></span>
                )}
                {opening === p.playlist_id && <span className="absolute inset-0 flex items-center justify-center bg-black/60"><Spinner className="h-8 w-8" /></span>}
              </span>
              <span className="block truncate text-sm font-semibold">{p.title}</span>
              <span className="block truncate text-xs text-muted">Playlist · {p.channel || 'YouTube'}</span>
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}
