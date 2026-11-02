import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { PageLoading } from '../../components/ui';
import { pagePad } from '../../components/Layout';

const TABS = [
  ['', 'Painel'], ['users', 'Usuários'], ['tracks', 'Músicas'], ['imports', 'Importar do Spotify'], ['artists', 'Artistas'], ['albums', 'Álbuns'], ['genres', 'Gêneros'],
  ['moderation', 'Moderação'], ['reports', 'Reproduções'], ['settings', 'Configurações'], ['audit', 'Auditoria'],
];

export default function AdminLayout() {
  return (
    <div className={`${pagePad} pt-[max(1.25rem,env(safe-area-inset-top))] md:pt-6`}>
      <h1 className="mb-3 text-[clamp(1.5rem,6vw,2rem)] font-black">Administração</h1>
      <div className="-mx-4 mb-5 overflow-x-auto px-4 [scrollbar-width:none] md:-mx-6 md:px-6">
        <nav className="flex gap-2" aria-label="Seções do admin">
          {TABS.map(([to, label]) => (
            <NavLink key={to} to={`/admin${to ? `/${to}` : ''}`} end={!to} className={({ isActive }) => `chip ${isActive ? 'chip-on' : ''}`}>
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Suspense fallback={<PageLoading />}>
        <Outlet />
      </Suspense>
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card min-w-0 p-4">
      <p className="truncate text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 truncate text-2xl font-black tabular-nums">{value}</p>
      {hint && <p className="truncate text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function SearchBar({ value, onChange, placeholder, children }: { value: string; onChange: (v: string) => void; placeholder: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <input className="input min-w-0 flex-1 basis-56" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
      {children}
    </div>
  );
}
