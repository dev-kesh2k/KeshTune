import { useCallback } from 'react';
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
import Library from './pages/Library';
import Liked from './pages/Liked';
import Playlist from './pages/Playlist';
import Album from './pages/Album';
import Artist from './pages/Artist';
import Track from './pages/Track';
import Genre from './pages/Genre';
import UserProfile from './pages/UserProfile';
import Settings from './pages/Settings';
import Downloads from './pages/Downloads';
import Trash from './pages/Trash';
import { Invite, SharedLink } from './pages/Links';
import AdminLayout from './pages/admin/AdminLayout';
import Dashboard from './pages/admin/Dashboard';
import Users from './pages/admin/Users';
import Tracks from './pages/admin/Tracks';
import Imports from './pages/admin/Imports';
import { Albums, Artists, Genres } from './pages/admin/Catalog';
import { AdminSettings, Audit, Moderation, Reports } from './pages/admin/Ops';

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
