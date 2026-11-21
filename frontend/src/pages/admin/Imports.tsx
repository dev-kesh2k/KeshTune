import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronDown, Download, MinusCircle, RefreshCw, XCircle } from 'lucide-react';
import { api, errText } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { useFetch } from '../../lib/useFetch';
import { Empty, ErrorBox, Field, PageLoading, Spinner } from '../../components/ui';

type Status = { available: boolean; version?: string; error?: string };
type Job = {
  id: string; url: string; status: 'queued' | 'running' | 'done' | 'failed' | 'canceled'; imported: number; skipped: number; failed: number;
  error: string | null; created_at: string; started_at: string | null; finished_at: string | null; created_by_name: string | null;
};
type Item = { file: string; status: 'imported' | 'skipped' | 'failed'; title?: string; track_id?: string; message?: string };
type JobDetail = Job & { items: Item[]; log: string };

const STATUS_LABEL: Record<Job['status'], string> = { queued: 'Na fila', running: 'Baixando', done: 'Concluída', failed: 'Falhou', canceled: 'Cancelada' };
const STATUS_COLOR: Record<Job['status'], string> = { queued: 'text-muted', running: 'text-sky-300', done: 'text-emerald-300', failed: 'text-red-300', canceled: 'text-muted' };
const active = (j: Job) => j.status === 'queued' || j.status === 'running';

export default function Imports() {
  const toast = useToast();
  const st = useFetch<Status>('admin/imports/status');
  const { data, error, loading, reload } = useFetch<{ items: Job[] }>('admin/imports');
  const [links, setLinks] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const pending = !!data?.items.some(active);

  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => reload(true), 3000);
    return () => clearInterval(t);
  }, [pending, reload]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const urls = links.split(/\s+/).filter(Boolean);
    if (!urls.length) return;
    setBusy(true);
    let ok = 0;
    for (const url of urls) {
      try { await api('admin/imports', { body: { url } }); ok++; } catch (err) { toast(`${url}: ${errText(err)}`, 'error'); }
    }
    setBusy(false);
    if (ok) { toast(ok === 1 ? 'Link adicionado à fila' : `${ok} links adicionados à fila`, 'ok'); setLinks(''); reload(true); }
  };

  return (
    <div className="pb-6">
      <p className="mb-3 text-sm text-muted">
        Cole links do Spotify (faixa, álbum, playlist ou artista). O servidor baixa os áudios com o spotDL, que busca cada música no YouTube,
        e cada faixa entra no catálogo como arquivo próprio, com capa, álbum, ISRC e letra. Faixas com ISRC ou áudio já cadastrados são puladas.
      </p>
      {st.loading ? null : !st.data?.available ? (
        <div className="card mb-4 flex gap-3 p-4 text-sm ring-amber-400/30">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-300" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">spotDL não está disponível no servidor</p>
            <p className="text-muted">{st.data?.error || st.error}</p>
            <p className="mt-1 text-muted">Instale no servidor: <code>pip install spotdl</code> (Python 3.11+) e o ffmpeg (ou <code>spotdl --download-ffmpeg</code>). Se o executável não estiver no PATH, defina <code>SPOTDL_BIN</code>.</p>
          </div>
          <button className="icon-btn shrink-0" aria-label="Verificar de novo" onClick={async () => { try { st.setData(await api<Status>('admin/imports/status?refresh=1')); } catch (e) { toast(errText(e), 'error'); } }}>
            <RefreshCw className="h-5 w-5" />
          </button>
        </div>
      ) : (
        <form className="mb-5 space-y-3" onSubmit={submit}>
          <Field label="Links do Spotify" hint={`Um por linha · spotDL ${st.data.version}`}>
            <textarea className="input min-h-24 w-full" value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://open.spotify.com/album/..." />
          </Field>
          <button type="submit" className="btn-primary" disabled={busy || !links.trim()}>
            {busy ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />} Importar
          </button>
        </form>
      )}
      {loading ? <PageLoading /> : error ? <ErrorBox text={error} onRetry={() => reload()} /> : !data?.items.length ? <Empty title="Nenhuma importação ainda" /> : (
        <ul className="space-y-2">
          {data.items.map((j) => <JobRow key={j.id} job={j} open={open === j.id} onToggle={() => setOpen(open === j.id ? null : j.id)} onChange={() => reload(true)} />)}
        </ul>
      )}
    </div>
  );
}

function JobRow({ job: j, open, onToggle, onChange }: { job: Job; open: boolean; onToggle: () => void; onChange: () => void }) {
  const toast = useToast();
  const detail = useFetch<JobDetail>(open ? `admin/imports/${j.id}` : null, [open]);
  const { reload } = detail;
  // A lista é recarregada a cada 3 s enquanto há job ativo (novo objeto `j`); o detalhe aberto acompanha
  useEffect(() => { if (open) reload(true); }, [open, j, reload]);
  const cancel = async () => {
    try { await api(`admin/imports/${j.id}/cancel`, { method: 'POST' }); toast('Importação cancelada'); onChange(); } catch (e) { toast(errText(e), 'error'); }
  };
  return (
    <li className="card p-3">
      <div className="flex flex-wrap items-center gap-3">
        <button className="flex min-w-0 flex-1 basis-56 items-center gap-2 text-left" onClick={onToggle} aria-expanded={open}>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{j.url.replace('https://open.spotify.com/', '')}</span>
            <span className="block truncate text-xs text-muted">
              <span className={STATUS_COLOR[j.status]}>{STATUS_LABEL[j.status]}</span>
              {' · '}{j.imported} importadas{j.skipped ? ` · ${j.skipped} já existiam` : ''}{j.failed ? ` · ${j.failed} com erro` : ''}
              {' · '}{fmtDate(j.created_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}{j.created_by_name ? ` · ${j.created_by_name}` : ''}
            </span>
            {j.error && <span className="block truncate text-xs text-red-300">{j.error}</span>}
          </span>
        </button>
        {j.status === 'running' && <Spinner className="h-4 w-4 text-sky-300" />}
        {active(j) && <button className="btn-secondary" onClick={cancel}>Cancelar</button>}
      </div>
      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          {!detail.data ? (detail.error ? <p className="text-sm text-muted">{detail.error}</p> : <Spinner className="h-5 w-5 text-muted" />) : (
            <>
              {detail.data.items.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {detail.data.items.map((it, i) => (
                    <li key={i} className="flex items-start gap-2">
                      {it.status === 'imported' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /> : it.status === 'skipped' ? <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />}
                      <span className="min-w-0">
                        {it.track_id ? <Link className="hover:underline" to={`/track/${it.track_id}`}>{it.title}</Link> : <span>{it.file}</span>}
                        {it.message && <span className="block text-xs text-muted">{it.message}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {detail.data.log ? (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 text-xs text-muted">{detail.data.log}</pre>
              ) : <p className="text-sm text-muted">Sem saída do spotDL ainda.</p>}
            </>
          )}
        </div>
      )}
    </li>
  );
}
