import { Link, useParams } from 'react-router-dom';
import { Heart, MoreHorizontal, Share2 } from 'lucide-react';
import { api, errText } from '../lib/api';
import { albumType, fmtDate, fmtTotal } from '../lib/format';
import { usePlayer } from '../lib/player';
import { useToast } from '../lib/toast';
import { useFetch } from '../lib/useFetch';
import type { AlbumCard, ArtistRef, Track } from '../lib/types';
import { CollectionHeader, PlayActions } from '../components/Collection';
import { AlbumTile } from '../components/Tiles';
import { TrackList, TrackListHeader } from '../components/TrackList';
import { useUi } from '../components/TrackActions';
import { Cover, ErrorBox, PageLoading, Section, Shelf } from '../components/ui';
import { pagePad } from '../components/Layout';

type Album = AlbumCard & { label: string | null; upc: string | null; saved: boolean; tracks: Track[]; duration_ms: number; more_by_artist: AlbumCard[]; artists: ArtistRef[] };

export default function Album() {
  const { id } = useParams();
  const { data, setData, error, loading, offline, reload } = useFetch<Album>(`albums/${id}`, [id]);
  const player = usePlayer();
  const ui = useUi();
  const toast = useToast();
  if (loading) return <PageLoading />;
  if (error || !data) return <ErrorBox text={error || 'Álbum não encontrado'} offline={offline} onRetry={() => reload()} />;
  const ctx = { type: 'album' as const, id: data.id, name: data.title };
  const toggleSave = async () => {
    const saved = !data.saved;
    setData({ ...data, saved });
    try {
      await api('me/library/album', { method: saved ? 'PUT' : 'DELETE', body: { ids: [data.id] } });
      toast(saved ? 'Álbum salvo na biblioteca' : 'Removido da biblioteca');
    } catch (e) {
      setData({ ...data, saved: !saved });
      toast(errText(e), 'error');
    }
  };
  return (
    <div>
      <CollectionHeader
        cover={<Cover url={data.cover_url} alt={data.title} className="w-full" />}
        kind={albumType(data.type)}
        title={data.title}
        meta={
          <>
            {data.artists.map((a, i) => (
              <span key={a.id}>
                {i > 0 && ', '}
                <Link to={`/artist/${a.id}`} className="font-bold hover:underline">{a.name}</Link>
              </span>
            ))}
            {data.release_date && <span>· {data.release_date.slice(0, 4)}</span>}
            <span>· {data.tracks.length} faixas, {fmtTotal(data.duration_ms)}</span>
          </>
        }
      />
      <PlayActions tracks={data.tracks} ctx={ctx}>
        <button className={`icon-btn ${data.saved ? 'text-accent' : ''}`} aria-label={data.saved ? 'Remover da biblioteca' : 'Salvar na biblioteca'} onClick={toggleSave}>
          <Heart className={`h-7 w-7 ${data.saved ? 'fill-accent' : ''}`} />
        </button>
        <button className="icon-btn" aria-label="Compartilhar" onClick={() => ui.share(`album/${data.id}`, data.title)}>
          <Share2 className="h-6 w-6" />
        </button>
        <button className="icon-btn" aria-label="Adicionar todas a uma playlist" onClick={() => ui.openAddToPlaylist(data.tracks)}>
          <MoreHorizontal className="h-6 w-6" />
        </button>
      </PlayActions>
      <div className={pagePad}>
        <TrackListHeader numbered />
        <TrackList tracks={data.tracks} numbered showCover={false} onPlay={(i) => player.playTracks(data.tracks, i, ctx)} />
        <div className="mb-8 mt-6 text-xs text-muted">
          {data.release_date && <p>{fmtDate(data.release_date, { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
          {data.label && <p>℗ {data.label}</p>}
          {data.upc && <p>UPC {data.upc}</p>}
        </div>
        {data.more_by_artist.length > 0 && (
          <Section title={`Mais de ${data.artists[0]?.name}`}>
            <Shelf>{data.more_by_artist.map((a) => <AlbumTile key={a.id} a={a} />)}</Shelf>
          </Section>
        )}
      </div>
    </div>
  );
}
