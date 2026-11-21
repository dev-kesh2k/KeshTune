import { BASE } from './api';
import type { ArtistRef } from './types';

export { albumType, fmtBytes, fmtTime, fmtTotal } from './fmt';

export function mediaUrl(u: string | null | undefined) {
  if (!u) return null;
  if (/^https?:\/\//.test(u) || u.startsWith('blob:') || u.startsWith('data:')) return u;
  return `${BASE}api/media/${u}`;
}
export const artistNames = (a: ArtistRef[] | undefined) => (a || []).map((x) => x.name).join(', ');
const DATE_OPTS: Intl.DateTimeFormatOptions = Object.freeze({ day: '2-digit', month: 'short', year: 'numeric' });
export function fmtDate(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = DATE_OPTS) {
  if (!d) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d);
  return date.toLocaleDateString('pt-BR', opts);
}
export const shareUrl = (path: string) => `${location.origin}${BASE}${path.replace(/^\//, '')}`;
