import { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { ApiError, errText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Spinner } from '../components/ui';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [needOtp, setNeedOtp] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(email.trim(), password, needOtp ? otp : undefined);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OTP_REQUIRED') {
        setNeedOtp(true);
        setErr(null);
      } else setErr(errText(e, 'Não foi possível entrar'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,#3b1d7a_0%,#09090d_60%)] px-[max(1.25rem,env(safe-area-inset-left))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="mb-4 h-16 w-16" />
          <h1 className="text-[clamp(1.75rem,8vw,2.25rem)] font-black tracking-tight">KeshTune</h1>
          <p className="mt-1 text-sm text-muted">Milhões de músicas? Começamos pelas suas.</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-5 sm:p-6">
          {!needOtp ? (
            <>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">E-mail</span>
                <input className="input" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Senha</span>
                <div className="relative">
                  <input className="input pr-12" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" className="icon-btn absolute right-0 top-0" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShow(!show)}>
                    {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </label>
            </>
          ) : (
            <label className="block">
              <span className="mb-1.5 flex items-center gap-2 text-sm font-medium">
                <Lock className="h-4 w-4" /> Código do autenticador
              </span>
              <input
                className="input text-center text-2xl tracking-[0.4em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                autoFocus
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              />
              <span className="mt-1 block text-xs text-muted">Abra o app autenticador e digite os 6 dígitos.</span>
            </label>
          )}
          {err && <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-200 ring-1 ring-red-900" role="alert">{err}</p>}
          <button className="btn-primary w-full" disabled={busy || (needOtp && otp.length !== 6)}>
            {busy && <Spinner className="h-4 w-4" />} Entrar
          </button>
          {needOtp && (
            <button type="button" className="w-full min-h-11 text-sm text-muted hover:text-white" onClick={() => { setNeedOtp(false); setOtp(''); }}>
              Voltar
            </button>
          )}
        </form>
        <p className="mt-6 text-center text-xs text-muted">Não há cadastro público. As contas são criadas pelo administrador.</p>
      </div>
    </div>
  );
}
