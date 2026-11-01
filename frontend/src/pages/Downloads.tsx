import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CircleArrowDown, FolderOpen, HardDrive, RefreshCw, Trash2, WifiOff } from 'lucide-react';
import { api } from '../lib/api';
import { artistNames, fmtBytes, fmtDate } from '../lib/format';
import {
  chooseFolder, effectiveState, folderStatus, offlineSupported, removeAllDownloads, removeDownload, retryFailed, setOfflineMode, syncOffline, useDownloads, useOfflineMode,
} from '../lib/offline';
import { usePlayer } from '../lib/player';
import { useToast } from '../lib/toast';
import { Confirm, Cover, Empty, Toggle } from '../components/ui';
import { pagePad } from '../components/Layout';

const LABEL: Record<string, string> = {
  QUEUED: 'Na fila', DOWNLOADING: 'Baixando', READY: 'Baixada', EXPIRING: 'Licença vencendo — conecte-se', EXPIRED: 'Licença vencida', FAILED: 'Falhou', REMOVED: 'Retirada',
};

export default function Downloads() {
  const list = useDownloads();
  const player = usePlayer();
  const toast = useToast();
  const offline = useOfflineMode();
  const [folder, setFolder] = useState<{ name: string | null; permission: string }>({ name: null, permission: 'none' });
  const [confirmAll, setConfirmAll] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [cfg, setCfg] = useState<{ max_offline_tracks: number; max_offline_devices: number; offline_enabled: boolean } | null>(null);
  const supported = offlineSupported();

  const refreshFolder = () => folderStatus().then(setFolder).catch(() => {});
  useEffect(() => {
    refreshFolder();
    api('config').then(setCfg).catch(() => {});
  }, []);

  const sorted = useMemo(() => [...list].sort((a, b) => String(b.downloaded_at || '').localeCompare(String(a.downloaded_at || ''))), [list]);
  const ready = sorted.filter((r) => ['READY', 'EXPIRING'].includes(effectiveState(r)));
  const size = ready.reduce((s, r) => s + (r.size || 0), 0);
  const failed = sorted.filter((r) => r.state === 'FAILED').length;

  const pick = async () => {
    try {
      const name = await chooseFolder();
      toast(`Downloads serão gravados em "${name}"`, 'ok');
      refreshFolder();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'error');
    }
  };
  const sync = async () => {
    setSyncing(true);
    try {
      const r = await syncOffline();
      toast(r ? `Licenças renovadas (${r.valid.length})` : 'Nada para sincronizar', 'ok');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className={`${pagePad} pt-[max(1.25rem,env(safe-area-inset-top))] md:pt-6`}>
      <h1 className="mb-1 text-[clamp(1.5rem,6vw,2rem)] font-black">Downloads</h1>
      <p className="mb-5 text-sm text-muted">Ouça sem internet por até 30 dias. Os arquivos ficam cifrados e só tocam neste app.</p>

      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <div className="card p-4">
          <div className="mb-3 flex items-center gap-3">
            <HardDrive className="h-6 w-6 shrink-0 text-accent-soft" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Unidade de armazenamento</p>
              <p className="truncate text-sm text-muted">
                {!supported ? 'Este navegador não permite gravar em cartão SD/disco externo.' : folder.name ? `Pasta: ${folder.name}${folder.permission !== 'granted' ? ' (permissão pendente)' : ''}` : 'Nenhuma pasta escolhida'}
              </p>
            </div>
          </div>
          {supported ? (
            <>
              <button className="btn-secondary w-full sm:w-auto" onClick={pick}><FolderOpen className="h-4 w-4" /> {folder.name ? 'Trocar pasta' : 'Escolher pasta do cartão SD / disco externo'}</button>
              <p className="mt-2 text-xs text-muted">Escolha uma pasta no cartão SD ou disco USB. Nada é gravado na memória interna; sem a unidade conectada, o offline fica indisponível.</p>
            </>
          ) : (
            <p className="text-xs text-muted">Use o Chrome ou o Edge no computador para baixar (Safari, Firefox e navegadores de celular ainda não dão acesso a pastas externas). No celular, as músicas continuam tocando online.</p>
          )}
        </div>
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-3">
              <WifiOff className="h-6 w-6 shrink-0 text-accent-soft" />
              <span className="min-w-0"><span className="block font-semibold">Modo offline</span><span className="block text-sm text-muted">Mostra e toca só o que foi baixado</span></span>
            </span>
            <Toggle checked={localStorage.getItem('spx.offlineMode') === '1'} onChange={(v) => setOfflineMode(v)} label="Modo offline" />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span>{ready.length} faixas · {fmtBytes(size)}</span>
            {cfg && <span>Limite: {cfg.max_offline_tracks.toLocaleString('pt-BR')} faixas em {cfg.max_offline_devices} aparelhos</span>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={offline || syncing} onClick={sync}><RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} /> Renovar licenças</button>
            {failed > 0 && <button className="btn-secondary" disabled={offline} onClick={retryFailed}><RefreshCw className="h-4 w-4" /> Tentar falhas ({failed})</button>}
            {list.length > 0 && <button className="btn-secondary text-red-300" onClick={() => setConfirmAll(true)}><Trash2 className="h-4 w-4" /> Remover tudo</button>}
          </div>
        </div>
      </div>

      {!list.length ? (
        <Empty icon={<CircleArrowDown className="h-10 w-10" />} title="Nenhum download" text="Toque no botão de download em uma playlist, álbum ou música (as do YouTube só tocam online)." />
      ) : (
        <>
          {ready.length > 0 && (
            <button className="btn-primary mb-4" onClick={() => player.playTracks(ready.map((r) => r.track), 0, { type: 'downloads', name: 'Downloads' })}>Tocar baixadas</button>
          )}
          <ul className="space-y-1">
            {sorted.map((r) => {
              const st = effectiveState(r);
              return (
                <li key={r.track_id} className="flex min-h-16 items-center gap-3 rounded-lg p-2 hover:bg-white/[0.04]">
                  <button className="flex min-w-0 flex-1 items-center gap-3 text-left" disabled={!['READY', 'EXPIRING'].includes(st)} onClick={() => player.playTracks(ready.map((x) => x.track), ready.findIndex((x) => x.track_id === r.track_id), { type: 'downloads', name: 'Downloads' })}>
                    <Cover url={offline ? null : r.track.cover_url} alt={r.track.title} className="h-12 w-12 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.track.title}</span>
                      <span className="block truncate text-xs text-muted">{artistNames(r.track.artists)}</span>
                      <span className={`mt-0.5 flex items-center gap-1 text-xs ${st === 'FAILED' || st === 'EXPIRED' ? 'text-red-300' : st === 'EXPIRING' ? 'text-amber-300' : 'text-accent-soft'}`}>
                        {(st === 'FAILED' || st === 'EXPIRING' || st === 'EXPIRED') && <AlertTriangle className="h-3 w-3" />}
                        {LABEL[st]}{st === 'DOWNLOADING' ? ` ${r.progress ?? 0}%` : ''}{st === 'FAILED' && r.error ? `: ${r.error}` : ''}
                        {(st === 'READY' || st === 'EXPIRING') && ` · até ${fmtDate(r.expires_at)}`}
                      </span>
                      {st === 'DOWNLOADING' && <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full bg-accent" style={{ width: `${r.progress ?? 0}%` }} /></span>}
                    </span>
                  </button>
                  <button className="icon-btn text-muted" aria-label={`Remover download de ${r.track.title}`} onClick={() => removeDownload(r.track_id)}><Trash2 className="h-5 w-5" /></button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <Confirm open={confirmAll} title="Remover todos os downloads?" text="Os arquivos são apagados da unidade externa. Você pode baixar de novo depois." confirmLabel="Remover" danger onClose={() => setConfirmAll(false)} onConfirm={async () => { await removeAllDownloads(); setConfirmAll(false); toast('Downloads removidos'); }} />
    </div>
  );
}
