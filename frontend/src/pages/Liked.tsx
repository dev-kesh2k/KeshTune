import { useEffect } from 'react';
import { Heart } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { usePlayer } from '../lib/player';
import { onRealtime } from '../lib/realtime';
import { useFetch } from '../lib/useFetch';
import type { Track } from '../lib/types';
import { CollectionHeader, PlayActions } from '../components/Collection';
import { TrackList, TrackListHeader } from '../components/TrackList';
import { Empty, ErrorBox, PageLoading } from '../components/ui';
import { pagePad } from '../components/Layout';

export default function Liked() {
  const { me } = useAuth();
  const player = usePlayer();
  const { data, error, loading, offline, reload } = useFetch<{ items: { track: Track; saved_at: string }[] }>('me/library/tracks?limit=2000');
  useEffect(() => {
    const off = onRealtime('library.changed', () => reload(true));
    const h = () => reload(true);
    window.addEventListener('spx:liked', h);
    return () => { off(); window.removeEventListener('spx:liked', h); };
  }, [reload]);
  const tracks = data?.items.map((i) => i.track) || [];
  const ctx = { type: 'liked' as const, id: 'liked', name: 'Músicas Curtidas' };
  return (
    <div>
      <CollectionHeader
        color="#5b21b6"
        cover={<div className="flex aspect-square w-full items-center justify-center rounded-md bg-gradient-to-br from-accent-deep via-accent to-[#c4b5fd]"><Heart className="h-1/3 w-1/3 fill-white" /></div>}
        kind="Playlist"
        title="Músicas Curtidas"
        meta={<span><b>{me?.display_name}</b> · {tracks.length} músicas</span>}
      />
      {loading ? <PageLoading /> : error ? <ErrorBox text={error} offline={offline} onRetry={() => reload()} /> : !tracks.length ? (
        <Empty icon={<Heart className="h-10 w-10" />} title="As músicas que você curtir aparecem aqui" text="Toque no coração de qualquer música para salvar." />
      ) : (
        <>
          <PlayActions tracks={tracks} ctx={ctx} group={{ kind: 'Playlist' }} />
          <div className={pagePad}>
            <TrackListHeader showAlbum />
            <TrackList tracks={tracks} showAlbum onPlay={(i) => player.playTracks(tracks, i, ctx)} />
          </div>
        </>
      )}
    </div>
  );
}
