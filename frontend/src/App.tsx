import { lazy, useCallback } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { PlayerProvider } from './lib/player';
import { ToastProvider, useToast } from './lib/toast';
import { UiProvider } from './components/TrackActions';
import { Layout } from './components/Layout';
import { PageLoading } from './components/ui';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Home from './pages/Home';
import Search from './pages/Search';

// Telas carregadas sob demanda (o pacote inicial leva só Início, Busca e Login)
const Library = lazy(() => import('./pages/Library'));
const Liked = lazy(() => import('./pages/Liked'));
const Playlist = lazy(() => import('./pages/Playlist'));
const Album = lazy(() => import('./pages/Album'));
const Artist = lazy(() => import('./pages/Artist'));
const Track = lazy(() => import('./pages/Track'));
const Genre = lazy(() => import('./pages/Genre'));
const UserProfile = lazy(() => import('./pages/UserProfile'));
const Settings = lazy(() => import('./pages/Settings'));
const Downloads = lazy(() => import('./pages/Downloads'));
const Trash = lazy(() => import('./pages/Trash'));
const Invite = lazy(() => import('./pages/Links').then((m) => ({ default: m.Invite })));
const SharedLink = lazy(() => import('./pages/Links').then((m) => ({ default: m.SharedLink })));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const Users = lazy(() => import('./pages/admin/Users'));
const Tracks = lazy(() => import('./pages/admin/Tracks'));
const Imports = lazy(() => import('./pages/admin/Imports'));
const Albums = lazy(() => import('./pages/admin/Catalog').then((m) => ({ default: m.Albums })));
const Artists = lazy(() => import('./pages/admin/Catalog').then((m) => ({ default: m.Artists })));
const Genres = lazy(() => import('./pages/admin/Catalog').then((m) => ({ default: m.Genres })));
const AdminSettings = lazy(() => import('./pages/admin/Ops').then((m) => ({ default: m.AdminSettings })));
const Audit = lazy(() => import('./pages/admin/Ops').then((m) => ({ default: m.Audit })));
const Moderation = lazy(() => import('./pages/admin/Ops').then((m) => ({ default: m.Moderation })));
const Reports = lazy(() => import('./pages/admin/Ops').then((m) => ({ default: m.Reports })));

function Authed() {
  const toast = useToast();
  const { me } = useAuth();
  const onError = useCallback((m: string) => toast(m, 'error'), [toast]);
  return (
    <PlayerProvider onError={onError}>
      <UiProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="search" element={<Search />} />
            <Route path="library" element={<Library />} />
            <Route path="library/trash" element={<Trash />} />
            <Route path="liked" element={<Liked />} />
            <Route path="downloads" element={<Downloads />} />
            <Route path="playlist/:id" element={<Playlist />} />
            <Route path="album/:id" element={<Album />} />
            <Route path="artist/:id" element={<Artist />} />
            <Route path="track/:id" element={<Track />} />
            <Route path="genre/:id" element={<Genre />} />
            <Route path="user/:id" element={<UserProfile />} />
            <Route path="settings" element={<Settings />} />
            <Route path="s/:token" element={<SharedLink />} />
            <Route path="invite/:token" element={<Invite />} />
            {me?.role === 'admin' && (
              <Route path="admin" element={<AdminLayout />}>
                <Route index element={<Dashboard />} />
                <Route path="users" element={<Users />} />
                <Route path="tracks" element={<Tracks />} />
                <Route path="imports" element={<Imports />} />
                <Route path="artists" element={<Artists />} />
                <Route path="albums" element={<Albums />} />
                <Route path="genres" element={<Genres />} />
                <Route path="moderation" element={<Moderation />} />
                <Route path="reports" element={<Reports />} />
                <Route path="settings" element={<AdminSettings />} />
                <Route path="audit" element={<Audit />} />
              </Route>
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </UiProvider>
    </PlayerProvider>
  );
}

function Gate() {
  const { me, loading } = useAuth();
  if (loading) return <div className="flex min-h-[100dvh] items-center justify-center"><PageLoading /></div>;
  if (!me) return <Login />;
  if (me.must_change_password) return <ChangePassword />;
  return <Authed />;
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <ToastProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
