import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BadgeCheck, Radio, Share2, UserRound } from 'lucide-react';
import { api, errText } from '../lib/api';
import { usePlayer } from '../lib/player';
import { useToast } from '../lib/toast';
import { useFetch } from '../lib/useFetch';
import type { AlbumCard, PlaylistCard, Track } from '../lib/types';
import { CollectionHeader, PlayActions } from '../components/Collection';
import { AlbumTile, PlaylistTile } from '../components/Tiles';
import { TrackList } from '../components/TrackList';
import { useUi } from '../components/TrackActions';
import { Cover, Empty, ErrorBox, PageLoading, Section, Shelf } from '../components/ui';
import { pagePad } from '../components/Layout';

type Artist = {
  id: string; name: string; bio: string | null; image_url: string | null; verified: boolean; country: string | null;
  followed: boolean; followers: number; monthly_listeners: number;
  top_tracks: Track[]; albums: AlbumCard[]; appears_on: AlbumCard[]; playlists: PlaylistCard[];
  top_pending?: boolean;
};

export default function Artist() {
  const { id } = useParams();
  const { data, setData, error, loading, offline, reload } = useFetch<Artist>(`artists/${id}`, [id]);
  const player = usePlayer();
  const ui = useUi();
  const toast = useToast();
  const [showAll, setShowAll] = useState(false);
  // Primeira abertura do artista: o servidor ainda busca as 50 mais tocadas (top_pending) e respondeu só com as do
  // catálogo. Recarrega em silêncio, até 3 vezes
  const [polls, setPolls] = useState(0);
  useEffect(() => setPolls(0), [id]);
  const pending = !!data?.top_pending;
  useEffect(() => {
    if (!pending || polls >= 3) return;
    const t = setTimeout(() => {
      setPolls((n) => n + 1);
      reload(true);
    }, 6000);
    return () => clearTimeout(t);
  }, [pending, polls, reload]);
  if (loading) return <PageLoading />;
  if (error || !data) return <ErrorBox text={error || 'Artista não encontrado'} offline={offline} onRetry={() => reload()} />;
  const ctx = { type: 'artist' as const, id: data.id, name: data.name };
  const follow = async () => {
    const f = !data.followed;
    setData({ ...data, followed: f, followers: data.followers + (f ? 1 : -1) });
    try {
      await api('me/library/artist', { method: f ? 'PUT' : 'DELETE', body: { ids: [data.id] } });
    } catch (e) {
      setData({ ...data });
      toast(errText(e), 'error');
    }
  };
  return (
    <div>
      <CollectionHeader
        cover={<Cover url={data.image_url} alt={data.name} round className="w-full" icon={<UserRound className="h-1/3 w-1/3" />} />}
        kind={data.verified ? 'Artista verificado' : 'Artista'}
        title={data.name}
        meta={
          <>
            {data.verified && <BadgeCheck className="h-4 w-4 text-sky-400" />}
            <span>{data.monthly_listeners.toLocaleString('pt-BR')} ouvintes mensais</span>
            <span>· {data.followers.toLocaleString('pt-BR')} seguidores</span>
          </>
        }
      />
      <PlayActions tracks={data.top_tracks} ctx={ctx}>
        <button className={`chip min-h-11 ${data.followed ? 'chip-on' : ''}`} onClick={follow}>
          {data.followed ? 'Seguindo' : 'Seguir'}
        </button>
        <button className="icon-btn" aria-label="Rádio do artista" onClick={() => player.startRadio('artist', data.id, data.name)}>
          <Radio className="h-6 w-6" />
        </button>
        <button className="icon-btn" aria-label="Compartilhar" onClick={() => ui.share(`artist/${data.id}`, data.name)}>
          <Share2 className="h-6 w-6" />
        </button>
      </PlayActions>
      <div className={pagePad}>
        {data.top_tracks.length ? (
          <Section title="Populares">
            <TrackList tracks={showAll ? data.top_tracks : data.top_tracks.slice(0, 5)} numbered onPlay={(i) => player.playTracks(data.top_tracks, i, ctx)} />
            {data.top_tracks.length > 5 && (
              <button className="mt-2 min-h-11 px-3 text-sm font-semibold text-muted hover:text-white" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Mostrar menos' : 'Ver mais'}
              </button>
            )}
          </Section>
        ) : (
          <Empty title="Sem músicas disponíveis" />
        )}
        {data.albums.length > 0 && (
          <Section title="Discografia">
            <Shelf>{data.albums.map((a) => <AlbumTile key={a.id} a={a} />)}</Shelf>
          </Section>
        )}
        {data.appears_on.length > 0 && (
          <Section title="Aparece em">
            <Shelf>{data.appears_on.map((a) => <AlbumTile key={a.id} a={a} />)}</Shelf>
          </Section>
        )}
        {data.playlists.length > 0 && (
          <Section title="Em playlists">
            <Shelf>{data.playlists.map((p) => <PlaylistTile key={p.id} p={p} />)}</Shelf>
          </Section>
        )}
        {data.bio && (
          <Section title="Sobre">
            <div className="card max-w-3xl p-5">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/85">{data.bio}</p>
              {data.country && <p className="mt-3 text-xs text-muted">País: {data.country}</p>}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
