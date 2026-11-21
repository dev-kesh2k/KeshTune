import { useEffect, useState } from 'react';
import { FolderOpen, HardDrive, RefreshCw, Trash2, WifiOff } from 'lucide-react';
import { api } from '../lib/api';
import { fmtBytes } from '../lib/format';
import {
  chooseFolder, effectiveState, folderStatus, offlineSupported, removeAllDownloads, retryFailed, setOfflineMode, syncOffline, useDownloads, useOfflineMode,
} from '../lib/offline';
import { useToast } from '../lib/toast';
import { Confirm, Toggle } from './ui';

/** Pasta de downloads, modo offline e licenças (fica em Configurações). */
export function DownloadSettings() {
  const list = useDownloads();
  const toast = useToast();
  const offline = useOfflineMode();
  const [folder, setFolder] = useState<{ name: string | null; permission: string }>({ name: null, permission: 'none' });
  const [confirmAll, setConfirmAll] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [cfg, setCfg] = useState<{ max_offline_tracks: number; max_offline_devices: number } | null>(null);
  const supported = offlineSupported();

  const refreshFolder = () => folderStatus().then(setFolder).catch(() => {});
  useEffect(() => {
    void refreshFolder();
    api('config').then(setCfg).catch(() => {});
  }, []);

  const ready = list.filter((r) => ['READY', 'EXPIRING'].includes(effectiveState(r)));
  const size = ready.reduce((s, r) => s + (r.size || 0), 0);
  const failed = list.filter((r) => r.state === 'FAILED').length;

  const pick = async () => {
    try {
      const name = await chooseFolder();
      toast(`Downloads serão gravados em "${name}"`, 'ok');
      void refreshFolder();
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
    <div className="grid gap-5 lg:grid-cols-2">
      <div>
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
      <div>
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
      <Confirm open={confirmAll} title="Remover todos os downloads?" text="Os arquivos são apagados da unidade externa. Você pode baixar de novo depois." confirmLabel="Remover" danger onClose={() => setConfirmAll(false)} onConfirm={async () => { await removeAllDownloads(); setConfirmAll(false); toast('Downloads removidos'); }} />
    </div>
  );
}
