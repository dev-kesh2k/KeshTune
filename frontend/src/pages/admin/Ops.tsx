import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Eye, EyeOff } from 'lucide-react';
import { api, downloadAuthed, errText } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { useFetch } from '../../lib/useFetch';
import { Empty, ErrorBox, Field, PageLoading, Spinner, Toggle } from '../../components/ui';
import { SearchBar, StatCard } from './AdminLayout';

// ---------------- Moderação ----------------
type P = { id: string; name: string; description: string | null; visibility: string; hidden_by_admin: boolean; updated_at: string; owner_name: string; owner_email: string; track_count: number; followers: number };
export function Moderation() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const { data, setData, error, loading, reload } = useFetch<{ items: P[] }>(`admin/playlists?q=${encodeURIComponent(dq)}`, [dq]);
  const toggle = async (p: P) => {
    try {
      await api(`admin/playlists/${p.id}`, { method: 'PATCH', body: { hidden_by_admin: !p.hidden_by_admin } });
      setData({ items: data!.items.map((x) => (x.id === p.id ? { ...x, hidden_by_admin: !p.hidden_by_admin } : x)) });
      toast(p.hidden_by_admin ? 'Playlist visível de novo' : 'Playlist ocultada da busca e do perfil', 'ok');
    } catch (e) { toast(errText(e), 'error'); }
  };
  return (
    <div className="pb-6">
      <p className="mb-3 text-sm text-muted">Playlists públicas ou por link. Ocultar tira da busca, do início e do perfil (o dono continua vendo).</p>
      <SearchBar value={q} onChange={setQ} placeholder="Buscar playlist" />
      {loading ? <PageLoading /> : error ? <ErrorBox text={error} onRetry={() => reload()} /> : !data?.items.length ? <Empty title="Nenhuma playlist pública" /> : (
        <ul className="space-y-2">
          {data.items.map((p) => (
            <li key={p.id} className={`card flex flex-wrap items-center gap-3 p-3 ${p.hidden_by_admin ? 'opacity-70' : ''}`}>
              <Link to={`/playlist/${p.id}`} className="min-w-0 flex-1 basis-48">
                <span className="block truncate font-semibold">{p.name}</span>
                <span className="block truncate text-xs text-muted">{p.owner_name} ({p.owner_email}) · {p.visibility === 'public' ? 'pública' : 'por link'} · {p.track_count} faixas · {p.followers} seguidores · {fmtDate(p.updated_at)}</span>
                {p.description && <span className="block truncate text-xs text-muted">{p.description}</span>}
              </Link>
              <button className={p.hidden_by_admin ? 'btn-secondary' : 'btn-secondary text-amber-300'} onClick={() => toggle(p)}>
                {p.hidden_by_admin ? <><Eye className="h-4 w-4" /> Mostrar</> : <><EyeOff className="h-4 w-4" /> Ocultar</>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------- Relatório de reproduções ----------------
type R = { from: string; to: string; total: number; items: { id: string; title: string; isrc: string | null; source: string; album: string | null; plays: number; artists: string | null; composers: string | null }[] };
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function Reports() {
  const toast = useToast();
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const { data, error, loading, reload } = useFetch<R>(`admin/reports/plays?from=${from}&to=${to}`, [from, to]);
  return (
    <div className="pb-6">
      <p className="mb-3 text-sm text-muted">Reproduções de 30 s ou mais (online e offline), base para o repasse de royalties aos titulares.</p>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="De"><input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Até"><input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <button className="btn-secondary" onClick={() => downloadAuthed(`admin/reports/plays?from=${from}&to=${to}&format=csv`, `reproducoes-${from}-a-${to}.csv`).catch((e) => toast(errText(e), 'error'))}>
          <Download className="h-4 w-4" /> Exportar CSV
        </button>
      </div>
      {loading ? <PageLoading /> : error ? <ErrorBox text={error} onRetry={() => reload()} /> : data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
            <StatCard label="Reproduções" value={data.total.toLocaleString('pt-BR')} />
            <StatCard label="Faixas tocadas" value={data.items.length} />
          </div>
          {!data.items.length ? <Empty title="Sem reproduções no período" /> : (
            <>
              <ul className="space-y-2 md:hidden">
                {data.items.map((r) => (
                  <li key={r.id} className="card flex items-center gap-3 p-3">
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.title}</span><span className="block truncate text-xs text-muted">{r.artists}{r.isrc ? ` · ${r.isrc}` : ''}</span></span>
                    <span className="shrink-0 font-bold tabular-nums">{r.plays}</span>
                  </li>
                ))}
              </ul>
              <div className="card hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-muted"><tr><th className="p-3">Faixa</th><th className="p-3">Artistas</th><th className="p-3">Compositores</th><th className="p-3">ISRC</th><th className="p-3">Fonte</th><th className="p-3 text-right">Reproduções</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {data.items.map((r) => (
                      <tr key={r.id}><td className="p-3 font-medium">{r.title}</td><td className="p-3 text-muted">{r.artists}</td><td className="p-3 text-muted">{r.composers || '—'}</td><td className="p-3 font-mono text-xs">{r.isrc || '—'}</td><td className="p-3">{r.source === 'youtube' ? 'YouTube' : 'Própria'}</td><td className="p-3 text-right font-bold tabular-nums">{r.plays}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------- Configurações ----------------
type S = { offline_enabled: boolean; youtube_enabled: boolean; max_offline_devices: number; max_offline_tracks: number; offline_license_days: number };
export function AdminSettings() {
  const toast = useToast();
  const { data, setData, error, loading, reload } = useFetch<S>('admin/settings');
  const [busy, setBusy] = useState(false);
  if (loading) return <PageLoading />;
  if (error || !data) return <ErrorBox text={error || 'Erro'} onRetry={() => reload()} />;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { setData(await api<S>('admin/settings', { method: 'PUT', body: data })); toast('Configurações salvas', 'ok'); } catch (err) { toast(errText(err), 'error'); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="card max-w-2xl space-y-5 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm"><span className="block font-medium">Downloads offline</span><span className="text-xs text-muted">Desligar revoga as licenças na próxima sincronização</span></span>
        <Toggle checked={data.offline_enabled} onChange={(v) => setData({ ...data, offline_enabled: v })} label="Downloads offline" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm"><span className="block font-medium">Faixas do YouTube</span><span className="text-xs text-muted">Permitir cadastrar faixas pelo player oficial do YouTube</span></span>
        <Toggle checked={data.youtube_enabled} onChange={(v) => setData({ ...data, youtube_enabled: v })} label="YouTube" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Aparelhos por conta"><input className="input" type="number" min={1} max={20} value={data.max_offline_devices} onChange={(e) => setData({ ...data, max_offline_devices: Number(e.target.value) })} /></Field>
        <Field label="Faixas baixadas por conta"><input className="input" type="number" min={1} max={10000} value={data.max_offline_tracks} onChange={(e) => setData({ ...data, max_offline_tracks: Number(e.target.value) })} /></Field>
        <Field label="Validade da licença (dias)"><input className="input" type="number" min={1} max={30} value={data.offline_license_days} onChange={(e) => setData({ ...data, offline_license_days: Number(e.target.value) })} /></Field>
      </div>
      <p className="text-xs text-muted">Sem anúncios e sem limite de pulos para todas as contas.</p>
      <button className="btn-primary" disabled={busy}>{busy && <Spinner className="h-4 w-4" />} Salvar</button>
    </form>
  );
}

// ---------------- Auditoria ----------------
type L = { id: number; action: string; target_type: string | null; target_id: string | null; details: Record<string, unknown> | null; ip: string; created_at: string; actor_name: string | null; actor_email: string | null };
const ACTIONS: Record<string, string> = {
  'admin.user_create': 'Criou conta', 'admin.user_update': 'Editou conta', 'admin.user_block': 'Bloqueou conta', 'admin.user_unblock': 'Desbloqueou conta',
  'admin.user_reset_password': 'Redefiniu senha', 'admin.user_delete': 'Excluiu conta', 'admin.user_unlock': 'Destravou login', 'admin.user_disable_2fa': 'Desativou 2FA de conta',
  'admin.track_create': 'Adicionou música', 'admin.track_update': 'Editou música', 'admin.track_delete': 'Excluiu música', 'admin.takedown': 'Retirou música do ar', 'admin.restore_track': 'Devolveu música ao ar',
  'admin.artist_create': 'Criou artista', 'admin.artist_update': 'Editou artista', 'admin.artist_delete': 'Excluiu artista',
  'admin.album_create': 'Criou álbum', 'admin.album_update': 'Editou álbum', 'admin.album_delete': 'Excluiu álbum',
  'admin.genre_create': 'Criou gênero', 'admin.genre_delete': 'Excluiu gênero', 'admin.playlist_hide': 'Ocultou playlist', 'admin.playlist_unhide': 'Mostrou playlist',
  'admin.settings': 'Alterou configurações', 'auth.change_password': 'Trocou a senha', 'auth.2fa_enable': 'Ativou 2FA', 'auth.2fa_disable': 'Desativou 2FA',
  'auth.logout_all': 'Saiu de todos os aparelhos', 'auth.locked': 'Login travado (5 erros)', 'account.self_delete': 'Excluiu a própria conta',
  'privacy.clear_history': 'Apagou o histórico', 'playlist.import': 'Importou playlist',
};
export function Audit() {
  const [items, setItems] = useState<L[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const load = async (before?: number) => {
    setLoading(true);
    try {
      const r = await api<{ items: L[]; next_before: number | null }>(`admin/audit${before ? `?before=${before}` : ''}`);
      setItems((l) => (before ? [...l, ...r.items] : r.items));
      setNext(r.next_before);
    } catch (e) { setErr(errText(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  if (err) return <ErrorBox text={err} onRetry={() => { setErr(null); load(); }} />;
  return (
    <div className="pb-6">
      {!items.length && loading ? <PageLoading /> : !items.length ? <Empty title="Nenhum registro" /> : (
        <ul className="space-y-1.5">
          {items.map((l) => (
            <li key={l.id} className="card p-3 text-sm">
              <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium">{ACTIONS[l.action] || l.action}</span>
                <span className="text-xs text-muted">{fmtDate(l.created_at, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              </p>
              <p className="break-words text-xs text-muted">
                {l.actor_name ? `${l.actor_name} (${l.actor_email})` : 'Sistema'} · IP {l.ip}
                {l.details ? ` · ${Object.entries(l.details).filter(([k]) => k !== 'password').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ')}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
      {next && <button className="btn-secondary mt-4" disabled={loading} onClick={() => load(next)}>{loading && <Spinner className="h-4 w-4" />} Carregar mais</button>}
    </div>
  );
}
