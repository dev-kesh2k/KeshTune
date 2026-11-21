import { api, API, getTokens } from './api';

/** Conecta ao canal de eventos (SSE) e repassa como eventos do window: spx:<evento>. */
export function startRealtime() {
  let es: EventSource | null = null;
  let stopped = false;
  let timer: number | undefined;
  const connect = async () => {
    if (stopped || !getTokens()) return;
    try {
      const { ticket } = await api<{ ticket: string }>('events/ticket', { method: 'POST' });
      es = new EventSource(`${API}events?ticket=${encodeURIComponent(ticket)}`);
      for (const ev of ['playlist.updated', 'library.changed', 'account.restricted', 'download.revoked']) {
        es.addEventListener(ev, (m) => {
          try {
            window.dispatchEvent(new CustomEvent(`spx:${ev}`, { detail: JSON.parse((m as MessageEvent).data) }));
          } catch {
            /* */
          }
        });
      }
      es.onerror = () => {
        es?.close();
        es = null;
        if (!stopped) timer = window.setTimeout(connect, 5000);
      };
    } catch {
      if (!stopped) timer = window.setTimeout(connect, 10000);
    }
  };
  void connect();
  const online = () => {
    if (!es) void connect();
  };
  window.addEventListener('online', online);
  return () => {
    stopped = true;
    clearTimeout(timer);
    es?.close();
    window.removeEventListener('online', online);
  };
}

export function onRealtime<T = any>(event: string, fn: (d: T) => void) {
  const h = (e: Event) => fn((e as CustomEvent).detail);
  window.addEventListener(`spx:${event}`, h);
  return () => window.removeEventListener(`spx:${event}`, h);
}
