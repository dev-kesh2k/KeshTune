export const BASE = import.meta.env.BASE_URL; // termina com "/"
export const API = `${BASE}api/`;

export class ApiError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export class NetworkError extends Error {
  constructor() {
    super('Sem conexão com a internet');
  }
}

const KEY = 'spx.auth';
type Tokens = { access_token: string; refresh_token: string; expires_at: number };

export function getTokens(): Tokens | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}
export function setTokens(t: { access_token: string; refresh_token: string; expires_in: number } | null) {
  if (!t) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000 }));
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  const t = getTokens();
  if (!t) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const r = await fetch(`${API}auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: t.refresh_token }),
        });
        if (!r.ok) {
          if (r.status === 401 || r.status === 403) {
            setTokens(null);
            window.dispatchEvent(new Event('spx:logout'));
          }
          return false;
        }
        setTokens(await r.json());
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

type Opts = { method?: string; body?: unknown; form?: FormData; raw?: boolean; signal?: AbortSignal };

export async function api<T = any>(path: string, opts: Opts = {}, retry = true): Promise<T> {
  let t = getTokens();
  if (t && t.expires_at - Date.now() < 30000 && retry) {
    await refresh();
    t = getTokens();
  }
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t.access_token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let r: Response;
  try {
    r = await fetch(`${API}${path.replace(/^\//, '')}`, {
      method: opts.method || (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
      headers,
      body: opts.form ? opts.form : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new NetworkError();
  }
  if (r.status === 401 && retry && t) {
    const data = await r.clone().json().catch(() => ({}));
    if (['TOKEN_EXPIRED', 'SESSION_EXPIRED'].includes(data?.error?.code) && (await refresh())) return api<T>(path, opts, false);
  }
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    const err = data?.error || {};
    if (err.code === 'ACCOUNT_RESTRICTED' || (r.status === 401 && t && !path.startsWith('auth/login'))) {
      if (err.code !== 'INVALID_CREDENTIALS' && err.code !== 'OTP_REQUIRED' && err.code !== 'OTP_INVALID') {
        setTokens(null);
        window.dispatchEvent(new Event('spx:logout'));
      }
    }
    if (err.code === 'PASSWORD_CHANGE_REQUIRED') window.dispatchEvent(new Event('spx:must-change'));
    const { code, message, request_id, ...extra } = err;
    throw new ApiError(r.status, code || 'HTTP_' + r.status, message || `Erro ${r.status}`, { request_id, ...extra });
  }
  if (opts.raw) return r as unknown as T;
  if (r.status === 204) return undefined as T;
  const ct = r.headers.get('content-type') || '';
  return (ct.includes('json') ? r.json() : r.text()) as Promise<T>;
}

export function errText(e: unknown, fallback = 'Algo deu errado') {
  if (e instanceof ApiError || e instanceof NetworkError) return e.message;
  return fallback;
}

/** Baixa um arquivo autenticado (CSV/JSON) e dispara o download no navegador. */
export async function downloadAuthed(path: string, filename: string) {
  const r = await api<Response>(path, { raw: true });
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
