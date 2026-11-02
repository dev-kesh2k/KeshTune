import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Copy, KeyRound, Lock, ShieldOff, Trash2, Upload, UserPlus } from 'lucide-react';
import { api, errText } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { useFetch } from '../../lib/useFetch';
import { Confirm, Empty, ErrorBox, Field, PageLoading, Sheet, Spinner } from '../../components/ui';
import { SearchBar } from './AdminLayout';

type U = { id: string; email: string; display_name: string; role: 'admin' | 'user'; status: 'active' | 'blocked'; must_change_password: boolean; totp_enabled: boolean; created_at: string; last_seen_at: string | null; locked_until: string | null; devices: number };
type UDetail = U & { failed_logins: number; sessions: { id: string; user_agent: string; last_seen_at: string }[]; devices_list?: never; usage: { playlists: number; plays: number; liked: number } };

function TempPassword({ email, password }: { email: string; password: string }) {
  const toast = useToast();
  const text = `E-mail: ${email}\nSenha temporária: ${password}`;
  return (
    <div className="space-y-3 rounded-xl bg-emerald-950/50 p-4 ring-1 ring-emerald-800">
      <p className="text-sm text-emerald-100">Entregue estes dados à pessoa. A senha só aparece agora e deve ser trocada no primeiro acesso.</p>
      <p className="break-all font-mono text-sm">{email}</p>
      <p className="break-all font-mono text-lg font-bold">{password}</p>
      <button className="btn-secondary" onClick={() => navigator.clipboard.writeText(text).then(() => toast('Copiado', 'ok'))}><Copy className="h-4 w-4" /> Copiar</button>
    </div>
  );
}

export default function Users() {
  const { me } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t); }, [q]);
  const { data, error, loading, reload } = useFetch<{ items: U[] }>(`admin/users?q=${encodeURIComponent(debounced)}&status=${status}`, [debounced, status]);
  const [params, setParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(params.get('novo') === '1'); // atalho do Painel: /admin/users?novo=1
  useEffect(() => { if (params.get('novo')) setParams({}, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [importOpen, setImportOpen] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  return (
    <div className="pb-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Usuários</h2>
          <p className="text-sm text-muted">Crie contas para quem vai usar o app. Cada pessoa recebe uma senha temporária e troca no primeiro acesso.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Importar CSV</button>
          <button className="btn-primary" onClick={() => setCreateOpen(true)}><UserPlus className="h-4 w-4" /> Criar usuário</button>
        </div>
      </div>
      <SearchBar value={q} onChange={setQ} placeholder="Buscar por nome ou e-mail">
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
          <option value="all">Todas</option><option value="active">Ativas</option><option value="blocked">Bloqueadas</option>
        </select>
      </SearchBar>
      {loading ? <PageLoading /> : error ? <ErrorBox text={error} onRetry={() => reload()} /> : !data?.items.length ? <Empty title="Nenhuma conta encontrada" /> : (
        <ul className="space-y-2">
          {data.items.map((u) => (
            <li key={u.id}>
              <button className="card flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left hover:bg-white/[0.04]" onClick={() => setSel(u.id)}>
                <span className="min-w-0 flex-1 basis-48">
                  <span className="block truncate font-semibold">{u.display_name} {u.id === me?.id && <span className="text-xs text-accent-soft">(você)</span>}</span>
                  <span className="block truncate text-sm text-muted">{u.email}</span>
                </span>
                <span className="flex flex-wrap gap-1.5 text-xs">
                  {u.role === 'admin' && <span className="rounded-full bg-accent/30 px-2 py-0.5">Admin</span>}
                  {u.status === 'blocked' && <span className="rounded-full bg-red-900/60 px-2 py-0.5">Bloqueada</span>}
                  {u.must_change_password && <span className="rounded-full bg-amber-900/60 px-2 py-0.5">Senha temporária</span>}
                  {u.totp_enabled && <span className="rounded-full bg-emerald-900/60 px-2 py-0.5">2FA</span>}
                  {u.locked_until && new Date(u.locked_until) > new Date() && <span className="rounded-full bg-red-900/60 px-2 py-0.5">Travada</span>}
                </span>
                <span className="w-full text-xs text-muted sm:w-auto">{u.last_seen_at ? `Visto ${fmtDate(u.last_seen_at)}` : 'Nunca entrou'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <CreateUser open={createOpen} onClose={() => { setCreateOpen(false); reload(true); }} />
      <ImportUsers open={importOpen} onClose={() => { setImportOpen(false); reload(true); }} />
      {sel && <UserSheet id={sel} onClose={() => { setSel(null); reload(true); }} onError={(m) => toast(m, 'error')} />}
    </div>
  );
}

function CreateUser({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ display_name: '', email: '', role: 'user' });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ email: string; temp_password: string } | null>(null);
  useEffect(() => { if (open) { setForm({ display_name: '', email: '', role: 'user' }); setCreated(null); } }, [open]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { setCreated(await api('admin/users', { body: form })); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Criar usuário">
      {created ? (
        <div className="space-y-4 pt-2"><TempPassword email={created.email} password={created.temp_password} /><button className="btn-primary w-full" onClick={onClose}>Concluir</button></div>
      ) : (
        <form onSubmit={submit} className="space-y-4 pt-2">
          <Field label="Nome"><input className="input" required minLength={2} maxLength={80} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field>
          <Field label="E-mail"><input className="input" type="email" inputMode="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Perfil">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="user">Ouvinte</option><option value="admin">Administrador</option>
            </select>
          </Field>
          <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner className="h-4 w-4" />} Criar usuário e gerar senha</button>
        </form>
      )}
    </Sheet>
  );
}

function ImportUsers({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ created: { email: string; display_name: string; temp_password: string }[]; errors: { email: string; error: string }[] } | null>(null);
  useEffect(() => { if (open) { setCsv(''); setRes(null); } }, [open]);
  const exportCsv = () => {
    if (!res) return;
    const lines = ['Nome,E-mail,Senha temporária', ...res.created.map((c) => `"${c.display_name}",${c.email},${c.temp_password}`)];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv' }));
    a.download = 'contas-criadas.csv';
    a.click();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Importar contas (CSV)" wide>
      {res ? (
        <div className="space-y-3 pt-2">
          <p className="font-semibold">{res.created.length} contas criadas{res.errors.length ? `, ${res.errors.length} com erro` : ''}.</p>
          {res.created.length > 0 && <button className="btn-primary" onClick={exportCsv}>Baixar senhas temporárias (CSV)</button>}
          {res.errors.length > 0 && <ul className="max-h-40 overflow-y-auto text-sm text-red-300">{res.errors.map((e, i) => <li key={i} className="break-words">{e.email || '(vazio)'}: {e.error}</li>)}</ul>}
          <p className="text-xs text-muted">Guarde o arquivo com cuidado: as senhas não aparecem de novo.</p>
        </div>
      ) : (
        <form className="space-y-4 pt-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { setRes(await api('admin/users/import', { body: { csv } })); } catch (err) { toast(errText(err), 'error'); } finally { setBusy(false); } }}>
          <p className="text-sm text-muted">Uma conta por linha: <span className="font-mono">nome,email</span>. Até 500 por vez.</p>
          <input type="file" accept=".csv,text/csv,.txt" className="input py-2.5" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} aria-label="Arquivo CSV" />
          <textarea className="input min-h-40 py-3 font-mono text-sm" placeholder={'Maria Silva,maria@exemplo.com\nJoão Souza,joao@exemplo.com'} value={csv} onChange={(e) => setCsv(e.target.value)} aria-label="Conteúdo CSV" />
          <button className="btn-primary w-full" disabled={busy || !csv.trim()}>{busy && <Spinner className="h-4 w-4" />} Criar contas</button>
        </form>
      )}
    </Sheet>
  );
}

function UserSheet({ id, onClose, onError }: { id: string; onClose: () => void; onError: (m: string) => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const { data, setData, loading, reload } = useFetch<UDetail & { devices: { id: string; name: string; licenses: number }[] }>(`admin/users/${id}`, [id]);
  const [temp, setTemp] = useState<{ email: string; temp_password: string } | null>(null);
  const [confirm, setConfirm] = useState<null | 'delete' | 'reset'>(null);
  const [form, setForm] = useState<{ display_name: string; email: string; role: string } | null>(null);
  useEffect(() => { if (data) setForm({ display_name: data.display_name, email: data.email, role: data.role }); }, [data]);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok, 'ok'); reload(true); } catch (e) { onError(errText(e)); }
  };
  return (
    <Sheet open onClose={onClose} title={data?.display_name || 'Conta'} wide>
      {loading || !data || !form ? <PageLoading /> : (
        <div className="space-y-5 pt-2">
          {temp && <TempPassword email={temp.email} password={temp.temp_password} />}
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); act(async () => setData({ ...data, ...(await api(`admin/users/${id}`, { method: 'PATCH', body: form })) }), 'Conta atualizada'); }}>
            <Field label="Nome"><input className="input" required value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field>
            <Field label="E-mail"><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Perfil">
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="user">Ouvinte</option><option value="admin">Administrador</option>
              </select>
            </Field>
            <div className="flex items-end"><button className="btn-primary w-full">Salvar</button></div>
          </form>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className="card p-2"><p className="text-lg font-bold">{data.usage.playlists}</p><p className="text-xs text-muted">playlists</p></div>
            <div className="card p-2"><p className="text-lg font-bold">{data.usage.plays}</p><p className="text-xs text-muted">reproduções</p></div>
            <div className="card p-2"><p className="text-lg font-bold">{data.usage.liked}</p><p className="text-xs text-muted">curtidas</p></div>
          </div>
          <p className="text-xs text-muted">Criada em {fmtDate(data.created_at)} · {data.sessions.length} sessões abertas · {data.devices.length} aparelhos com downloads</p>
          <div className="flex flex-wrap gap-2">
            {data.id !== me?.id && (data.status === 'active' ? (
              <button className="btn-secondary text-red-300" onClick={() => act(() => api(`admin/users/${id}`, { method: 'PATCH', body: { status: 'blocked' } }), 'Conta bloqueada; sessões e downloads revogados')}><Lock className="h-4 w-4" /> Bloquear</button>
            ) : (
              <button className="btn-secondary" onClick={() => act(() => api(`admin/users/${id}`, { method: 'PATCH', body: { status: 'active' } }), 'Conta desbloqueada')}><Lock className="h-4 w-4" /> Desbloquear</button>
            ))}
            <button className="btn-secondary" onClick={() => setConfirm('reset')}><KeyRound className="h-4 w-4" /> Redefinir senha</button>
            {data.locked_until && new Date(data.locked_until) > new Date() && <button className="btn-secondary" onClick={() => act(() => api(`admin/users/${id}/unlock`, { method: 'POST' }), 'Conta destravada')}>Destravar login</button>}
            {data.totp_enabled && <button className="btn-secondary" onClick={() => act(() => api(`admin/users/${id}/disable-2fa`, { method: 'POST' }), '2FA desativado')}><ShieldOff className="h-4 w-4" /> Desativar 2FA</button>}
            {data.id !== me?.id && <button className="btn-secondary text-red-300" onClick={() => setConfirm('delete')}><Trash2 className="h-4 w-4" /> Excluir</button>}
          </div>
        </div>
      )}
      <Confirm open={confirm === 'reset'} title="Redefinir a senha?" text="Uma senha temporária será gerada; a pessoa sai de todos os aparelhos e troca a senha no próximo acesso." confirmLabel="Gerar senha" onClose={() => setConfirm(null)}
        onConfirm={async () => { setConfirm(null); try { setTemp(await api(`admin/users/${id}/reset-password`, { method: 'POST' })); reload(true); } catch (e) { onError(errText(e)); } }} />
      <Confirm open={confirm === 'delete'} title="Excluir esta conta?" text="A conta deixa de funcionar, as playlists dela são excluídas e os downloads revogados. Dados pessoais são apagados em 30 dias." confirmLabel="Excluir" danger onClose={() => setConfirm(null)}
        onConfirm={async () => { try { await api(`admin/users/${id}`, { method: 'DELETE' }); toast('Conta excluída', 'ok'); onClose(); } catch (e) { onError(errText(e)); setConfirm(null); } }} />
    </Sheet>
  );
}
