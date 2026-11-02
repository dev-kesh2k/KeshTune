import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { Download, History, ImagePlus, LogOut, MonitorSmartphone, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { api, downloadAuthed, errText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { uploadSquareImage } from '../lib/image';
import { forgetDevice, getDeviceId } from '../lib/offline';
import { useToast } from '../lib/toast';
import { useFetch } from '../lib/useFetch';
import type { Me } from '../lib/types';
import { Confirm, Cover, Field, Sheet, Spinner, Toggle } from '../components/ui';
import { pagePad } from '../components/Layout';
import { PasswordForm } from './ChangePassword';

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">{icon} {title}</h2>
      {children}
    </section>
  );
}

function uaLabel(ua: string | null) {
  if (!ua) return 'Navegador';
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl/.test(ua) ? 'curl' : 'Navegador';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${b}${os ? ` · ${os}` : ''}`;
}

export default function Settings() {
  const { me, setMe, logout } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(me?.display_name || '');
  const [bio, setBio] = useState(me?.bio || '');
  const [saving, setSaving] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [totp, setTotp] = useState<{ secret: string; qr: string } | null>(null);
  const [otp, setOtp] = useState('');
  const [disable2fa, setDisable2fa] = useState(false);
  const [pw, setPw] = useState('');
  const [clearHist, setClearHist] = useState(false);
  const [delAccount, setDelAccount] = useState(false);
  const [thisDevice, setThisDevice] = useState<string | null>(null);
  const sessions = useFetch<{ items: { id: string; user_agent: string; ip: string; last_seen_at: string; current: boolean }[] }>('me/sessions');
  const devices = useFetch<{ items: { id: string; name: string; last_seen_at: string; licenses: number }[]; max_devices: number }>('devices');
  useEffect(() => { getDeviceId(false).then(setThisDevice).catch(() => {}); }, []);
  if (!me) return null;

  const patch = async (body: Partial<Me>) => {
    try {
      setMe(await api<Me>('me', { method: 'PATCH', body }));
      return true;
    } catch (e) {
      toast(errText(e), 'error');
      return false;
    }
  };
  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    if (await patch({ display_name: name, bio })) toast('Perfil salvo', 'ok');
    setSaving(false);
  };
  const avatar = async (f?: File) => {
    if (!f) return;
    try {
      const url = await uploadSquareImage(f, 400);
      await patch({ avatar_url: url });
    } catch (e) {
      toast(errText(e, (e as Error).message), 'error');
    }
  };
  const start2fa = async () => {
    try {
      const r = await api<{ secret: string; otpauth_url: string }>('auth/2fa/setup', { method: 'POST' });
      setTotp({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauth_url, { margin: 1, width: 320 }) });
      setOtp('');
    } catch (e) {
      toast(errText(e), 'error');
    }
  };
  const enable2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('auth/2fa/enable', { body: { otp } });
      setTotp(null);
      setMe({ ...me, totp_enabled: true });
      toast('Verificação em duas etapas ativada', 'ok');
    } catch (e) {
      toast(errText(e), 'error');
    }
  };

  return (
    <div className={`${pagePad} pt-[max(1.25rem,env(safe-area-inset-top))] md:pt-6`}>
      <h1 className="mb-5 text-[clamp(1.5rem,6vw,2rem)] font-black">Conta e configurações</h1>
      <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
        <Card title="Perfil" icon={<UserRound className="h-5 w-5" />}>
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="flex items-center gap-4">
              <label className="group relative h-20 w-20 shrink-0 cursor-pointer">
                <Cover url={me.avatar_url} alt="Foto" round className="h-20 w-20" icon={<UserRound className="h-8 w-8" />} />
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"><ImagePlus className="h-6 w-6" /></span>
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => avatar(e.target.files?.[0])} />
              </label>
              <div className="min-w-0">
                <p className="truncate font-semibold">{me.email}</p>
                <p className="text-sm text-muted">{me.role === 'admin' ? 'Administrador' : 'Ouvinte'}</p>
                <Link to={`/user/${me.id}`} className="text-sm text-accent-soft hover:underline">Ver meu perfil público</Link>
              </div>
            </div>
            <Field label="Nome"><input className="input" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Bio"><textarea className="input min-h-20 py-3" maxLength={300} value={bio} onChange={(e) => setBio(e.target.value)} /></Field>
            <button className="btn-primary" disabled={saving}>{saving && <Spinner className="h-4 w-4" />} Salvar perfil</button>
          </form>
        </Card>

        <Card title="Segurança" icon={<ShieldCheck className="h-5 w-5" />}>
          <div className="space-y-4">
            <button className="btn-secondary w-full sm:w-auto" onClick={() => setPwOpen(true)}>Trocar senha</button>
            <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
              <span className="text-sm"><span className="block font-medium">Verificação em duas etapas</span><span className="text-xs text-muted">Código de um app autenticador a cada login</span></span>
              <Toggle checked={me.totp_enabled} onChange={(v) => (v ? start2fa() : setDisable2fa(true))} label="Verificação em duas etapas" />
            </div>
          </div>
        </Card>

        <Card title="Reprodução e privacidade" icon={<History className="h-5 w-5" />}>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm"><span className="block font-medium">Permitir conteúdo explícito</span><span className="text-xs text-muted">Desligado, faixas marcadas com E ficam bloqueadas</span></span>
              <Toggle checked={me.explicit_allowed} onChange={(v) => patch({ explicit_allowed: v })} label="Conteúdo explícito" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm"><span className="block font-medium">Recomendações personalizadas</span><span className="text-xs text-muted">Usa seu histórico para montar o mix</span></span>
              <Toggle checked={me.personalization} onChange={(v) => patch({ personalization: v })} label="Personalização" />
            </div>
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <button className="btn-secondary" onClick={() => downloadAuthed('me/export', 'meus-dados-spotify-x.json').catch((e) => toast(errText(e), 'error'))}><Download className="h-4 w-4" /> Exportar meus dados</button>
              <button className="btn-secondary" onClick={() => setClearHist(true)}><History className="h-4 w-4" /> Apagar histórico</button>
            </div>
          </div>
        </Card>

        <Card title="Sessões e aparelhos" icon={<MonitorSmartphone className="h-5 w-5" />}>
          <p className="mb-2 text-sm font-semibold text-muted">Sessões abertas</p>
          <ul className="mb-3 divide-y divide-line">
            {sessions.data?.items.map((s) => (
              <li key={s.id} className="flex min-h-14 items-center gap-3 py-1">
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-medium">{uaLabel(s.user_agent)} {s.current && <span className="text-accent-soft">· este</span>}</span>
                  <span className="block text-xs text-muted">Último uso {fmtDate(s.last_seen_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </span>
                {!s.current && (
                  <button className="chip min-h-11" onClick={async () => { await api(`me/sessions/${s.id}`, { method: 'DELETE' }).catch(() => {}); sessions.reload(true); }}>Encerrar</button>
                )}
              </li>
            ))}
          </ul>
          <button className="btn-secondary mb-5" onClick={async () => { await api('auth/logout-all', { method: 'POST' }).catch((e) => toast(errText(e), 'error')); toast('Outras sessões encerradas', 'ok'); sessions.reload(true); }}>
            Sair de todos os outros aparelhos
          </button>
          <p className="mb-2 text-sm font-semibold text-muted">Aparelhos com downloads ({devices.data?.items.length || 0}/{devices.data?.max_devices || 5})</p>
          {!devices.data?.items.length ? (
            <p className="text-sm text-muted">Nenhum aparelho com downloads.</p>
          ) : (
            <ul className="divide-y divide-line">
              {devices.data.items.map((d) => (
                <li key={d.id} className="flex min-h-14 items-center gap-3 py-1">
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block truncate font-medium">{d.name} {d.id === thisDevice && <span className="text-accent-soft">· este</span>}</span>
                    <span className="block text-xs text-muted">{d.licenses} faixas · visto {fmtDate(d.last_seen_at)}</span>
                  </span>
                  <button
                    className="chip min-h-11"
                    onClick={async () => {
                      await api(`devices/${d.id}`, { method: 'DELETE' }).catch((e) => toast(errText(e), 'error'));
                      if (d.id === thisDevice) await forgetDevice();
                      devices.reload(true);
                      toast('Aparelho removido e downloads revogados');
                    }}
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <section className="card flex flex-wrap gap-2 p-4 sm:p-5 lg:col-span-2">
          <button className="btn-secondary" onClick={logout}><LogOut className="h-4 w-4" /> Sair</button>
          <button className="btn-secondary text-red-300" onClick={() => setDelAccount(true)}><Trash2 className="h-4 w-4" /> Excluir minha conta</button>
        </section>
      </div>

      <Sheet open={pwOpen} onClose={() => setPwOpen(false)} title="Trocar senha">
        <div className="pt-2">
          <PasswordForm onDone={() => { setPwOpen(false); toast('Senha alterada. As outras sessões foram encerradas.', 'ok'); }} />
        </div>
      </Sheet>
      <Sheet open={!!totp} onClose={() => setTotp(null)} title="Ativar verificação em duas etapas">
        {totp && (
          <form onSubmit={enable2fa} className="space-y-4 pt-2 text-center">
            <p className="text-sm text-muted">Escaneie com o Google Authenticator, Microsoft Authenticator, Authy ou similar.</p>
            <img src={totp.qr} alt="QR do autenticador" className="mx-auto w-[min(60vw,13rem)] rounded-xl bg-white p-2" />
            <p className="break-all text-xs text-muted">Ou digite a chave: <span className="font-mono text-white">{totp.secret}</span></p>
            <input className="input text-center text-2xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} aria-label="Código de 6 dígitos" />
            <button className="btn-primary w-full" disabled={otp.length !== 6}>Confirmar e ativar</button>
          </form>
        )}
      </Sheet>
      <Sheet open={disable2fa} onClose={() => setDisable2fa(false)} title="Desativar duas etapas">
        <form
          className="space-y-4 pt-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api('auth/2fa/disable', { body: { password: pw } });
              setMe({ ...me, totp_enabled: false });
              setDisable2fa(false);
              setPw('');
              toast('Verificação em duas etapas desativada');
            } catch (err) {
              toast(errText(err), 'error');
            }
          }}
        >
          <Field label="Confirme sua senha"><input className="input" type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <button className="btn-danger w-full">Desativar</button>
        </form>
      </Sheet>
      <Confirm open={clearHist} title="Apagar histórico?" text="Apaga o histórico de reprodução e de buscas. As recomendações recomeçam do zero." confirmLabel="Apagar" danger onClose={() => setClearHist(false)}
        onConfirm={async () => { await api('me/history', { method: 'DELETE' }).catch((e) => toast(errText(e), 'error')); setClearHist(false); toast('Histórico apagado', 'ok'); }} />
      <Sheet open={delAccount} onClose={() => setDelAccount(false)} title="Excluir minha conta">
        <form
          className="space-y-4 pt-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api('me', { method: 'DELETE', body: { password: pw } });
              await forgetDevice().catch(() => {});
              await logout();
            } catch (err) {
              toast(errText(err), 'error');
            }
          }}
        >
          <p className="text-sm text-muted">Sua conta, playlists e downloads deixam de funcionar imediatamente; os dados pessoais são apagados em até 30 dias.</p>
          <Field label="Confirme sua senha"><input className="input" type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <button className="btn-danger w-full">Excluir definitivamente</button>
        </form>
      </Sheet>
    </div>
  );
}
