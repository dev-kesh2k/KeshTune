/** Fila local de ações feitas sem conexão (curtir, playlist, contagens) — reenviadas ao reconectar. */
import { api, NetworkError } from './api';
import { isOfflineMode, syncOffline } from './offline';

type Op = { path: string; method: string; body?: unknown; at: number };
const OPS = 'spx.pendingOps';
const EVENTS = 'spx.pendingEvents';

const read = <T,>(k: string): T[] => {
  try {
    return JSON.parse(localStorage.getItem(k) || '[]');
  } catch {
    return [];
  }
};
const write = (k: string, v: unknown[]) => localStorage.setItem(k, JSON.stringify(v.slice(-5000)));

/** Executa a ação; sem rede, guarda na fila e retorna como se tivesse dado certo. */
export async function mutate(path: string, method: string, body?: unknown) {
  if (isOfflineMode()) {
    write(OPS, [...read<Op>(OPS), { path, method, body, at: Date.now() }]);
    return { queued: true };
  }
  try {
    return await api(path, { method, body });
  } catch (e) {
    if (e instanceof NetworkError) {
      write(OPS, [...read<Op>(OPS), { path, method, body, at: Date.now() }]);
      return { queued: true };
    }
    throw e;
  }
}

export function queueEvent(ev: Record<string, unknown>) {
  write(EVENTS, [...read(EVENTS), ev]);
}
export const pendingCount = () => read(OPS).length + read(EVENTS).length;

let flushing = false;
export async function flushPending() {
  if (flushing || isOfflineMode()) return;
  flushing = true;
  try {
    const ops = read<Op>(OPS);
    const left: Op[] = [];
    for (const [i, op] of ops.entries()) {
      try {
        await api(op.path, { method: op.method, body: op.body });
      } catch (e) {
        if (e instanceof NetworkError) {
          left.push(...ops.slice(i));
          break;
        }
        // conflito/erro de validação: descarta (o servidor é a fonte da verdade)
      }
    }
    write(OPS, left);
    const events = read(EVENTS);
    if (events.length) {
      try {
        const res = await syncOffline(events);
        if (!res) await api('playback/events', { body: { events } });
        write(EVENTS, read(EVENTS).slice(events.length));
      } catch (e) {
        if (!(e instanceof NetworkError)) write(EVENTS, read(EVENTS).slice(events.length));
      }
    } else {
      await syncOffline([]).catch(() => {});
    }
  } finally {
    flushing = false;
  }
}
