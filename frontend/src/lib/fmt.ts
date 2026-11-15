// Formatadores puros (sem import.meta nem DOM): testáveis com node --test.

export function fmtTime(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
export function fmtTotal(ms: number) {
  const min = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60000) : 0;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}
export function fmtBytes(n: number) {
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
export const albumType = (t: string) => ({ album: 'Álbum', single: 'Single', ep: 'EP', compilation: 'Coletânea' })[t] || 'Álbum';
