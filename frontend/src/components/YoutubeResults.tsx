import { useEffect, useState } from 'react';
import { CircleArrowDown, CircleCheck, MoreHorizontal, Youtube } from 'lucide-react';
import { api, ApiError, errText } from '../lib/api';
import { fmtTime } from '../lib/format';
import { usePlayer } from '../lib/player';
import { useToast } from '../lib/toast';
import type { Track } from '../lib/types';
import { useUi } from './TrackActions';
import { Cover, Section, Spinner } from './ui';

type YtItem = { youtube_id: string; title: string; channel: string; duration_ms: number; thumbnail_url: string; track_id: string | null; saved: boolean };

/** Resultados do YouTube na busca: tocar ou abrir o menu cadastra a faixa no catálogo. */
export function YoutubeResults({ q }: { q: string }) {
  const player = usePlayer();
  const ui = useUi();
  const toast = useToast();
  const [items, setItems] = useState<YtItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [off, setOff] = useState(false);

  // Espera a pessoa parar de digitar: cada busca no YouTube gasta cota da API (ou roda o yt-dlp)
  useEffect(() => {
    const ctl = new AbortController();
    setItems(null);
    setErr(null);
    const t = setTimeout(() => {
      api<{ items: YtItem[] }>(`youtube/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
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

  const ensure = async (it: YtItem) => {
    setOpening(it.youtube_id);
    try {
      const t = await api<Track>('youtube/tracks', { body: { youtube_id: it.youtube_id } });
      setItems((list) => list && list.map((x) => (x.youtube_id === it.youtube_id ? { ...x, track_id: t.id } : x)));
      return t;
    } catch (e) {
      toast(errText(e), 'error');
      return null;
    } finally {
      setOpening(null);
    }
  };

  if (off) return null;
  if (err) return <Section title="Do YouTube"><p className="text-sm text-muted">{err}</p></Section>;
  return (
    <Section title="Do YouTube">
      {!items ? (
        <div className="flex items-center gap-2 text-sm text-muted"><Spinner className="h-4 w-4" /> Buscando no YouTube…</div>
      ) : !items.length ? (
        <p className="text-sm text-muted">Nada encontrado no YouTube.</p>
      ) : (
        <ul>
          {items.map((it) => (
            <li key={it.youtube_id} className="flex items-center gap-1 rounded-lg hover:bg-white/[0.06]">
              <button
                className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-2 py-1.5 text-left"
                disabled={opening === it.youtube_id}
                onClick={async () => { const t = await ensure(it); if (t) player.playTracks([t], 0, { type: 'search', name: `YouTube: ${q}` }); }}
              >
                <span className="relative shrink-0">
                  <Cover url={it.thumbnail_url} alt="" className="h-12 w-12" />
                  {opening === it.youtube_id && <span className="absolute inset-0 flex items-center justify-center rounded-md bg-black/60"><Spinner className="h-5 w-5" /></span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{it.title}</span>
                  <span className="flex items-center gap-1 truncate text-xs text-muted">
                    {it.saved ? <CircleCheck className="h-3 w-3 shrink-0 text-accent-soft" aria-label="Salva no app" /> : <Youtube className="h-3 w-3 shrink-0" />}
                    <span className="truncate">{it.channel}</span>
                  </span>
                </span>
                {it.duration_ms > 0 && <span className="shrink-0 text-xs tabular-nums text-muted">{fmtTime(it.duration_ms)}</span>}
              </button>
              {(() => {
                const st = it.track_id ? ui.dlState(it.track_id) : null;
                if (st === 'READY' || st === 'EXPIRING') return <span className="icon-btn shrink-0 text-accent-soft" role="img" aria-label="Baixada" title="Baixada"><CircleCheck className="h-5 w-5" /></span>;
                if (it.track_id && (ui.isSaving(it.track_id) || st === 'QUEUED' || st === 'DOWNLOADING')) return <span className="icon-btn shrink-0 text-accent-soft" role="img" aria-label="Baixando"><Spinner className="h-5 w-5" /></span>;
                return (
                  <button
                    className="icon-btn shrink-0 text-muted"
                    aria-label="Baixar"
                    title="Baixar (salvar no app)"
                    disabled={opening === it.youtube_id}
                    onClick={async () => { const t = await ensure(it); if (t) (t.source === 'youtube' ? ui.saveFromYoutube(t) : ui.download([t])); }}
                  >
                    <CircleArrowDown className="h-5 w-5" />
                  </button>
                );
              })()}
              <button className="icon-btn shrink-0 text-muted" aria-label="Mais opções" disabled={opening === it.youtube_id} onClick={async () => { const t = await ensure(it); if (t) ui.openTrackMenu(t); }}>
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
