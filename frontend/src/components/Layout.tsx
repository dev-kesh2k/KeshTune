import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CircleArrowDown, Heart, Home, Library, Plus, Search, Settings, Shield, WifiOff } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { forgetDevice, syncOffline, useOfflineMode } from '../lib/offline';
import { flushPending } from '../lib/pending';
import { usePlayer } from '../lib/player';
import { onRealtime, startRealtime } from '../lib/realtime';
import { useToast } from '../lib/toast';
import type { PlaylistCard } from '../lib/types';
import { LyricsSheet, MiniPlayer, NowPlaying, PlayerBar, QueueSheet } from './PlayerParts';
import { Cover } from './ui';

function useSidebarPlaylists() {
  const [items, setItems] = useState<PlaylistCard[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ playlists: PlaylistCard[] }>('me/library')
        .then((r) => alive && setItems(r.playlists))
        .catch(() => {});
    load();
    const offs = [onRealtime('library.changed', load), onRealtime('playlist.updated', load)];
    window.addEventListener('spx:playlists-changed', load);
    return () => {
      alive = false;
      offs.forEach((o) => o());
      window.removeEventListener('spx:playlists-changed', load);
    };
  }, []);
  return items;
}

export function Layout() {
  const { me, logout } = useAuth();
  const player = usePlayer();
  const toast = useToast();
  const nav = useNavigate();
  const loc = useLocation();
  const offline = useOfflineMode();
  const [nowOpen, setNowOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const playlists = useSidebarPlaylists();

  useEffect(() => {
    const stop = startRealtime();
    flushPending();
    const online = () => {
      flushPending();
      toast('Conectado de novo');
    };
    window.addEventListener('online', online);
    window.addEventListener('spx:netmode', () => flushPending());
    const iv = setInterval(() => flushPending(), 60000);
    const offs = [
      onRealtime('account.restricted', () => {
        toast('Sua conta foi bloqueada ou excluída pelo administrador', 'error');
        forgetDevice().catch(() => {}).finally(() => logout());
      }),
      onRealtime('download.revoked', () => syncOffline().catch(() => {})),
    ];
    return () => {
      stop();
      clearInterval(iv);
      window.removeEventListener('online', online);
      offs.forEach((o) => o());
    };
  }, [toast, logout]);

  useEffect(() => setNowOpen(false), [loc.pathname]);

  // atalhos de teclado na web
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.code === 'Space') {
        e.preventDefault();
        player.toggle();
      } else if (e.altKey && e.key === 'ArrowRight') player.next();
      else if (e.altKey && e.key === 'ArrowLeft') player.prev();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [player]);

  const isYT = player.current?.track.source === 'youtube';
  const navItems = [
    { to: '/', label: 'Início', icon: Home, end: true },
    { to: '/search', label: 'Buscar', icon: Search },
    { to: '/library', label: 'Biblioteca', icon: Library },
    { to: '/downloads', label: 'Downloads', icon: CircleArrowDown },
    ...(me?.role === 'admin' ? [{ to: '/admin', label: 'Admin', icon: Shield }] : []),
  ];
  const mobileNav = [
    navItems[0], navItems[1], navItems[2],
    me?.role === 'admin' ? { to: '/admin', label: 'Admin', icon: Shield } : { to: '/downloads', label: 'Downloads', icon: CircleArrowDown },
    { to: '/settings', label: 'Conta', icon: Settings },
  ];

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-bg">
      <div className="flex min-h-0 flex-1 lg:gap-2 lg:p-2">
        {/* Menu lateral (desktop) */}
        <aside className="hidden w-64 shrink-0 flex-col gap-2 lg:flex xl:w-72">
          <nav className="card p-3">
            <Link to="/" className="mb-2 flex items-center gap-2 px-3 py-2">
              <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="h-8 w-8" />
              <span className="text-lg font-black tracking-tight">Spotify X</span>
            </Link>
            {navItems.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `flex min-h-11 items-center gap-4 rounded-lg px-3 font-semibold transition ${isActive ? 'bg-white/10 text-white' : 'text-white/65 hover:text-white'}`}
              >
                <n.icon className="h-6 w-6" /> {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="card flex min-h-0 flex-1 flex-col p-3">
            <div className="mb-2 flex items-center justify-between gap-2 px-2">
              <Link to="/library" className="font-semibold text-white/80 hover:text-white">Sua biblioteca</Link>
              <button className="icon-btn h-9 w-9" aria-label="Criar playlist" onClick={() => nav('/library?new=1')}>
                <Plus className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <NavLink to="/liked" className={({ isActive }) => `flex items-center gap-3 rounded-lg p-2 hover:bg-white/[0.06] ${isActive ? 'bg-white/10' : ''}`}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-accent-deep to-accent-soft">
                  <Heart className="h-5 w-5 fill-white" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">Músicas Curtidas</span>
                  <span className="block text-xs text-muted">Playlist</span>
                </span>
              </NavLink>
              {playlists.map((p) => (
                <NavLink key={p.id} to={`/playlist/${p.id}`} className={({ isActive }) => `flex items-center gap-3 rounded-lg p-2 hover:bg-white/[0.06] ${isActive ? 'bg-white/10' : ''}`}>
                  <Cover url={p.cover_url} mosaic={p.mosaic} alt={p.name} className="h-11 w-11 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-muted">Playlist · {p.owner_name}</span>
                  </span>
                </NavLink>
              ))}
            </div>
            <NavLink to="/settings" className="mt-2 flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm text-white/70 hover:text-white">
              <Settings className="h-5 w-5" /> <span className="truncate">{me?.display_name}</span>
            </NavLink>
          </div>
        </aside>

        {/* Conteúdo */}
        <main id="main" className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-surface lg:rounded-2xl">
          {offline && (
            <div className="sticky top-0 z-30 flex items-center justify-center gap-2 bg-amber-500 px-3 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-center text-xs font-semibold text-black">
              <WifiOff className="h-4 w-4 shrink-0" /> Modo offline: só o que foi baixado está disponível
            </div>
          )}
          <div className="pb-40 lg:pb-8">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Player do YouTube (oficial, visível enquanto toca) */}
      <div
        className={
          !isYT
            ? 'pointer-events-none fixed -left-[9999px] top-0 h-px w-px opacity-0'
            : nowOpen
              ? 'fixed inset-x-0 top-[max(5.5rem,calc(env(safe-area-inset-top)+5rem))] z-[65] mx-auto aspect-video w-[min(100%-2.5rem,36rem)] overflow-hidden rounded-xl shadow-2xl'
              : 'fixed bottom-[calc(9.5rem+env(safe-area-inset-bottom))] right-3 z-40 aspect-video w-[min(55vw,18rem)] overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10 lg:bottom-24'
        }
        aria-hidden={!isYT}
      >
        <div ref={player.ytHost} className="h-full w-full" />
      </div>

      {/* Rodapé: player + navegação */}
      <div className="fixed inset-x-0 bottom-0 z-50 lg:static">
        <MiniPlayer onOpen={() => setNowOpen(true)} />
        <PlayerBar onOpenQueue={() => setQueueOpen(true)} onOpenLyrics={() => setLyricsOpen(true)} onOpenNow={() => setNowOpen(true)} />
        <nav className="grid grid-cols-5 bg-gradient-to-t from-black via-black/95 to-black/80 pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Navegação">
          {mobileNav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={'end' in n ? n.end : false}
              className={({ isActive }) => `flex min-h-[3.5rem] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${isActive ? 'text-white' : 'text-white/55'}`}
            >
              <n.icon className="h-6 w-6" />
              <span className="max-w-full truncate px-1">{n.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <NowPlaying open={nowOpen} onClose={() => setNowOpen(false)} onOpenQueue={() => setQueueOpen(true)} onOpenLyrics={() => setLyricsOpen(true)} />
      <QueueSheet open={queueOpen} onClose={() => setQueueOpen(false)} />
      <LyricsSheet open={lyricsOpen} onClose={() => setLyricsOpen(false)} />
    </div>
  );
}

/** Cabeçalho de página com degradê e título fluido. */
export function PageHero({ color = '#4c1d95', children }: { color?: string; children: React.ReactNode }) {
  return (
    <div className="relative px-4 pb-6 pt-[max(1.25rem,env(safe-area-inset-top))] md:px-6 md:pt-6" style={{ background: `linear-gradient(180deg, ${color} 0%, ${color}66 55%, transparent 100%)` }}>
      {children}
    </div>
  );
}
export const pagePad = 'px-4 md:px-6';
