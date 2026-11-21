import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api, errText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field, Spinner } from '../components/ui';

export function PasswordForm({ onDone, forced }: { onDone: () => void; forced?: boolean }) {
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (pw !== pw2) return setErr('As senhas novas não conferem');
    setBusy(true);
    try {
      await api('auth/change-password', { body: { current_password: cur, new_password: pw } });
      onDone();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={forced ? 'Senha temporária' : 'Senha atual'}>
        <input className="input" type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} />
      </Field>
      <Field label="Nova senha" hint="Mínimo de 8 caracteres, com letras e números.">
        <input className="input" type="password" autoComplete="new-password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
      <Field label="Repita a nova senha">
        <input className="input" type="password" autoComplete="new-password" required minLength={8} value={pw2} onChange={(e) => setPw2(e.target.value)} />
      </Field>
      {err && <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-200 ring-1 ring-red-900" role="alert">{err}</p>}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy && <Spinner className="h-4 w-4" />} Salvar nova senha
      </button>
    </form>
  );
}

export default function ChangePassword() {
  const { reload, logout, me } = useAuth();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-[max(1.25rem,env(safe-area-inset-left))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <KeyRound className="mx-auto mb-3 h-10 w-10 text-accent-soft" />
          <h1 className="text-2xl font-bold">Crie sua senha</h1>
          <p className="mt-1 text-sm text-muted">Olá, {me?.display_name}! No primeiro acesso é obrigatório trocar a senha temporária.</p>
        </div>
        <div className="card p-5">
          <PasswordForm forced onDone={reload} />
        </div>
        <button className="mt-4 w-full min-h-11 text-sm text-muted hover:text-white" onClick={logout}>
          Sair
        </button>
      </div>
    </div>
  );
}
