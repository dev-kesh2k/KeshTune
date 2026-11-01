import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Toast = { id: number; text: string; kind: 'info' | 'error' | 'ok'; action?: { label: string; run: () => void } };
const Ctx = createContext<(text: string, kind?: Toast['kind'], action?: Toast['action']) => void>(() => {});
export const useToast = () => useContext(Ctx);

let seq = 0;
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) => {
    const id = ++seq;
    setItems((l) => [...l.slice(-2), { id, text, kind, action }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), action ? 6000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[80] flex flex-col items-center gap-2 px-3">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm shadow-2xl ring-1 ${
              t.kind === 'error' ? 'bg-red-950 text-red-100 ring-red-800' : t.kind === 'ok' ? 'bg-emerald-950 text-emerald-100 ring-emerald-800' : 'bg-surface2 text-white ring-line'
            }`}
          >
            <span className="min-w-0 flex-1 break-words">{t.text}</span>
            {t.action && (
              <button
                className="min-h-11 shrink-0 rounded-lg px-3 font-semibold text-accent-soft"
                onClick={() => {
                  t.action!.run();
                  setItems((l) => l.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
