import { useParams } from 'react-router-dom';
import { UserRound } from 'lucide-react';
import { api, errText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { useFetch } from '../lib/useFetch';
import type { PlaylistCard } from '../lib/types';
import { CollectionHeader } from '../components/Collection';
import { PlaylistTile, tileGrid } from '../components/Tiles';
import { Cover, Empty, ErrorBox, PageLoading, Section } from '../components/ui';
import { pagePad } from '../components/Layout';

type U = { id: string; display_name: string; avatar_url: string | null; bio: string | null; followers: number; following: number; is_following: boolean; playlists: PlaylistCard[] };

export default function UserProfile() {
  const { id } = useParams();
  const { me } = useAuth();
  const toast = useToast();
  const { data, setData, error, loading, offline, reload } = useFetch<U>(`users/${id}`, [id]);
  if (loading) return <PageLoading />;
  if (error || !data) return <ErrorBox text={error || 'Perfil não encontrado'} offline={offline} onRetry={() => reload()} />;
  const follow = async () => {
    const f = !data.is_following;
    setData({ ...data, is_following: f, followers: data.followers + (f ? 1 : -1) });
    try {
      await api('me/follows', { method: f ? 'PUT' : 'DELETE', body: { id: data.id } });
    } catch (e) {
      setData(data);
      toast(errText(e), 'error');
    }
  };
  return (
    <div>
      <CollectionHeader
        cover={<Cover url={data.avatar_url} alt={data.display_name} round className="w-full" icon={<UserRound className="h-1/3 w-1/3" />} />}
        kind="Perfil"
        title={data.display_name}
        description={data.bio}
        meta={<span>{data.playlists.length} playlists públicas · {data.followers} seguidores · seguindo {data.following}</span>}
      />
      <div className={`${pagePad} py-4`}>
        {me?.id !== data.id && (
          <button className={`chip mb-6 min-h-11 ${data.is_following ? 'chip-on' : ''}`} onClick={follow}>
            {data.is_following ? 'Seguindo' : 'Seguir'}
          </button>
        )}
        {data.playlists.length ? (
          <Section title="Playlists públicas">
            <div className={tileGrid}>{data.playlists.map((p) => <PlaylistTile key={p.id} p={p} grid />)}</div>
          </Section>
        ) : (
          <Empty title="Nenhuma playlist pública" />
        )}
      </div>
    </div>
  );
}
