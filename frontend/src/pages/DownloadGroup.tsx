import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { artistNames } from '../lib/format';
import { removeGroup, useDlGroups } from '../lib/dlgroups';
import { effectiveState, removeDownload, useDownloads, useOfflineMode } from '../lib/offline';
import { usePlayer } from '../lib/player';
import { CollectionHeader } from '../components/Collection';
import { Cover, Empty } from '../components/ui';
import { pagePad } from '../components/Layout';

const isReady = (s: string) => s === 'READY' || s === 'EXPIRING';

/** Uma coleção baixada (mix, playlist, álbum): só as músicas que já estão no aparelho, na ordem dela. */
export default function DownloadGroup() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const groups = useDlGroups();
  const list = useDownloads();
  const player = usePlayer();
  const offline = useOfflineMode();
  const g = groups.find((x) => x.id === id);
  const byId = useMemo(() => new Map(list.map((d) => [d.track_id, d])), [list]);
  const ready = useMemo(
    () => (g ? g.trackIds.map((t) => byId.get(t)).filter((d) => d && isReady(effectiveState(d))).map((d) => d!) : []),
    [g, byId],
  );
  if (!g) return <Empty title="Coleção não encontrada" />;
  const tracks = ready.map((d) => d.track);
  const ctx = { type: 'downloads' as const, id: g.id, name: g.title };
  const del = async () => {
    // Apaga só as músicas que não estão em outra coleção baixada
    const elsewhere = new Set(groups.filter((x) => x.id !== g.id).flatMap((x) => x.trackIds));
    for (const t of g.trackIds) if (!elsewhere.has(t) && byId.has(t)) await removeDownload(t);
    removeGroup(g.id);
    nav('/downloads');
  };
  return (
    <div>
      <CollectionHeader
        cover={<Cover url={offline ? null : g.image} alt={g.title} className="w-full rounded-2xl" />}
        kind={`${g.kind} baixado`}
        title={g.title}
        meta={<span>{tracks.length} de {g.trackIds.length} músicas no aparelho</span>}
      />
      <div className={`${pagePad} flex flex-wrap gap-2 py-4`}>
        <button className="btn-primary" disabled={!tracks.length} onClick={() => player.playTracks(tracks, 0, ctx)}>Tocar</button>
        <button className="btn-secondary" onClick={del}><Trash2 className="h-4 w-4" /> Apagar coleção</button>
      </div>
      <ul className={`${pagePad} space-y-1`}>
        {ready.map((d, i) => (
          <li key={d.track_id} className="flex min-h-16 items-center gap-3 rounded-xl p-2 hover:bg-white/[0.04]">
            <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => player.playTracks(tracks, i, ctx)}>
              <Cover url={offline ? null : d.track.cover_url} alt={d.track.title} className="h-12 w-12 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{d.track.title}</span>
                <span className="block truncate text-xs text-muted">{artistNames(d.track.artists)}</span>
              </span>
            </button>
            <button className="icon-btn text-muted" aria-label={`Remover download de ${d.track.title}`} onClick={() => removeDownload(d.track_id)}><Trash2 className="h-5 w-5" /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}
