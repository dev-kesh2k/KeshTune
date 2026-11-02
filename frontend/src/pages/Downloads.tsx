import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CircleArrowDown, Settings, Trash2 } from 'lucide-react';
import { artistNames, fmtDate } from '../lib/format';
import { useDlGroups } from '../lib/dlgroups';
import { effectiveState, folderStatus, offlineSupported, removeDownload, useDownloads, useOfflineMode } from '../lib/offline';
import { usePlayer } from '../lib/player';
import { Cover, Empty } from '../components/ui';
import { pagePad } from '../components/Layout';

const LABEL: Record<string, string> = {
  QUEUED: 'Na fila', DOWNLOADING: 'Baixando', READY: 'Baixada', EXPIRING: 'Licença vencendo — conecte-se', EXPIRED: 'Licença vencida', FAILED: 'Falhou', REMOVED: 'Retirada',
};

export default function Downloads() {
  const list = useDownloads();
  const player = usePlayer();
  const offline = useOfflineMode();
  const [folder, setFolder] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    folderStatus().then((f) => setFolder(f.name)).catch(() => setFolder(null));
  }, []);

  const groups = useDlGroups();
  const inGroup = useMemo(() => new Set(groups.flatMap((g) => g.trackIds)), [groups]);
  const sorted = useMemo(() => [...list].sort((a, b) => String(b.downloaded_at || '').localeCompare(String(a.downloaded_at || ''))), [list]);
  const byId = useMemo(() => new Map(list.map((d) => [d.track_id, d])), [list]);
  // Coleção sem nenhuma música no aparelho (apagadas uma a uma) não aparece
  const shown = groups
    .map((g) => ({ g, done: g.trackIds.filter((t) => { const d = byId.get(t); return d && ['READY', 'EXPIRING'].includes(effectiveState(d)); }).length, has: g.trackIds.some((t) => byId.has(t)) }))
    .filter((x) => x.has);
  const loose = sorted.filter((r) => !inGroup.has(r.track_id));
  const ready = sorted.filter((r) => ['READY', 'EXPIRING'].includes(effectiveState(r)));

  return (
    <div className={`${pagePad} pt-[max(1.25rem,env(safe-area-inset-top))] md:pt-6`}>
      <h1 className="mb-5 text-[clamp(1.5rem,6vw,2rem)] font-black">Downloads</h1>
      {offlineSupported() && folder === null && (
        <div className="card mb-5 flex flex-wrap items-center gap-3 p-4 text-sm">
          <span className="min-w-0 flex-1 text-muted">Para baixar músicas, escolha antes a pasta onde elas ficam guardadas.</span>
          <Link to="/settings" className="btn-secondary"><Settings className="h-4 w-4" /> Abrir configurações</Link>
        </div>
      )}

      {!list.length ? (
        <Empty icon={<CircleArrowDown className="h-10 w-10" />} title="Nenhum download" text="Toque no botão de download em uma música, playlist ou álbum." />
      ) : (
        <>
          {ready.length > 0 && (
            <button className="btn-primary mb-4" onClick={() => player.playTracks(ready.map((r) => r.track), 0, { type: 'downloads', name: 'Downloads' })}>Tocar baixadas</button>
          )}
          {shown.length > 0 && (
            <>
              <h2 className="mb-2 mt-2 text-xl font-bold">Mixes, playlists e álbuns</h2>
              <ul className="mb-6 space-y-1">
                {shown.map(({ g, done }) => (
                  <li key={g.id}>
                    <Link to={`/downloads/${encodeURIComponent(g.id)}`} className="flex min-h-16 items-center gap-3 rounded-xl p-2 hover:bg-white/[0.04]">
                      <Cover url={offline ? null : g.image} alt={g.title} className="h-14 w-14 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{g.title}</span>
                        <span className="block truncate text-xs text-muted">{g.kind} · {done < g.trackIds.length ? `${done} de ${g.trackIds.length}` : g.trackIds.length} músicas</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {loose.length > 0 && <h2 className="mb-2 text-xl font-bold">Músicas baixadas avulsas</h2>}
            </>
          )}
          <ul className="space-y-1">
            {loose.map((r) => {
              const st = effectiveState(r);
              return (
                <li key={r.track_id} className="flex min-h-16 items-center gap-3 rounded-lg p-2 hover:bg-white/[0.04]">
                  <button className="flex min-w-0 flex-1 items-center gap-3 text-left" disabled={!['READY', 'EXPIRING'].includes(st)} onClick={() => player.playTracks(ready.map((x) => x.track), ready.findIndex((x) => x.track_id === r.track_id), { type: 'downloads', name: 'Downloads' })}>
                    <Cover url={offline ? null : r.track.cover_url} alt={r.track.title} className="h-12 w-12 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.track.title}</span>
                      <span className="block truncate text-xs text-muted">{artistNames(r.track.artists)}</span>
                      <span className={`mt-0.5 flex items-center gap-1 text-xs ${st === 'FAILED' || st === 'EXPIRED' ? 'text-red-300' : st === 'EXPIRING' ? 'text-amber-300' : 'text-accent-soft'}`}>
                        {(st === 'FAILED' || st === 'EXPIRING' || st === 'EXPIRED') && <AlertTriangle className="h-3 w-3" />}
                        {LABEL[st]}{st === 'DOWNLOADING' ? ` ${r.progress ?? 0}%` : ''}{st === 'FAILED' && r.error ? `: ${r.error}` : ''}
                        {(st === 'READY' || st === 'EXPIRING') && ` · até ${fmtDate(r.expires_at)}`}
                      </span>
                      {st === 'DOWNLOADING' && <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full bg-accent" style={{ width: `${r.progress ?? 0}%` }} /></span>}
                    </span>
                  </button>
                  <button className="icon-btn text-muted" aria-label={`Remover download de ${r.track.title}`} onClick={() => removeDownload(r.track_id)}><Trash2 className="h-5 w-5" /></button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
