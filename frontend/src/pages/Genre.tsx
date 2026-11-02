import { useParams } from 'react-router-dom';
import { Radio } from 'lucide-react';
import { usePlayer } from '../lib/player';
import { useFetch } from '../lib/useFetch';
import type { AlbumCard, Genre as G, Track } from '../lib/types';
import { PlayActions } from '../components/Collection';
import { AlbumTile } from '../components/Tiles';
import { TrackList } from '../components/TrackList';
import { Empty, ErrorBox, PageLoading, Section, Shelf } from '../components/ui';
import { PageHero, pagePad } from '../components/Layout';

export default function Genre() {
  const { id } = useParams();
  const { data, error, loading, offline, reload } = useFetch<G & { tracks: Track[]; albums: AlbumCard[] }>(`genres/${id}`, [id]);
  const player = usePlayer();
  if (loading) return <PageLoading />;
  if (error || !data) return <ErrorBox text={error || 'Não encontrado'} offline={offline} onRetry={() => reload()} />;
  const ctx = { type: 'genre' as const, id: String(data.id), name: data.name };
  return (
    <div>
      <PageHero color={data.color}>
        <p className="text-xs font-semibold uppercase tracking-wider text-white/80">{data.kind === 'mood' ? 'Momento' : 'Gênero'}</p>
        <h1 className="break-words text-[clamp(2rem,9vw,4rem)] font-black leading-none">{data.name}</h1>
      </PageHero>
      {data.tracks.length ? (
        <>
          <PlayActions tracks={data.tracks} ctx={ctx}>
            <button className="icon-btn" aria-label={`Rádio ${data.name}`} onClick={() => player.startRadio('genre', data.id, data.name)}>
              <Radio className="h-6 w-6" />
            </button>
          </PlayActions>
          <div className={pagePad}>
            <Section title="Músicas populares">
              <TrackList tracks={data.tracks} showAlbum onPlay={(i) => player.playTracks(data.tracks, i, ctx)} />
            </Section>
            {data.albums.length > 0 && (
              <Section title="Álbuns">
                <Shelf>{data.albums.map((a) => <AlbumTile key={a.id} a={a} />)}</Shelf>
              </Section>
            )}
          </div>
        </>
      ) : (
        <Empty title="Ainda não há músicas aqui" text="Quando o administrador classificar faixas neste gênero, elas aparecem aqui." />
      )}
    </div>
  );
}
