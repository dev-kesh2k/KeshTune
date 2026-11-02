import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Clock, Search as SearchIcon, UserRound, X } from 'lucide-react';
import { api, errText } from '../lib/api';
import { mediaUrl } from '../lib/format';

import { usePlayer } from '../lib/player';
import { useFetch } from '../lib/useFetch';
import type { AlbumCard, ArtistCard, Genre, PlaylistCard, Track } from '../lib/types';
import { Cover, Empty, ErrorBox, PageLoading, Section, Spinner } from '../components/ui';
import { AlbumTile, ArtistTile, PlaylistTile, tileGrid } from '../components/Tiles';
import { TrackList } from '../components/TrackList';
import { YoutubeResults } from '../components/YoutubeResults';
import { YoutubePlaylists } from '../components/YoutubePlaylists';
import { pagePad } from '../components/Layout';

type Result = { tracks?: Track[]; artists?: ArtistCard[]; albums?: AlbumCard[]; playlists?: PlaylistCard[]; users?: { id: string; display_name: string; avatar_url: string | null }[]; did_you_mean: string | null };
type Hist = { id: number; type: string; query?: string; item_id?: string; title?: string; image_url?: string | null };
type Sug = { type: string; id: string; title: string; subtitle?: string; image_url?: string | null };

const FILTERS = [
  ['all', 'Tudo'], ['track', 'Músicas'], ['artist', 'Artistas'], ['album', 'Álbuns'], ['playlist', 'Playlists'], ['user', 'Perfis'],
] as const;
const typePath = (t: string, id: string) => (t === 'user' ? `/user/${id}` : `/${t}/${id}`);
const typeLabel: Record<string, string> = { track: 'Música', artist: 'Artista', album: 'Álbum', playlist: 'Playlist', user: 'Perfil' };

function saveHistory(body: Record<string, unknown>) {
  api('search/history', { body }).catch(() => {});
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const player = usePlayer();
  const [text, setText] = useState(params.get('q') || '');
  const q = params.get('q') || '';
  const filter = params.get('type') || 'all';
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sugs, setSugs] = useState<Sug[]>([]);
  const [focus, setFocus] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const history = useFetch<{ items: Hist[] }>(q ? null : 'search/history', [q]);
  const cats = useFetch<{ items: Genre[] }>('browse/categories');

  // sugestões em tempo real
  useEffect(() => {
    if (!text.trim() || !focus) {
      setSugs([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api<{ items: Sug[] }>(`search/suggest?q=${encodeURIComponent(text.trim())}`, { signal: ctl.signal }).then((r) => setSugs(r.items)).catch(() => {});
    }, 120);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [text, focus]);

  // busca ao digitar (com atraso) e ao trocar o filtro
  useEffect(() => {
    const t = setTimeout(() => {
      const v = text.trim();
      if (v !== q) setParams(v ? { q: v, ...(filter !== 'all' ? { type: filter } : {}) } : {}, { replace: true });
    }, 350);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!q) {
      setResult(null);
      return;
    }
    const ctl = new AbortController();
    setBusy(true);
    setErr(null);
    const type = filter === 'all' ? 'track,artist,album,playlist,user' : filter;
    api<Result>(`search?q=${encodeURIComponent(q)}&type=${type}&limit=${filter === 'all' ? 10 : 50}`, { signal: ctl.signal })
      .then(setResult)
      .catch((e) => e.name !== 'AbortError' && setErr(errText(e)))
      .finally(() => setBusy(false));
    return () => ctl.abort();
  }, [q, filter]);

  const setFilter = (f: string) => setParams(q ? { q, ...(f !== 'all' ? { type: f } : {}) } : {}, { replace: true });
  const openItem = (type: string, id: string) => {
    saveHistory({ query: q || text, item_type: type, item_id: id });
    nav(typePath(type, id));
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    saveHistory({ query: v });
    setParams({ q: v, ...(filter !== 'all' ? { type: filter } : {}) });
    setFocus(false);
    inputRef.current?.blur();
  };
  const delHistory = async (id?: number) => {
    await api(`search/history${id ? `?id=${id}` : ''}`, { method: 'DELETE' }).catch(() => {});
    history.reload(true);
  };

  const total = result ? (result.tracks?.length || 0) + (result.artists?.length || 0) + (result.albums?.length || 0) + (result.playlists?.length || 0) + (result.users?.length || 0) : 0;

  return (
    <div className={`${pagePad} pt-[max(1.25rem,env(safe-area-inset-top))] md:pt-6`}>
      <h1 className="mb-4 text-[clamp(1.5rem,6vw,2rem)] font-black lg:hidden">Buscar</h1>
      <form onSubmit={submit} className="relative z-20 mb-4 max-w-2xl" role="search">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-black/60" />
        <input
          ref={inputRef}
          className="min-h-12 w-full rounded-full bg-white pl-12 pr-12 text-base font-medium text-black placeholder:text-black/50 focus:outline-none focus:ring-4 focus:ring-accent/50"
          placeholder="O que você quer ouvir?"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          aria-label="Buscar músicas, artistas, álbuns, playlists e perfis"
        />
        {text && (
          <button type="button" className="icon-btn absolute right-1 top-1/2 -translate-y-1/2 text-black/70 hover:bg-black/10 hover:text-black" aria-label="Limpar" onClick={() => { setText(''); setParams({}); inputRef.current?.focus(); }}>
            <X className="h-5 w-5" />
          </button>
        )}
        {focus && sugs.length > 0 && (
          <ul className="absolute inset-x-0 top-full mt-2 overflow-hidden rounded-2xl bg-surface2 py-1 shadow-2xl ring-1 ring-line">
            {sugs.map((s) => (
              <li key={`${s.type}-${s.id}`}>
                <button className="flex min-h-12 w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-white/[0.06]" onMouseDown={(e) => e.preventDefault()} onClick={() => openItem(s.type, s.id)}>
                  <Cover url={s.image_url} alt="" round={s.type === 'artist'} className="h-10 w-10 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.title}</span>
                    <span className="block truncate text-xs text-muted">{typeLabel[s.type]}{s.subtitle ? ` · ${s.subtitle}` : ''}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      {q ? (
        <>
          <div className="-mx-4 mb-5 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
            <div className="flex gap-2">
              {FILTERS.map(([k, label]) => (
                <button key={k} className={`chip ${filter === k ? 'chip-on' : ''}`} onClick={() => setFilter(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {result?.did_you_mean && (
            <p className="mb-4 text-sm text-muted">
              Você quis dizer{' '}
              <button className="font-semibold text-accent-soft underline" onClick={() => { setText(result.did_you_mean!); setParams({ q: result.did_you_mean! }); }}>
                {result.did_you_mean}
              </button>
              ?
            </p>
          )}
          {busy && !result ? (
            <PageLoading />
          ) : err ? (
            <ErrorBox text={err} />
          ) : result && total === 0 ? (
            filter === 'all' || filter === 'track' || filter === 'playlist' ? (
              <p className="mb-4 text-sm text-muted">Nada no catálogo para "{q}".</p>
            ) : (
              <Empty icon={<SearchIcon className="h-10 w-10" />} title={`Nada encontrado para "${q}"`} text="Confira a ortografia ou tente outras palavras." />
            )
          ) : result ? (
            <div className={busy ? 'opacity-60' : ''}>
              {!!result.tracks?.length && (
                <Section title="Músicas">
                  <TrackList
                    tracks={result.tracks}
                    showAlbum
                    onPlay={(i) => {
                      saveHistory({ query: q, item_type: 'track', item_id: result.tracks![i].id });
                      player.playTracks(result.tracks!, i, { type: 'search', name: `Busca: ${q}` });
                    }}
                  />
                </Section>
              )}
              {!!result.artists?.length && (
                <Section title="Artistas">
                  <div className={tileGrid}>{result.artists.map((a) => <ArtistTile key={a.id} a={a} grid />)}</div>
                </Section>
              )}
              {!!result.albums?.length && (
                <Section title="Álbuns">
                  <div className={tileGrid}>{result.albums.map((a) => <AlbumTile key={a.id} a={a} grid />)}</div>
                </Section>
              )}
              {!!result.playlists?.length && (
                <Section title="Playlists">
                  <div className={tileGrid}>{result.playlists.map((p) => <PlaylistTile key={p.id} p={p} grid />)}</div>
                </Section>
              )}
              {!!result.users?.length && (
                <Section title="Perfis">
                  <div className={tileGrid}>
                    {result.users.map((u) => (
                      <Link key={u.id} to={`/user/${u.id}`} className="block min-w-0 rounded-xl p-2 hover:bg-white/[0.06]">
                        <Cover url={u.avatar_url} alt={u.display_name} round icon={<UserRound className="h-1/3 w-1/3" />} className="mb-2 w-full" />
                        <p className="truncate text-sm font-semibold">{u.display_name}</p>
                        <p className="text-xs text-muted">Perfil</p>
                      </Link>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          ) : null}
          {(filter === 'all' || filter === 'track') && <YoutubeResults q={q} />}
          {(filter === 'all' || filter === 'playlist') && <YoutubePlaylists q={q} />}
        </>
      ) : (
        <>
          {!!history.data?.items.length && (
            <Section title="Buscas recentes" action={<button className="min-h-11 px-2 text-sm font-semibold text-muted hover:text-white" onClick={() => delHistory()}>Limpar</button>}>
              <ul className="max-w-2xl">
                {history.data.items.map((h) => (
                  <li key={h.id} className="flex items-center gap-2">
                    <button
                      className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-1 text-left hover:bg-white/[0.06]"
                      onClick={() => (h.type === 'query' ? (setText(h.query || ''), setParams({ q: h.query || '' })) : nav(typePath(h.type, h.item_id!)))}
                    >
                      {h.type === 'query' ? (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white/[0.06]"><Clock className="h-5 w-5 text-muted" /></span>
                      ) : (
                        <Cover url={h.image_url} alt="" round={h.type === 'artist' || h.type === 'user'} className="h-10 w-10 shrink-0" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{h.type === 'query' ? h.query : h.title}</span>
                        <span className="block text-xs text-muted">{h.type === 'query' ? 'Busca' : typeLabel[h.type]}</span>
                      </span>
                    </button>
                    <button className="icon-btn text-muted" aria-label="Remover do histórico" onClick={() => delHistory(h.id)}>
                      <X className="h-5 w-5" />
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {cats.loading ? (
            <PageLoading />
          ) : cats.error ? (
            <ErrorBox text={cats.error} offline={cats.offline} onRetry={() => cats.reload()} />
          ) : (
            <>
              {(['genre', 'mood'] as const).map((kind) => (
                <Section key={kind} title={kind === 'genre' ? 'Navegar por gênero' : 'Para cada momento'}>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {cats.data?.items
                      .filter((g) => g.kind === kind)
                      .map((g) => (
                        <Link key={g.id} to={`/genre/${g.id}`} className="relative flex aspect-[16/10] min-w-0 overflow-hidden rounded-xl p-3 transition active:scale-95" style={{ background: g.color }}>
                          {g.cover_url && (
                            // Miniatura inclinada no canto, com a capa da música mais popular do gênero
                            <span className="absolute -bottom-2 -right-4 aspect-square w-[42%] rotate-[25deg] overflow-hidden rounded-md shadow-xl">
                              <img src={mediaUrl(g.cover_url)!} alt="" loading="lazy" className={`h-full w-full object-cover ${g.cover_url.startsWith('https://i.ytimg.com/') ? 'scale-[1.34]' : ''}`} />
                            </span>
                          )}
                          <span className="relative max-w-[62%] break-words text-[clamp(0.95rem,4vw,1.2rem)] font-bold leading-tight">{g.name}</span>
                          <span className="absolute bottom-2 left-3 text-xs font-semibold text-white/80">{g.track_count ? `${g.track_count} ${g.track_count === 1 ? 'faixa' : 'faixas'}` : ''}</span>
                        </Link>
                      ))}
                  </div>
                </Section>
              ))}
            </>
          )}
        </>
      )}
      {busy && result && <div className="fixed right-4 top-4 z-30 hidden md:block"><Spinner className="h-5 w-5 text-muted" /></div>}
    </div>
  );
}
