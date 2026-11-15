import { useEffect, type ReactNode } from 'react';
import { Loader2, Music2, WifiOff, X } from 'lucide-react';
import { mediaUrl } from '../lib/format';

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} aria-label="Carregando" />;
}
export function PageLoading() {
  return (
    <div className="flex min-h-[40dvh] items-center justify-center text-muted" role="status" aria-live="polite" aria-busy="true">
      <Spinner className="h-8 w-8" />
    </div>
  );
}
export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-14 text-center">
      <div className="text-muted" aria-hidden="true">{icon || <Music2 className="h-10 w-10" />}</div>
      <p className="text-lg font-semibold">{title}</p>
      {text && <p className="max-w-sm text-sm text-muted">{text}</p>}
      {action}
    </div>
  );
}
export function ErrorBox({ text, onRetry, offline }: { text: string; onRetry?: () => void; offline?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center" role="alert">
      {offline && <WifiOff className="h-10 w-10 text-muted" aria-hidden="true" />}
      <p className="max-w-sm text-sm text-muted">{text}</p>
      {onRetry && (
        <button className="btn-secondary" onClick={onRetry}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}

/** Bottom sheet no celular, modal centralizado no desktop. */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', k);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <button className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label="Fechar" onClick={onClose} />
      <div
        className={`relative flex max-h-[90dvh] w-full flex-col rounded-t-3xl bg-surface2 ring-1 ring-line md:rounded-2xl ${wide ? 'md:max-w-2xl' : 'md:max-w-md'}`}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-line md:hidden" />
        {title !== undefined && (
          <div className="flex shrink-0 items-center gap-2 px-5 pb-2 pt-3">
            <div className="min-w-0 flex-1 truncate text-lg font-bold">{title}</div>
            <button className="icon-btn -mr-2" aria-label="Fechar" onClick={onClose}>
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-1">{children}</div>
      </div>
    </div>
  );
}

export function Confirm({
  open, title, text, confirmLabel = 'Confirmar', danger, onConfirm, onClose, busy,
}: { open: boolean; title: string; text?: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void; busy?: boolean }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {text && <div className="mb-5 text-sm text-muted">{text}</div>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button className="btn-secondary" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy} onClick={onConfirm}>
          {busy && <Spinner className="h-4 w-4" />} {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

// Miniaturas do YouTube: em capas pequenas (até h-14) e mosaicos usa a versão 320×180 (~12 KB, sem faixas pretas)
// em vez da 480×360 (~30 KB) — numa lista de 100 faixas são uns 2 MB a menos.
const SMALL = /(^|\s)h-(8|9|10|11|12|14)(\s|$)/;
const ytSmall = (u: string) => u.replace(/^(https:\/\/i\.ytimg\.com\/vi\/[\w-]+\/)hqdefault\.jpg$/, '$1mqdefault.jpg');

export function Cover({
  url, mosaic, alt, className = '', round, icon,
}: { url?: string | null; mosaic?: string[]; alt: string; className?: string; round?: boolean; icon?: ReactNode }) {
  const shape = round ? 'rounded-full' : 'rounded-md';
  const small = SMALL.test(className);
  if (url) return <img src={mediaUrl(small ? ytSmall(url) : url)!} alt={alt} loading="lazy" decoding="async" className={`aspect-square bg-surface2 object-cover ${shape} ${className}`} />;
  if (mosaic && mosaic.length >= 4)
    return (
      <div className={`grid aspect-square grid-cols-2 overflow-hidden bg-surface2 ${shape} ${className}`} role="img" aria-label={alt}>
        {mosaic.slice(0, 4).map((m, i) => (
          <img key={i} src={mediaUrl(ytSmall(m))!} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ))}
      </div>
    );
  if (mosaic && mosaic.length)
    return <img src={mediaUrl(small ? ytSmall(mosaic[0]) : mosaic[0])!} alt={alt} loading="lazy" decoding="async" className={`aspect-square bg-surface2 object-cover ${shape} ${className}`} />;
  return (
    <div className={`flex aspect-square items-center justify-center bg-gradient-to-br from-surface2 to-line text-muted ${shape} ${className}`} role="img" aria-label={alt}>
      {icon || <Music2 className="h-1/3 w-1/3" />}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50 ${checked ? 'bg-accent' : 'bg-line'}`}
    >
      <span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition ${checked ? 'translate-x-7' : 'translate-x-1'}`} />
    </button>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-8 min-w-0">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="min-w-0 truncate text-[clamp(1.15rem,4.5vw,1.5rem)] font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Linha com rolagem horizontal interna (não estoura a página). */
export function Shelf({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] md:-mx-6 md:px-6 [&::-webkit-scrollbar]:hidden">
      <div className="flex gap-3 sm:gap-4">{children}</div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-sm font-medium text-white/90">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
