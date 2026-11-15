import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { usePlayer, type PlayContext } from '../lib/player';
import { useFetch } from '../lib/useFetch';
import { useTitle } from '../lib/useTitle';
import type { AlbumCard, ArtistCard, PlaylistCard, Track } from '../lib/types';
import { Empty, ErrorBox, PageLoading, Section, Shelf } from '../components/ui';
import { AlbumTile, ArtistTile, PlaylistTile, TrackTile } from '../components/Tiles';
import { pagePad } from '../components/Layout';

type HomeData = {
  catalog_size: number;
  recent: Track[];
  mix: Track[];
  top: Track[];
  fresh: Track[];
  releases: AlbumCard[];
  followed_releases: AlbumCard[];
  my_playlists: PlaylistCard[];
  public_playlists: PlaylistCard[];
  /** Top 10 em alta no Brasil. */
  artists: ArtistCard[];
  /** Os que o usuário mais ouviu nos últimos 90 dias. */
  my_artists?: ArtistCard[];
};

function greeting() {
  const h = new Date().getHours();
  return h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
}

/** Prateleira de músicas em cards: tocar um card toca a prateleira inteira a partir dele (como no app). */
function TrackShelf({ title, tracks, ctx }: { title: string; tracks: Track[]; ctx: PlayContext }) {
  const player = usePlayer();
  if (!tracks.length) return null;
  return (
    <Section title={title}>
      <Shelf>{tracks.map((t, i) => <TrackTile key={`${t.id}:${i}`} t={t} onPlay={() => player.playTracks(tracks, i, ctx)} />)}</Shelf>
    </Section>
  );
}

export default function Home() {
  useTitle('Início');
  const { me } = useAuth();
  const { data, error, loading, offline, reload } = useFetch<HomeData>('browse/home');

  return (
    <div className={`${pagePad} pt-[max(1.25rem,env(safe-area-inset-top))] md:pt-6`}>
      <div className="mb-6 min-w-0">
        <h1 className="truncate text-[clamp(1.75rem,6vw,2.5rem)] font-black">{greeting()}</h1>
        <p className="text-muted">O que vamos ouvir na estrada?</p>
      </div>
      {loading ? (
        <PageLoading />
      ) : error ? (
        <ErrorBox text={error} offline={offline} onRetry={() => reload()} />
      ) : data && data.catalog_size === 0 ? (
        <Empty
          title="O catálogo ainda está vazio"
          text={me?.role === 'admin' ? 'Envie arquivos de áudio ou adicione links do YouTube no painel do administrador.' : 'O administrador ainda não adicionou músicas. Volte em breve!'}
          action={me?.role === 'admin' ? <Link to="/admin/tracks" className="btn-primary"><Shield className="h-4 w-4" /> Adicionar músicas</Link> : undefined}
        />
      ) : data ? (
        <>
          <TrackShelf title="Tocadas recentemente" tracks={data.recent} ctx={{ type: 'track', name: 'Tocadas recentemente' }} />
          {data.artists.length > 0 && (
            <Section title="Artistas em alta no Brasil">
              <Shelf>{data.artists.map((a) => <ArtistTile key={a.id} a={a} />)}</Shelf>
            </Section>
          )}
          {!!data.my_artists?.length && (
            <Section title="Seus artistas">
              <Shelf>{data.my_artists.map((a) => <ArtistTile key={a.id} a={a} />)}</Shelf>
            </Section>
          )}
          <TrackShelf title="Seu mix" tracks={data.mix} ctx={{ type: 'radio', name: 'Seu mix' }} />
          <TrackShelf title="Em alta" tracks={data.top} ctx={{ type: 'track', name: 'Em alta' }} />
          {data.my_playlists.length > 0 && (
            <Section title="Suas playlists">
              <Shelf>{data.my_playlists.map((p) => <PlaylistTile key={p.id} p={p} />)}</Shelf>
            </Section>
          )}
          <TrackShelf title="Novidades" tracks={data.fresh} ctx={{ type: 'track', name: 'Novidades' }} />
          {data.followed_releases.length > 0 && (
            <Section title="Lançamentos de quem você segue">
              <Shelf>{data.followed_releases.map((a) => <AlbumTile key={a.id} a={a} />)}</Shelf>
            </Section>
          )}
          {data.releases.length > 0 && (
            <Section title="Lançamentos">
              <Shelf>{data.releases.map((a) => <AlbumTile key={a.id} a={a} />)}</Shelf>
            </Section>
          )}
          {data.public_playlists.length > 0 && (
            <Section title="Playlists em destaque">
              <Shelf>{data.public_playlists.map((p) => <PlaylistTile key={p.id} p={p} />)}</Shelf>
            </Section>
          )}
        </>
      ) : null}
    </div>
  );
}
