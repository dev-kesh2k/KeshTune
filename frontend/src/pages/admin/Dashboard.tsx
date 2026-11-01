import { Link } from 'react-router-dom';
import { fmtBytes, fmtDate } from '../../lib/format';
import { useFetch } from '../../lib/useFetch';
import { ErrorBox, PageLoading } from '../../components/ui';
import { StatCard } from './AdminLayout';

type Stats = {
  users: number; blocked_users: number; tracks: number; youtube_tracks: number; takedown_tracks: number; artists: number; albums: number; playlists: number;
  storage_bytes: number; plays_today: number; plays_30d: number; active_users_30d: number; devices: number; offline_licenses: number;
  daily: { day: string; plays: number }[]; top: { id: string; title: string; artists: string | null; plays: number }[];
};

export default function Dashboard() {
  const { data, error, loading, reload } = useFetch<Stats>('admin/stats');
  if (loading) return <PageLoading />;
  if (error || !data) return <ErrorBox text={error || 'Erro'} onRetry={() => reload()} />;
  const max = Math.max(1, ...data.daily.map((d) => d.plays));
  return (
    <div className="space-y-6 pb-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Reproduções hoje" value={data.plays_today.toLocaleString('pt-BR')} hint={`${data.plays_30d.toLocaleString('pt-BR')} em 30 dias`} />
        <StatCard label="Contas" value={data.users} hint={`${data.active_users_30d} ativas · ${data.blocked_users} bloqueadas`} />
        <StatCard label="Músicas" value={data.tracks} hint={`${data.youtube_tracks} do YouTube · ${data.takedown_tracks} retiradas`} />
        <StatCard label="Artistas / álbuns" value={`${data.artists} / ${data.albums}`} />
        <StatCard label="Playlists" value={data.playlists} />
        <StatCard label="Armazenamento de áudio" value={fmtBytes(Number(data.storage_bytes))} />
        <StatCard label="Aparelhos" value={data.devices} hint={`${data.offline_licenses} licenças offline ativas`} />
      </div>
      <section className="card p-4">
        <h2 className="mb-3 font-bold">Reproduções nos últimos 30 dias</h2>
        <div className="flex h-36 items-end gap-[2px]" role="img" aria-label="Gráfico de reproduções por dia">
          {data.daily.map((d) => (
            <div key={d.day} className="group relative flex h-full min-w-0 flex-1 items-end">
              <div className="w-full rounded-t-sm bg-accent/80 transition group-hover:bg-accent-soft" style={{ height: `${Math.max(2, (d.plays / max) * 100)}%` }} />
              <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-black px-2 py-1 text-xs group-hover:block">
                {fmtDate(d.day, { day: '2-digit', month: '2-digit' })}: {d.plays}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-xs text-muted"><span>{fmtDate(data.daily[0]?.day, { day: '2-digit', month: 'short' })}</span><span>hoje</span></div>
      </section>
      <section className="card p-4">
        <h2 className="mb-3 font-bold">Mais tocadas (30 dias)</h2>
        {!data.top.length ? <p className="text-sm text-muted">Ainda sem reproduções.</p> : (
          <ol className="space-y-2">
            {data.top.map((t, i) => (
              <li key={t.id} className="flex items-center gap-3">
                <span className="w-6 text-right text-sm text-muted">{i + 1}</span>
                <Link to={`/track/${t.id}`} className="min-w-0 flex-1 truncate hover:underline">{t.title} <span className="text-muted">· {t.artists}</span></Link>
                <span className="shrink-0 text-sm tabular-nums">{t.plays}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
