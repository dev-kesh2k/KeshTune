import { RotateCcw, Trash2 } from 'lucide-react';
import { api, errText } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useToast } from '../lib/toast';
import { useFetch } from '../lib/useFetch';
import { Empty, ErrorBox, PageLoading } from '../components/ui';
import { pagePad } from '../components/Layout';
import { useTitle } from '../lib/useTitle';

export default function Trash() {
  useTitle('Lixeira');
  const toast = useToast();
  const { data, error, loading, reload } = useFetch<{ items: { id: string; name: string; deleted_at: string; track_count: number }[] }>('playlists/trash');
  const restore = async (id: string) => {
    try {
      await api(`playlists/${id}/restore`, { method: 'POST' });
      toast('Playlist recuperada', 'ok');
      window.dispatchEvent(new Event('spx:playlists-changed'));
      reload(true);
    } catch (e) {
      toast(errText(e), 'error');
    }
  };
  return (
    <div className={`${pagePad} pt-[max(1.25rem,env(safe-area-inset-top))] md:pt-6`}>
      <h1 className="mb-1 text-[clamp(1.5rem,6vw,2rem)] font-black">Playlists excluídas</h1>
      <p className="mb-5 text-sm text-muted">Ficam disponíveis por 30 dias após a exclusão.</p>
      {loading ? <PageLoading /> : error ? <ErrorBox text={error} onRetry={() => reload()} /> : !data?.items.length ? (
        <Empty icon={<Trash2 className="h-10 w-10" />} title="Nada por aqui" />
      ) : (
        <ul className="max-w-2xl space-y-2">
          {data.items.map((p) => (
            <li key={p.id} className="card flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.name}</p>
                <p className="text-xs text-muted">{p.track_count} faixas · excluída em {fmtDate(p.deleted_at)}</p>
              </div>
              <button className="btn-secondary shrink-0" onClick={() => restore(p.id)}><RotateCcw className="h-4 w-4" /> Recuperar</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
