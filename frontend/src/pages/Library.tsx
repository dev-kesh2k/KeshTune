import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Folder, FolderInput, FolderPlus, Heart, MoreVertical, Pencil, Plus, Search, Trash2, Upload, UserRound } from 'lucide-react';
import { api, errText } from '../lib/api';
import { albumType, artistNames } from '../lib/format';
import { useOfflineMode } from '../lib/offline';
import { onRealtime } from '../lib/realtime';
import { useToast } from '../lib/toast';
import { useFetch } from '../lib/useFetch';
import { useTitle } from '../lib/useTitle';
import type { AlbumCard, ArtistCard, PlaylistCard } from '../lib/types';
import { Confirm, Cover, Empty, ErrorBox, Field, PageLoading, Sheet, Spinner, Toggle } from '../components/ui';
import { pagePad } from '../components/Layout';
import { focusOnMount } from '../lib/focus';

type FolderT = { id: string; name: string; parent_id: string | null };
type Lib = { liked_count: number; folders: FolderT[]; playlists: (PlaylistCard & { saved_at: string | null })[]; albums: (AlbumCard & { saved_at: string })[]; artists: (ArtistCard & { saved_at: string })[] };

export function CreatePlaylistSheet({ open, onClose, folderId }: { open: boolean; onClose: () => void; folderId?: string | null }) {
  const nav = useNavigate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [collab, setCollab] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setName(''); setDescription(''); setVisibility('private'); setCollab(false); }
  }, [open]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await api<{ id: string }>('playlists', { body: { name, description, visibility, is_collaborative: collab, folder_id: folderId || null } });
      window.dispatchEvent(new Event('spx:playlists-changed'));
      onClose();
      nav(`/playlist/${p.id}`);
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Nova playlist">
      <form onSubmit={submit} className="space-y-4 pt-2">
        <Field label="Nome">
          <input className="input" required maxLength={100} ref={focusOnMount} value={name} onChange={(e) => setName(e.target.value)} placeholder="Minha playlist" />
        </Field>
        <Field label="Descrição (opcional)">
          <textarea className="input min-h-20 py-3" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Visibilidade">
          <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            <option value="private">Privada — só você e colaboradores</option>
            <option value="public">Pública — aparece na busca e no seu perfil</option>
            <option value="link">Somente por link</option>
          </select>
        </Field>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm"><span className="block font-medium">Colaborativa</span><span className="text-xs text-muted">Convidados podem adicionar, remover e reordenar</span></span>
          <Toggle checked={collab} onChange={setCollab} label="Colaborativa" />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={busy || !name.trim()}>{busy && <Spinner className="h-4 w-4" />} Criar</button>
      </form>
    </Sheet>
  );
}

function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ id: string; total: number; matched: number; unmatched: string[] } | null>(null);
  useEffect(() => { if (open) { setFile(null); setName(''); setRes(null); } }, [open]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (name.trim()) fd.append('name', name.trim());
      setRes(await api('playlists/import', { form: fd }));
      window.dispatchEvent(new Event('spx:playlists-changed'));
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Importar playlist">
      {res ? (
        <div className="space-y-3 pt-2">
          <p className="text-lg font-semibold">{res.matched} de {res.total} faixas encontradas no catálogo</p>
          {res.unmatched.length > 0 && (
            <details className="card p-3 text-sm">
              <summary className="min-h-11 cursor-pointer leading-[2.75rem] text-muted">Não encontradas ({res.unmatched.length})</summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-muted">{res.unmatched.map((u, i) => <li key={i} className="break-words">{u}</li>)}</ul>
            </details>
          )}
          <button className="btn-primary w-full" onClick={() => { onClose(); nav(`/playlist/${res.id}`); }}>Abrir playlist</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 pt-2">
          <p className="text-sm text-muted">Envie um arquivo CSV (colunas título, artista, ISRC, duração) ou M3U de outro serviço. A correspondência usa ISRC e depois título + artista + duração.</p>
          <Field label="Arquivo">
            <input className="input py-2.5 file:mr-3 file:rounded-full file:border-0 file:bg-white/15 file:px-3 file:py-1 file:text-white" type="file" accept=".csv,.m3u,.m3u8,.txt,text/csv" required onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Field>
          <Field label="Nome da playlist (opcional)">
            <input className="input" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Usa o nome do arquivo" />
          </Field>
          <button type="submit" className="btn-primary w-full" disabled={busy || !file}>{busy ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />} Importar</button>
        </form>
      )}
    </Sheet>
  );
}

export default function Library() {
  useTitle('Sua biblioteca');
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const offline = useOfflineMode();
  const { data, error, loading, offline: netOff, reload } = useFetch<Lib>('me/library');
  const filter = params.get('f') || 'playlist';
  const folderId = params.get('folder');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'recent' | 'az'>('recent');
  const [createOpen, setCreateOpen] = useState(params.get('new') === '1');
  const [importOpen, setImportOpen] = useState(false);
  const [folderSheet, setFolderSheet] = useState<{ mode: 'new' | 'rename'; folder?: FolderT } | null>(null);
  const [folderName, setFolderName] = useState('');
  const [delFolder, setDelFolder] = useState<FolderT | null>(null);
  const [moveP, setMoveP] = useState<PlaylistCard | null>(null);
  const [folderMenu, setFolderMenu] = useState<FolderT | null>(null);

  useEffect(() => {
    const offs = [onRealtime('library.changed', () => reload(true)), onRealtime('playlist.updated', () => reload(true))];
    const h = () => reload(true);
    window.addEventListener('spx:playlists-changed', h);
    window.addEventListener('spx:liked', h);
    return () => { offs.forEach((o) => o()); window.removeEventListener('spx:playlists-changed', h); window.removeEventListener('spx:liked', h); };
  }, [reload]);
  useEffect(() => {
    if (params.get('new') === '1') { setCreateOpen(true); params.delete('new'); setParams(params, { replace: true }); }
  }, [params, setParams]);

  const folder = data?.folders.find((f) => f.id === folderId) || null;
  const crumbs = useMemo(() => {
    const out: FolderT[] = [];
    let f = folder;
    while (f) { out.unshift(f); f = data?.folders.find((x) => x.id === f!.parent_id) || null; }
    return out;
  }, [folder, data]);
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const match = (s: string) => !q || norm(s).includes(norm(q));
  const sorter = <T extends { saved_at?: string | null }>(name: (x: T) => string) => (a: T, b: T) =>
    sort === 'az' ? name(a).localeCompare(name(b), 'pt-BR') : String(b.saved_at || '').localeCompare(String(a.saved_at || ''));

  const setF = (f: string) => setParams(f === 'playlist' ? {} : { f });
  const openFolder = (id: string | null) => setParams(id ? { folder: id } : {});

  const saveFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (folderSheet?.mode === 'rename') await api(`me/folders/${folderSheet.folder!.id}`, { method: 'PATCH', body: { name: folderName } });
      else await api('me/folders', { body: { name: folderName, parent_id: folderId } });
      setFolderSheet(null);
      reload(true);
    } catch (e) {
      toast(errText(e), 'error');
    }
  };
  const moveTo = async (target: string | null) => {
    if (!moveP) return;
    try {
      await api(`me/library/playlist/${moveP.id}/folder`, { method: 'PUT', body: { folder_id: target } });
      toast('Playlist movida');
      setMoveP(null);
      reload(true);
    } catch (e) {
      toast(errText(e), 'error');
    }
  };

  if (offline) {
    return (
      <div className={`${pagePad} pt-[max(1.25rem,env(safe-area-inset-top))] md:pt-6`}>
        <h1 className="mb-4 text-[clamp(1.5rem,6vw,2rem)] font-black">Sua biblioteca</h1>
        <Empty title="Modo offline" text="Sem conexão, sua biblioteca mostra só o que foi baixado." action={<Link className="btn-primary" to="/downloads">Abrir downloads</Link>} />
      </div>
    );
  }

  const subFolders = (data?.folders || []).filter((f) => f.parent_id === (folderId || null) && match(f.name));
  const playlists = (data?.playlists || []).filter((p) => (q ? true : (p.folder_id || null) === (folderId || null)) && match(p.name)).sort(sorter((x) => x.name));

  return (
    <div className={`${pagePad} pt-[max(1.25rem,env(safe-area-inset-top))] md:pt-6`}>
      <div className="mb-4 flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-[clamp(1.5rem,6vw,2rem)] font-black"><span className="sm:hidden">Biblioteca</span><span className="hidden sm:inline">Sua biblioteca</span></h1>
        <button className="icon-btn" aria-label="Importar playlist" title="Importar CSV/M3U" onClick={() => setImportOpen(true)}><Upload className="h-5 w-5" /></button>
        <button className="icon-btn" aria-label="Nova pasta" title="Nova pasta" onClick={() => { setFolderName(''); setFolderSheet({ mode: 'new' }); }}><FolderPlus className="h-5 w-5" /></button>
        <button className="icon-btn" aria-label="Nova playlist" title="Nova playlist" onClick={() => setCreateOpen(true)}><Plus className="h-6 w-6" /></button>
      </div>
      <div className="-mx-4 mb-3 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
        <div className="flex gap-2">
          {[['playlist', 'Playlists'], ['album', 'Álbuns'], ['artist', 'Artistas']].map(([k, l]) => (
            <button key={k} className={`chip ${filter === k ? 'chip-on' : ''}`} onClick={() => setF(k)}>{l}</button>
          ))}
          <Link to="/downloads" className="chip">Baixadas</Link>
        </div>
      </div>
      <div className="mb-4 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Buscar na biblioteca" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar na biblioteca" />
        </div>
        <select className="input w-auto shrink-0" value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'az')} aria-label="Ordenar">
          <option value="recent">Recentes</option>
          <option value="az">A–Z</option>
        </select>
      </div>

      {loading ? <PageLoading /> : error ? <ErrorBox text={error} offline={netOff} onRetry={() => reload()} /> : data && (
        <>
          {filter === 'playlist' && (
            <>
              {crumbs.length > 0 && (
                <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm text-muted" aria-label="Pastas">
                  <button className="min-h-11 px-1 hover:text-white" onClick={() => openFolder(null)}>Biblioteca</button>
                  {crumbs.map((c) => (
                    <span key={c.id} className="flex items-center gap-1">
                      <ChevronRight className="h-4 w-4" />
                      <button className="min-h-11 max-w-[10rem] truncate px-1 hover:text-white" onClick={() => openFolder(c.id)}>{c.name}</button>
                    </span>
                  ))}
                </nav>
              )}
              <ul className="space-y-0.5">
                {!folderId && match('Músicas Curtidas') && (
                  <li>
                    <Link to="/liked" className="flex min-h-16 items-center gap-3 rounded-lg p-2 hover:bg-white/[0.06]">
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-accent-deep to-accent-soft"><Heart className="h-6 w-6 fill-white" /></span>
                      <span className="min-w-0"><span className="block truncate font-semibold">Músicas Curtidas</span><span className="text-sm text-muted">Playlist · {data.liked_count} músicas</span></span>
                    </Link>
                  </li>
                )}
                {subFolders.map((f) => (
                  <li key={f.id} className="flex items-center">
                    <button className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-left hover:bg-white/[0.06]" onClick={() => openFolder(f.id)}>
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-surface2"><Folder className="h-6 w-6 text-muted" /></span>
                      <span className="min-w-0"><span className="block truncate font-semibold">{f.name}</span><span className="text-sm text-muted">Pasta · {data.playlists.filter((p) => p.folder_id === f.id).length} playlists</span></span>
                    </button>
                    <button className="icon-btn" aria-label={`Opções da pasta ${f.name}`} onClick={() => setFolderMenu(f)}><MoreVertical className="h-5 w-5" /></button>
                  </li>
                ))}
                {playlists.map((p) => (
                  <li key={p.id} className="flex items-center">
                    <Link to={`/playlist/${p.id}`} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-lg p-2 hover:bg-white/[0.06]">
                      <Cover url={p.cover_url} mosaic={p.mosaic} alt={p.name} className="h-14 w-14 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{p.name}</span>
                        <span className="block truncate text-sm text-muted">Playlist · {p.owner_name}{p.is_collaborative ? ' · colaborativa' : ''}</span>
                      </span>
                    </Link>
                    <button className="icon-btn" aria-label={`Mover ${p.name} para pasta`} title="Mover para pasta" onClick={() => setMoveP(p)}><FolderInput className="h-5 w-5" /></button>
                  </li>
                ))}
              </ul>
              {!playlists.length && !subFolders.length && (folderId || q) && <Empty title={q ? 'Nada encontrado' : 'Pasta vazia'} text={q ? undefined : 'Use o botão de pasta ao lado de uma playlist para movê-la para cá.'} />}
              {!folderId && !q && !data.playlists.length && (
                <Empty title="Crie sua primeira playlist" text="É fácil, vamos te ajudar." action={<button className="btn-primary" onClick={() => setCreateOpen(true)}>Criar playlist</button>} />
              )}
              {!folderId && <Link to="/library/trash" className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted hover:text-white"><Trash2 className="h-4 w-4" /> Playlists excluídas (recuperar)</Link>}
            </>
          )}
          {filter === 'album' && (
            data.albums.filter((a) => match(a.title)).length ? (
              <ul className="space-y-0.5">
                {data.albums.filter((a) => match(a.title) || match(artistNames(a.artists))).sort(sorter((x) => x.title)).map((a) => (
                  <li key={a.id}>
                    <Link to={`/album/${a.id}`} className="flex min-h-16 items-center gap-3 rounded-lg p-2 hover:bg-white/[0.06]">
                      <Cover url={a.cover_url} alt={a.title} className="h-14 w-14 shrink-0" />
                      <span className="min-w-0"><span className="block truncate font-semibold">{a.title}</span><span className="block truncate text-sm text-muted">{albumType(a.type)} · {artistNames(a.artists)}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <Empty title="Nenhum álbum salvo" text="Toque no coração de um álbum para salvá-lo aqui." />
          )}
          {filter === 'artist' && (
            data.artists.filter((a) => match(a.name)).length ? (
              <ul className="space-y-0.5">
                {data.artists.filter((a) => match(a.name)).sort(sorter((x) => x.name)).map((a) => (
                  <li key={a.id}>
                    <Link to={`/artist/${a.id}`} className="flex min-h-16 items-center gap-3 rounded-lg p-2 hover:bg-white/[0.06]">
                      <Cover url={a.image_url} alt={a.name} round className="h-14 w-14 shrink-0" icon={<UserRound className="h-6 w-6" />} />
                      <span className="min-w-0"><span className="block truncate font-semibold">{a.name}</span><span className="text-sm text-muted">Artista</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <Empty title="Você ainda não segue artistas" text="Toque em Seguir na página de um artista." />
          )}
        </>
      )}

      <CreatePlaylistSheet open={createOpen} onClose={() => setCreateOpen(false)} folderId={folderId} />
      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} />
      <Sheet open={!!folderSheet} onClose={() => setFolderSheet(null)} title={folderSheet?.mode === 'rename' ? 'Renomear pasta' : 'Nova pasta'}>
        <form onSubmit={saveFolder} className="space-y-4 pt-2">
          <input className="input" ref={focusOnMount} required maxLength={100} value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="Nome da pasta" aria-label="Nome da pasta" />
          <button type="submit" className="btn-primary w-full" disabled={!folderName.trim()}>Salvar</button>
        </form>
      </Sheet>
      <Sheet open={!!folderMenu} onClose={() => setFolderMenu(null)} title={folderMenu?.name}>
        <button className="menu-item" onClick={() => { setFolderName(folderMenu!.name); setFolderSheet({ mode: 'rename', folder: folderMenu! }); setFolderMenu(null); }}><Pencil className="h-5 w-5" /> Renomear</button>
        <button className="menu-item text-red-300" onClick={() => { setDelFolder(folderMenu); setFolderMenu(null); }}><Trash2 className="h-5 w-5" /> Excluir pasta</button>
      </Sheet>
      <Sheet open={!!moveP} onClose={() => setMoveP(null)} title="Mover para pasta">
        <button className="menu-item" onClick={() => moveTo(null)}><Heart className="h-5 w-5" /> Biblioteca (fora de pastas)</button>
        {(data?.folders || []).map((f) => (
          <button key={f.id} className="menu-item" onClick={() => moveTo(f.id)}><Folder className="h-5 w-5" /> <span className="truncate">{f.name}</span></button>
        ))}
        {!data?.folders.length && <p className="py-3 text-sm text-muted">Crie uma pasta primeiro com o botão de pasta no topo.</p>}
      </Sheet>
      <Confirm
        open={!!delFolder}
        title={`Excluir a pasta "${delFolder?.name}"?`}
        text="As playlists e subpastas dela voltam para a pasta de cima. Nenhuma playlist é apagada."
        confirmLabel="Excluir"
        danger
        onClose={() => setDelFolder(null)}
        onConfirm={async () => {
          try { await api(`me/folders/${delFolder!.id}`, { method: 'DELETE' }); setDelFolder(null); if (folderId === delFolder!.id) openFolder(delFolder!.parent_id); reload(true); } catch (e) { toast(errText(e), 'error'); }
        }}
      />
    </div>
  );
}
