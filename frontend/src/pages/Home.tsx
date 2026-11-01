import { Link } from 'react-router-dom';
import { Heart, Play, Shield } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { usePlayer } from '../lib/player';
import { useFetch } from '../lib/useFetch';
import type { AlbumCard, ArtistCard, PlaylistCard, Track } from '../lib/types';
import { Cover, Empty, ErrorBox, PageLoading, Section, Shelf } from '../components/ui';
import { AlbumTile, ArtistTile, PlaylistTile } from '../components/Tiles';
import { TrackList } from '../components/TrackList';
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
  artists: ArtistCard[];
};

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function QuickTile({ to, title, cover, onPlay }: { to: string; title: string; cover: React.ReactNode; onPlay?: () => void }) {
  return (
    <div className="group relative flex min-w-0 items-center overflow-hidden rounded-md bg-white/[0.07] transition hover:bg-white/[0.14]">
      <Link to={to} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 pr-2">
        <div className="h-14 w-14 shrink-0">{cover}</div>
        <span className="line-clamp-2 min-w-0 text-[13px] font-bold leading-tight sm:text-sm">{title}</span>
      </Link>
      {onPlay && (
        <button className="mr-2 hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent shadow-lg group-hover:flex" aria-label={`Tocar ${title}`} onClick={onPlay}>
          <Play className="h-4 w-4 fill-white" />
        </button>
      )}
    </div>
  );
}

export default function Home() {
  const { me } = useAuth();
  const player = usePlayer();
  const { data, error, loading, offline, reload } = useFetch<HomeData>('browse/home');

  return (
    <div className={`${pagePad} pt-[max(1.25rem,env(safe-area-inset-top))] md:pt-6`}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-[clamp(1.5rem,6vw,2rem)] font-black">{greeting()}{me ? `, ${me.display_name.split(' ')[0]}` : ''}</h1>
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
          <div className="mb-8 grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 lg:grid-cols-4">
            <QuickTile
              to="/liked"
              title="Músicas Curtidas"
              cover={<span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent-deep to-accent-soft"><Heart className="h-6 w-6 fill-white" /></span>}
            />
            {data.my_playlists.slice(0, 7).map((p) => (
              <QuickTile key={p.id} to={`/playlist/${p.id}`} title={p.name} cover={<Cover url={p.cover_url} mosaic={p.mosaic} alt="" className="h-14 w-14 rounded-none" />} />
            ))}
          </div>
          {data.recent.length > 0 && (
            <Section title="Tocadas recentemente">
              <TrackList tracks={data.recent.slice(0, 6)} onPlay={(i) => player.playTracks(data.recent, i, { type: 'track', name: 'Tocadas recentemente' })} showAlbum />
            </Section>
          )}
          {data.mix.length > 0 && (
            <Section
              title="Seu mix"
              action={<button className="chip" onClick={() => player.playTracks(data.mix, 0, { type: 'radio', name: 'Seu mix' })}><Play className="h-4 w-4 fill-white" /> Tocar</button>}
            >
              <TrackList tracks={data.mix.slice(0, 5)} onPlay={(i) => player.playTracks(data.mix, i, { type: 'radio', name: 'Seu mix' })} showAlbum />
            </Section>
          )}
          {data.top.length > 0 && (
            <Section title="Mais ouvidas" action={<button className="chip" onClick={() => player.playTracks(data.top, 0, { type: 'track', name: 'Mais ouvidas' })}><Play className="h-4 w-4 fill-white" /> Tocar</button>}>
              <TrackList tracks={data.top.slice(0, 5)} numbered onPlay={(i) => player.playTracks(data.top, i, { type: 'track', name: 'Mais ouvidas' })} showAlbum />
            </Section>
          )}
          {data.followed_releases.length > 0 && (
            <Section title="Lançamentos de quem você segue">
              <Shelf>{data.followed_releases.map((a) => <AlbumTile key={a.id} a={a} />)}</Shelf>
            </Section>
          )}
          {data.releases.length > 0 && (
            <Section title="Radar de lançamentos">
              <Shelf>{data.releases.map((a) => <AlbumTile key={a.id} a={a} />)}</Shelf>
            </Section>
          )}
          {data.fresh.length > 0 && (
            <Section title="Novidades no catálogo">
              <TrackList tracks={data.fresh.slice(0, 5)} onPlay={(i) => player.playTracks(data.fresh, i, { type: 'track', name: 'Novidades' })} showAlbum />
            </Section>
          )}
          {data.artists.length > 0 && (
            <Section title="Artistas">
              <Shelf>{data.artists.map((a) => <ArtistTile key={a.id} a={a} />)}</Shelf>
            </Section>
          )}
          {data.public_playlists.length > 0 && (
            <Section title="Playlists da comunidade">
              <Shelf>{data.public_playlists.map((p) => <PlaylistTile key={p.id} p={p} />)}</Shelf>
            </Section>
          )}
        </>
      ) : null}
    </div>
  );
}
