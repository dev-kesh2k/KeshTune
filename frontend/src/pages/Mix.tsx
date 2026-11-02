import { useParams } from 'react-router-dom';
import { usePlayer } from '../lib/player';
import { useFetch } from '../lib/useFetch';
import type { Track } from '../lib/types';
import { CollectionHeader, PlayActions } from '../components/Collection';
import { TrackList } from '../components/TrackList';
import { Cover, Empty, ErrorBox, PageLoading } from '../components/ui';
import { pagePad } from '../components/Layout';

type MixDetail = { id: string; title: string; description?: string | null; image_url?: string | null; tracks: Track[] };

/** Um mix do YouTube ou uma playlist do YouTube Music (as faixas tocam pelo catálogo, como no app). */
export default function Mix() {
  const { id } = useParams();
  const { data, error, loading, offline, reload } = useFetch<MixDetail>(`youtube/mixes/${id}`, [id]);
  const player = usePlayer();
  if (loading) return <PageLoading />;
  if (error || !data) return <ErrorBox text={error || 'Mix não encontrado'} offline={offline} onRetry={() => reload()} />;
  const kind = data.id.startsWith('RDCLAK') ? 'Playlist do YouTube Music' : 'Mix';
  const ctx = { type: 'mix' as const, id: data.id, name: data.title };
  const image = data.image_url || data.tracks[0]?.cover_url || null;
  return (
    <div>
      <CollectionHeader
        cover={<Cover url={image} alt={data.title} className="w-full rounded-2xl" />}
        kind={kind}
        title={data.title}
        description={data.description || undefined}
        meta={<span>{data.tracks.length} músicas</span>}
      />
      <PlayActions tracks={data.tracks} ctx={ctx} group={{ kind, image }} />
      <div className={pagePad}>
        {data.tracks.length ? (
          <TrackList tracks={data.tracks} numbered showAlbum onPlay={(i) => player.playTracks(data.tracks, i, ctx)} />
        ) : (
          <Empty title="Sem músicas disponíveis" />
        )}
      </div>
    </div>
  );
}
