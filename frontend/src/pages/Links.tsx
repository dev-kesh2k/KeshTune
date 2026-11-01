import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { api, errText } from '../lib/api';
import { useToast } from '../lib/toast';
import { ErrorBox, PageLoading, Spinner } from '../components/ui';

/** /s/:token — link de compartilhamento de playlist. */
export function SharedLink() {
  const { token } = useParams();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ id: string }>(`playlists/link/${token}`).then((r) => nav(`/playlist/${r.id}`, { replace: true })).catch((e) => setErr(errText(e)));
  }, [token, nav]);
  return err ? <ErrorBox text={err} /> : <PageLoading />;
}

/** /invite/:token — convite para playlist colaborativa. */
export function Invite() {
  const { token } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [info, setInfo] = useState<{ id: string; name: string; owner_name: string; already_member: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<typeof info>(`playlists/invite/${token}`).then(setInfo).catch((e) => setErr(errText(e)));
  }, [token]);
  if (err) return <ErrorBox text={err} />;
  if (!info) return <PageLoading />;
  return (
    <div className="flex min-h-[60dvh] items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6 text-center">
        <UserPlus className="mx-auto mb-3 h-10 w-10 text-accent-soft" />
        <h1 className="mb-1 break-words text-xl font-bold">{info.name}</h1>
        <p className="mb-5 text-sm text-muted">{info.owner_name} convidou você para colaborar nesta playlist.</p>
        {info.already_member ? (
          <button className="btn-primary w-full" onClick={() => nav(`/playlist/${info.id}`)}>Abrir playlist</button>
        ) : (
          <button
            className="btn-primary w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`playlists/invite/${token}/accept`, { method: 'POST' });
                window.dispatchEvent(new Event('spx:playlists-changed'));
                toast('Agora você colabora nesta playlist', 'ok');
                nav(`/playlist/${info.id}`, { replace: true });
              } catch (e) {
                toast(errText(e), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner className="h-4 w-4" />} Aceitar convite
          </button>
        )}
      </div>
    </div>
  );
}
