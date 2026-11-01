/**
 * Reprodução offline na web (seção 4): arquivos cifrados (AES-256-GCM) gravados numa pasta
 * escolhida pelo usuário (cartão SD / disco externo) via File System Access API.
 * A chave de cada faixa fica no IndexedDB como CryptoKey NÃO exportável.
 */
import { useEffect, useState } from 'react';
import { api, ApiError, NetworkError } from './api';
import { dlAll, dlDel, dlGet, dlPut, kvDel, kvGet, kvSet } from './idb';
import type { Track } from './types';

export type DlState = 'QUEUED' | 'DOWNLOADING' | 'READY' | 'EXPIRING' | 'EXPIRED' | 'REMOVED' | 'FAILED';
export type DlRecord = {
  track_id: string;
  license_id: string;
  track: Track;
  key: CryptoKey;
  expires_at: string;
  state: 'QUEUED' | 'DOWNLOADING' | 'READY' | 'REMOVED' | 'FAILED';
  progress?: number;
  error?: string;
  attempts: number;
  mime: string;
  checksum: string | null;
  size: number;
  downloaded_at?: string;
};

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?: (o: { mode: string }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: string }) => Promise<PermissionState>;
};

export const offlineSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window && !!window.crypto?.subtle;

const emitChange = () => window.dispatchEvent(new Event('spx:downloads'));

// ---------- relógio confiável: nunca anda para trás em relação ao último horário do servidor ----------
let serverSkew = 0;
export async function noteServerTime(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isNaN(t)) {
    serverSkew = t - Date.now();
    const last = (await kvGet<number>('lastServerTime')) || 0;
    if (t > last) await kvSet('lastServerTime', t);
  }
}
async function trustedNow() {
  const last = (await kvGet<number>('lastServerTime')) || 0;
  return Math.max(Date.now() + serverSkew, last);
}

export function effectiveState(r: DlRecord, now = Date.now()): DlState {
  if (r.state !== 'READY') return r.state;
  const exp = Date.parse(r.expires_at);
  if (exp <= now) return 'EXPIRED';
  if (exp - now < 7 * 86400000) return 'EXPIRING';
  return 'READY';
}

// ---------- pasta de destino ----------
export async function getFolder(): Promise<DirHandle | null> {
  return (await kvGet<DirHandle>('dir')) || null;
}
export async function folderStatus(): Promise<{ name: string | null; permission: PermissionState | 'none' }> {
  const h = await getFolder();
  if (!h) return { name: null, permission: 'none' };
  const p = h.queryPermission ? await h.queryPermission({ mode: 'readwrite' }) : 'granted';
  return { name: h.name, permission: p };
}
export async function chooseFolder() {
  const h = (await (window as any).showDirectoryPicker({ id: 'spotify-x', mode: 'readwrite' })) as DirHandle;
  await kvSet('dir', h);
  await writeIndex();
  emitChange();
  return h.name;
}
async function ensurePermission(h: DirHandle, interactive: boolean) {
  if (!h.queryPermission) return true;
  let p = await h.queryPermission({ mode: 'readwrite' });
  if (p === 'prompt' && interactive && h.requestPermission) p = await h.requestPermission({ mode: 'readwrite' });
  return p === 'granted';
}
async function folderOrThrow(interactive = true) {
  const h = await getFolder();
  if (!h) throw new Error('Escolha primeiro a pasta do cartão SD ou disco externo em Downloads.');
  if (!(await ensurePermission(h, interactive))) throw new Error('Permita o acesso à pasta de downloads (cartão SD/disco externo).');
  return h;
}
/** Índice espelhado na unidade externa (metadados sem chaves). */
async function writeIndex() {
  try {
    const h = await getFolder();
    if (!h || !(await ensurePermission(h, false))) return;
    const all = await dlAll<DlRecord>();
    const f = await h.getFileHandle('spotify-x-index.json', { create: true });
    const w = await (f as any).createWritable();
    await w.write(JSON.stringify({ app: 'spotify-x', updated_at: new Date().toISOString(), items: all.map(({ key: _k, ...r }) => r) }));
    await w.close();
  } catch {
    /* sem permissão no momento */
  }
}

// ---------- aparelho ----------
function deviceName() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` no ${os}` : ''}`;
}
export async function getDeviceId(create = true): Promise<string | null> {
  let id = await kvGet<string>('deviceId');
  if (!id && create) {
    const d = await api<{ id: string }>('devices', { body: { name: deviceName(), platform: 'web', model: navigator.userAgent.slice(0, 120) } });
    id = d.id;
    await kvSet('deviceId', id);
  }
  return id || null;
}

// ---------- downloads ----------
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function sha256hex(buf: ArrayBuffer) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let running = 0;
const MAX_PARALLEL = 2;

export async function downloadTracks(tracks: Track[]) {
  const wanted = tracks.filter((t) => t.downloadable);
  if (!wanted.length) throw new Error('Nenhuma faixa pode ser baixada (faixas do YouTube só tocam online).');
  await folderOrThrow(true);
  const deviceId = await getDeviceId(true);
  const existing = new Map((await dlAll<DlRecord>()).map((r) => [r.track_id, r]));
  const todo = wanted.filter((t) => {
    const r = existing.get(t.id);
    return !r || r.state === 'FAILED' || effectiveState(r) === 'EXPIRED';
  });
  let queued = 0;
  for (let i = 0; i < todo.length; i += 100) {
    const batch = todo.slice(i, i + 100);
    const res = await api<{ server_time: string; licenses: any[] }>('offline/licenses', {
      body: { device_id: deviceId, track_ids: batch.map((t) => t.id) },
    });
    await noteServerTime(res.server_time);
    for (const l of res.licenses) {
      const key = await crypto.subtle.importKey('raw', b64(l.key), 'AES-GCM', false, ['decrypt']);
      await dlPut({
        track_id: l.track_id, license_id: l.license_id, track: l.track, key, expires_at: l.expires_at, state: 'QUEUED',
        attempts: 0, mime: l.mime, checksum: l.checksum, size: l.size,
      } satisfies DlRecord);
      queued++;
    }
  }
  emitChange();
  pump();
  return queued;
}

async function pump() {
  while (running < MAX_PARALLEL) {
    const next = (await dlAll<DlRecord>()).find((r) => r.state === 'QUEUED');
    if (!next) return;
    running++;
    next.state = 'DOWNLOADING';
    next.progress = 0;
    await dlPut(next);
    emitChange();
    fetchOne(next).finally(() => {
      running--;
      pump();
    });
  }
}

async function fetchOne(rec: DlRecord) {
  try {
    const dir = await folderOrThrow(false);
    const r = await api<Response>(`offline/download/${rec.license_id}`, { raw: true });
    const total = Number(r.headers.get('content-length')) || rec.size;
    const reader = r.body!.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    let lastEmit = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (Date.now() - lastEmit > 400) {
        rec.progress = Math.min(99, Math.round((got / total) * 100));
        await dlPut(rec);
        emitChange();
        lastEmit = Date.now();
      }
    }
    const enc = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) {
      enc.set(c, off);
      off += c.length;
    }
    // integridade: o GCM valida a autenticidade e o hash confere com o do servidor
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: enc.slice(0, 12) }, rec.key, enc.slice(12));
    if (rec.checksum && (await sha256hex(plain)) !== rec.checksum) throw new Error('Arquivo corrompido (hash não confere)');
    const fh = await dir.getFileHandle(`${rec.track_id}.spx`, { create: true });
    const w = await (fh as any).createWritable();
    await w.write(enc);
    await w.close();
    Object.assign(rec, { state: 'READY', progress: 100, error: undefined, downloaded_at: new Date().toISOString() });
    await dlPut(rec);
  } catch (e) {
    rec.attempts += 1;
    const msg = e instanceof NetworkError ? 'Sem conexão' : e instanceof ApiError ? e.message : (e as Error).name === 'QuotaExceededError' ? 'Sem espaço na unidade' : (e as Error).message;
    if (e instanceof ApiError && (e.code === 'LICENSE_INVALID' || e.code === 'TRACK_UNAVAILABLE')) rec.attempts = 3;
    Object.assign(rec, { state: rec.attempts < 3 ? 'QUEUED' : 'FAILED', error: msg, progress: 0 });
    await dlPut(rec);
    if (rec.attempts < 3) await new Promise((r) => setTimeout(r, 2000 * rec.attempts));
  }
  emitChange();
  writeIndex();
}

export async function retryFailed() {
  for (const r of await dlAll<DlRecord>()) {
    if (r.state === 'FAILED' || r.state === 'QUEUED' || r.state === 'DOWNLOADING') {
      r.state = 'QUEUED';
      r.attempts = 0;
      await dlPut(r);
    }
  }
  emitChange();
  pump();
}

export async function removeDownload(trackId: string) {
  const h = await getFolder();
  if (h && (await ensurePermission(h, true).catch(() => false))) {
    await h.removeEntry(`${trackId}.spx`).catch(() => {});
  }
  await dlDel(trackId);
  emitChange();
  writeIndex();
}
export async function removeAllDownloads() {
  for (const r of await dlAll<DlRecord>()) await removeDownload(r.track_id);
}

/** Abre o arquivo cifrado da unidade externa e devolve uma URL tocável (só dentro do app). */
export async function offlineUrl(trackId: string): Promise<string | null> {
  const rec = await dlGet<DlRecord>(trackId);
  if (!rec) return null;
  const st = effectiveState(rec, await trustedNow());
  if (st === 'EXPIRED') throw new Error('A licença deste download venceu. Conecte-se para renovar.');
  if (st !== 'READY' && st !== 'EXPIRING') return null;
  const h = await getFolder();
  if (!h || !(await ensurePermission(h, true))) throw new Error('Conecte o cartão SD/disco externo e permita o acesso à pasta.');
  let file: File;
  try {
    file = await (await h.getFileHandle(`${trackId}.spx`)).getFile();
  } catch {
    throw new Error('Arquivo não encontrado na unidade externa (ela foi removida?).');
  }
  const enc = new Uint8Array(await file.arrayBuffer());
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: enc.slice(0, 12) }, rec.key, enc.slice(12));
  return URL.createObjectURL(new Blob([plain], { type: rec.mime || 'audio/mpeg' }));
}

export async function isDownloaded(trackId: string) {
  const r = await dlGet<DlRecord>(trackId);
  return !!r && ['READY', 'EXPIRING'].includes(effectiveState(r));
}

/** Sincroniza com o servidor ao reconectar: renova, apaga revogadas/retiradas e envia eventos pendentes. */
export async function syncOffline(events: unknown[] = []) {
  const deviceId = await getDeviceId(false);
  if (!deviceId) return null;
  const all = await dlAll<DlRecord>();
  const res = await api<any>('offline/sync', { body: { device_id: deviceId, license_ids: all.map((r) => r.license_id), events } });
  await noteServerTime(res.server_time);
  const byLic = new Map(all.map((r) => [r.license_id, r]));
  for (const v of res.valid) {
    const r = byLic.get(v.license_id);
    if (r) {
      r.expires_at = v.expires_at;
      await dlPut(r);
    }
  }
  for (const id of [...res.revoked, ...res.removed]) {
    const r = byLic.get(id);
    if (r) await removeDownload(r.track_id).catch(() => dlDel(r.track_id));
  }
  if (res.device_revoked) await kvDel('deviceId');
  emitChange();
  writeIndex();
  // retoma downloads interrompidos (app fechado ou queda de rede)
  if (all.some((r) => r.state === 'QUEUED' || r.state === 'DOWNLOADING')) {
    for (const r of await dlAll<DlRecord>()) if (r.state === 'DOWNLOADING') { r.state = 'QUEUED'; await dlPut(r); }
    pump();
  }
  return res;
}

export async function forgetDevice() {
  await removeAllDownloads();
  await kvDel('deviceId');
}

export function useDownloads() {
  const [list, setList] = useState<DlRecord[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => dlAll<DlRecord>().then((l) => alive && setList(l)).catch(() => {});
    load();
    window.addEventListener('spx:downloads', load);
    return () => {
      alive = false;
      window.removeEventListener('spx:downloads', load);
    };
  }, []);
  return list;
}

// ---------- modo offline ----------
export function isOfflineMode() {
  return localStorage.getItem('spx.offlineMode') === '1' || !navigator.onLine;
}
export function setOfflineMode(v: boolean) {
  localStorage.setItem('spx.offlineMode', v ? '1' : '0');
  window.dispatchEvent(new Event('spx:netmode'));
}
export function useOfflineMode() {
  const [off, setOff] = useState(isOfflineMode());
  useEffect(() => {
    const u = () => setOff(isOfflineMode());
    window.addEventListener('online', u);
    window.addEventListener('offline', u);
    window.addEventListener('spx:netmode', u);
    return () => {
      window.removeEventListener('online', u);
      window.removeEventListener('offline', u);
      window.removeEventListener('spx:netmode', u);
    };
  }, []);
  return off;
}
