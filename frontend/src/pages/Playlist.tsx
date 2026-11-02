import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDownUp, CheckSquare, Copy, Download, EyeOff, GripVertical, Heart, ImagePlus, LogOut, MoreHorizontal, Pencil, Plus, Search, Share2, Trash2, UserPlus, Users, X,
} from 'lucide-react';
import { api, errText, downloadAuthed } from '../lib/api';
import { fmtTotal, shareUrl } from '../lib/format';
import { uploadSquareImage } from '../lib/image';
import { usePlayer } from '../lib/player';
import { onRealtime } from '../lib/realtime';
import { useToast } from '../lib/toast';
import { useFetch } from '../lib/useFetch';
import type { PlaylistDetail, PlaylistItem, Track } from '../lib/types';
import { CollectionHeader, PlayActions } from '../components/Collection';
import { TrackListHeader, TrackRow } from '../components/TrackList';
import { useUi } from '../components/TrackActions';
import { Confirm, Cover, Empty, ErrorBox, Field, PageLoading, Section, Sheet, Spinner, Toggle } from '../components/ui';
import { pagePad } from '../components/Layout';

const VIS = { private: 'Playlist privada', public: 'Playlist pública', link: 'Playlist por link' } as const;
type SortKey = 'custom' | 'title' | 'artist' | 'album' | 'added_at' | 'duration';
const SORTS: [SortKey, string][] = [['custom', 'Ordem personalizada'], ['title', 'Título'], ['artist', 'Artista'], ['album', 'Álbum'], ['added_at', 'Data de adição'], ['duration', 'Duração']];

function SortableRow(props: { item: PlaylistItem; index: number; onPlay: () => void; onRemove?: () => void; enabled: boolean }) {
  const s = useSortable({ id: props.item.id, disabled: !props.enabled });
  return (
    <div ref={s.setNodeRef} style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }} className={s.isDragging ? 'relative z-10 rounded-lg bg-surface2 shadow-2xl' : ''}>
      <TrackRow
        track={props.item.track}
        index={props.index}
        onPlay={props.onPlay}
        showAlbum
        addedAt={props.item.added_at}
        onRemove={props.onRemove}
        dragHandle={
          props.enabled ? (
            <button className="icon-btn -mx-2 h-11 w-8 cursor-grab touch-none text-muted" aria-label="Arrastar para reordenar" onClick={(e) => e.stopPropagation()} {...s.attributes} {...s.listeners}>
              <GripVertical className="h-5 w-5" />
            </button>
          ) : undefined
        }
      />
    </div>
  );
}

function QrBlock({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#09090d', light: '#ffffff' } }).then(setSrc).catch(() => setSrc(null));
  }, [url]);
  return src ? <img src={src} alt="Código QR do link" className="mx-auto w-[min(60vw,13rem)] rounded-xl" /> : <div className="mx-auto aspect-square w-[min(60vw,13rem)] rounded-xl bg-white/10" />;
}

function CopyRow({ url }: { url: string }) {
  const toast = useToast();
  return (
    <div className="flex items-center gap-2">
      <input className="input min-w-0 flex-1 text-sm" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Link" />
      <button className="btn-secondary shrink-0 px-4" onClick={() => navigator.clipboard.writeText(url).then(() => toast('Link copiado', 'ok'))} aria-label="Copiar link">
        <Copy className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function Playlist() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const player = usePlayer();
  const ui = useUi();
  const { data, setData, error, loading, offline, reload } = useFetch<PlaylistDetail>(`playlists/${id}`, [id]);
  const [sort, setSort] = useState<SortKey>('custom');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [filter, setFilter] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [suggestions, setSuggestions] = useState<Track[]>([]);

  const loadSuggestions = useCallback(() => {
    api<{ items: Track[] }>(`playlists/${id}/suggestions`).then((r) => setSuggestions(r.items)).catch(() => setSuggestions([]));
  }, [id]);

  useEffect(() => {
    const off = onRealtime<{ playlist_id: string; deleted?: boolean; snapshot_id?: number }>('playlist.updated', (d) => {
      if (d.playlist_id !== id) return;
      if (d.deleted) {
        toast('Esta playlist foi excluída pelo dono');
        nav('/library');
        return;
      }
      reload(true);
    });
    return off;
  }, [id, reload, nav, toast]);
  useEffect(() => {
    if (data?.can_edit) loadSuggestions();
  }, [data?.can_edit, data?.snapshot_id, loadSuggestions]);
  useEffect(() => {
    setSelecting(false);
    setSelected(new Set());
    setFilter('');
    setSort('custom');
  }, [id]);

  const items = useMemo(() => {
    if (!data) return [];
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    let list = data.items;
    if (filter) {
      const f = norm(filter);
      list = list.filter((i) => norm(`${i.track.title} ${i.track.artists.map((a) => a.name).join(' ')} ${i.track.album?.title || ''}`).includes(f));
    }
    if (sort !== 'custom') {
      const key = (i: PlaylistItem) =>
        sort === 'title' ? norm(i.track.title) : sort === 'artist' ? norm(i.track.artists[0]?.name || '') : sort === 'album' ? norm(i.track.album?.title || '') : sort === 'added_at' ? i.added_at : String(i.track.duration_ms).padStart(10, '0');
      list = [...list].sort((a, b) => key(a).localeCompare(key(b), 'pt-BR') * (dir === 'asc' ? 1 : -1));
    }
    return list;
  }, [data, filter, sort, dir]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  if (loading) return <PageLoading />;
  if (error || !data) return <ErrorBox text={error || 'Playlist não encontrada'} offline={offline} onRetry={() => reload()} />;

  const tracks = items.map((i) => i.track);
  const ctx = { type: 'playlist' as const, id: data.id, name: data.name };
  const canDrag = data.can_edit && sort === 'custom' && !filter && !selecting;
  const total = data.items.reduce((s, i) => s + i.track.duration_ms, 0);

  const removeItems = async (ids: string[]) => {
    const before = data;
    setData({ ...data, items: data.items.filter((i) => !ids.includes(i.id)) });
    try {
      await api(`playlists/${data.id}/items`, { method: 'DELETE', body: { item_ids: ids } });
      toast(ids.length === 1 ? 'Removida da playlist' : `${ids.length} faixas removidas`, 'info', {
        label: 'Desfazer',
        run: async () => {
          const removed = before.items.filter((i) => ids.includes(i.id)).map((i) => i.track.id);
          await api(`playlists/${data.id}/items`, { body: { track_ids: removed, duplicates: 'add' } }).catch(() => {});
          reload(true);
        },
      });
      setSelected(new Set());
      setSelecting(false);
    } catch (e) {
      setData(before);
      toast(errText(e), 'error');
    }
  };

  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = data.items.findIndex((i) => i.id === e.active.id);
    const to = data.items.findIndex((i) => i.id === e.over!.id);
    const moved = arrayMove(data.items, from, to);
    const before = moved[to + 1]?.id || null;
    setData({ ...data, items: moved });
    try {
      await api(`playlists/${data.id}/items/reorder`, { method: 'PUT', body: { item_id: e.active.id, before_item_id: before, snapshot_id: data.snapshot_id } });
    } catch (err) {
      toast(errText(err), 'error');
      reload(true);
    }
  };

  const applySort = async () => {
    try {
      await api(`playlists/${data.id}/items/sort`, { method: 'PUT', body: { by: sort, dir } });
      setSort('custom');
      toast('Nova ordem salva', 'ok');
      reload(true);
    } catch (e) {
      toast(errText(e), 'error');
    }
  };

  const toggleFollow = async () => {
    const f = !data.in_library;
    setData({ ...data, in_library: f, followers: data.followers + (f ? 1 : -1) });
    try {
      await api(`playlists/${data.id}/follow`, { method: f ? 'PUT' : 'DELETE' });
      window.dispatchEvent(new Event('spx:playlists-changed'));
      toast(f ? 'Salva na sua biblioteca' : 'Removida da sua biblioteca');
    } catch (e) {
      setData(data);
      toast(errText(e), 'error');
    }
  };

  const addTrack = async (t: Track) => {
    try {
      await api(`playlists/${data.id}/items`, { body: { track_ids: [t.id], duplicates: 'add' } });
      toast(`"${t.title}" adicionada`, 'ok');
      setSuggestions((s) => s.filter((x) => x.id !== t.id));
      reload(true);
    } catch (e) {
      toast(errText(e), 'error');
    }
  };

  const isCollabMember = !data.is_owner && data.collaborators.some((c) => c.role === 'editor' && data.can_edit);

  return (
    <div>
      <CollectionHeader
        cover={<Cover url={data.cover_url} mosaic={data.mosaic} alt={data.name} className="w-full" />}
        kind={`${VIS[data.visibility]}${data.is_collaborative ? ' · colaborativa' : ''}`}
        title={data.name}
        description={data.description}
        meta={
          <>
            <Link to={`/user/${data.owner_id}`} className="font-bold hover:underline">{data.owner_name}</Link>
            {data.followers > 0 && <span>· {data.followers} seguidores</span>}
            <span>· {data.items.length} faixas{total ? `, ${fmtTotal(total)}` : ''}</span>
          </>
        }
      />
      {data.hidden_by_admin && (
        <p className="mx-4 mb-2 flex items-center gap-2 rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-200 md:mx-6"><EyeOff className="h-4 w-4 shrink-0" /> Oculta da busca pela moderação.</p>
      )}
      <PlayActions tracks={tracks} ctx={ctx} group={{ kind: 'Playlist', image: data.cover_url || data.mosaic?.[0] }}>
        {!data.is_owner && !isCollabMember && (
          <button className={`icon-btn ${data.in_library ? 'text-accent' : ''}`} aria-label={data.in_library ? 'Remover da biblioteca' : 'Salvar na biblioteca'} onClick={toggleFollow}>
            <Heart className={`h-7 w-7 ${data.in_library ? 'fill-accent' : ''}`} />
          </button>
        )}
        {data.is_owner && (
          <button className="icon-btn" aria-label="Editar detalhes" onClick={() => setEditOpen(true)}><Pencil className="h-5 w-5" /></button>
        )}
        {data.is_owner && (
          <button className="icon-btn" aria-label="Colaboradores" onClick={() => setCollabOpen(true)}><UserPlus className="h-6 w-6" /></button>
        )}
        <button className="icon-btn" aria-label="Compartilhar" onClick={() => setShareOpen(true)}><Share2 className="h-6 w-6" /></button>
        <button className="icon-btn" aria-label="Mais opções" onClick={() => setMoreOpen(true)}><MoreHorizontal className="h-6 w-6" /></button>
      </PlayActions>

      <div className={pagePad}>
        {data.items.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-48">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input className="input pl-9" placeholder="Buscar na playlist" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Buscar na playlist" />
            </div>
            <select className="input w-auto max-w-full" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Ordenar por">
              {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {sort !== 'custom' && (
              <button className="icon-btn" aria-label="Inverter ordem" onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')}><ArrowDownUp className="h-5 w-5" /></button>
            )}
            {data.can_edit && sort !== 'custom' && <button className="chip min-h-11" onClick={applySort}>Salvar esta ordem</button>}
            {data.can_edit && (
              <button className={`icon-btn ${selecting ? 'text-accent-soft' : ''}`} aria-label="Selecionar várias" aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>
                <CheckSquare className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
        {selecting && (
          <div className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-surface2 p-2 ring-1 ring-line">
            <span className="min-w-0 flex-1 px-2 text-sm">{selected.size} selecionada(s)</span>
            <button className="chip min-h-11" onClick={() => setSelected(new Set(items.map((i) => i.id)))}>Todas</button>
            <button className="btn-danger" disabled={!selected.size} onClick={() => removeItems([...selected])}><Trash2 className="h-4 w-4" /> Remover</button>
            <button className="icon-btn" aria-label="Cancelar seleção" onClick={() => { setSelecting(false); setSelected(new Set()); }}><X className="h-5 w-5" /></button>
          </div>
        )}

        {data.items.length === 0 ? (
          <Empty title="Playlist vazia" text={data.can_edit ? 'Busque músicas para adicionar ou use as sugestões abaixo.' : 'Ainda não há músicas aqui.'} action={data.can_edit ? <button className="btn-primary" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Adicionar músicas</button> : undefined} />
        ) : (
          <>
            <TrackListHeader showAlbum />
            {selecting ? (
              items.map((it, i) => (
                <TrackRow key={it.id} track={it.track} index={i} onPlay={() => {}} showAlbum selectable selected={selected.has(it.id)}
                  onSelect={() => setSelected((s) => { const n = new Set(s); if (n.has(it.id)) n.delete(it.id); else n.add(it.id); return n; })} />
              ))
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  {items.map((it, i) => (
                    <SortableRow key={it.id} item={it} index={i} enabled={canDrag} onPlay={() => player.playTracks(tracks, i, ctx)} onRemove={data.can_edit ? () => removeItems([it.id]) : undefined} />
                  ))}
                </SortableContext>
              </DndContext>
            )}
            {filter && !items.length && <p className="py-6 text-center text-sm text-muted">Nada encontrado nesta playlist.</p>}
          </>
        )}

        {data.can_edit && (
          <div className="mt-6">
            <button className="btn-secondary mb-6" onClick={() => setAddOpen(true)}><Search className="h-4 w-4" /> Buscar músicas para adicionar</button>
            {suggestions.length > 0 && (
              <Section title="Sugestões" action={<button className="min-h-11 px-2 text-sm font-semibold text-muted hover:text-white" onClick={loadSuggestions}>Atualizar</button>}>
                <p className="-mt-2 mb-3 text-sm text-muted">Com base no que está nesta playlist</p>
                {suggestions.map((t) => (
                  <div key={t.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1"><TrackRow track={t} index={0} onPlay={() => player.playTracks([t], 0)} /></div>
                    <button className="chip min-h-11 shrink-0" onClick={() => addTrack(t)}>Adicionar</button>
                  </div>
                ))}
              </Section>
            )}
          </div>
        )}
        {data.collaborators.length > 1 && (
          <p className="mb-8 mt-4 flex items-center gap-2 text-sm text-muted"><Users className="h-4 w-4" /> {data.collaborators.map((c) => c.display_name).join(', ')}</p>
        )}
      </div>

      <EditSheet open={editOpen} onClose={() => setEditOpen(false)} data={data} onSaved={(d) => { setData(d); window.dispatchEvent(new Event('spx:playlists-changed')); }} />
      <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} data={data} onChanged={() => reload(true)} />
      <CollabSheet open={collabOpen} onClose={() => setCollabOpen(false)} data={data} onChanged={() => reload(true)} />
      <AddSongsSheet open={addOpen} onClose={() => setAddOpen(false)} onAdd={addTrack} existing={new Set(data.items.map((i) => i.track.id))} />
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={data.name}>
        <button className="menu-item" onClick={() => { setMoreOpen(false); ui.openAddToPlaylist(tracks); }}><Plus className="h-5 w-5" /> Adicionar tudo a outra playlist</button>
        <button className="menu-item" onClick={() => { setMoreOpen(false); player.addToQueue(tracks); toast('Adicionadas à fila'); }}><Plus className="h-5 w-5" /> Adicionar à fila</button>
        <button className="menu-item" onClick={() => { setMoreOpen(false); downloadAuthed(`playlists/${data.id}/export`, `${data.name}.csv`).catch((e) => toast(errText(e), 'error')); }}><Download className="h-5 w-5" /> Exportar lista (CSV)</button>
        {isCollabMember && (
          <button className="menu-item text-red-300" onClick={async () => { setMoreOpen(false); await api(`playlists/${data.id}`, { method: 'DELETE' }).catch(() => {}); window.dispatchEvent(new Event('spx:playlists-changed')); nav('/library'); }}>
            <LogOut className="h-5 w-5" /> Sair da colaboração
          </button>
        )}
        {data.is_owner && (
          <button className="menu-item text-red-300" onClick={() => { setMoreOpen(false); setConfirmDel(true); }}><Trash2 className="h-5 w-5" /> Excluir playlist</button>
        )}
      </Sheet>
      <Confirm
        open={confirmDel}
        title={`Excluir "${data.name}"?`}
        text="Você pode recuperá-la por 30 dias em Biblioteca › Playlists excluídas."
        confirmLabel="Excluir"
        danger
        onClose={() => setConfirmDel(false)}
        onConfirm={async () => {
          try {
            await api(`playlists/${data.id}`, { method: 'DELETE' });
            window.dispatchEvent(new Event('spx:playlists-changed'));
            toast('Playlist excluída', 'info', { label: 'Desfazer', run: () => api(`playlists/${data.id}/restore`, { method: 'POST' }).then(() => { window.dispatchEvent(new Event('spx:playlists-changed')); nav(`/playlist/${data.id}`); }) });
            nav('/library');
          } catch (e) {
            toast(errText(e), 'error');
          }
        }}
      />
    </div>
  );
}

function EditSheet({ open, onClose, data, onSaved }: { open: boolean; onClose: () => void; data: PlaylistDetail; onSaved: (d: PlaylistDetail) => void }) {
  const toast = useToast();
  const [name, setName] = useState(data.name);
  const [description, setDescription] = useState(data.description || '');
  const [visibility, setVisibility] = useState(data.visibility);
  const [collab, setCollab] = useState(data.is_collaborative);
  const [cover, setCover] = useState<string | null>(data.cover_url);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    if (open) { setName(data.name); setDescription(data.description || ''); setVisibility(data.visibility); setCollab(data.is_collaborative); setCover(data.cover_url); }
  }, [open, data]);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try { setCover(await uploadSquareImage(f, 640)); } catch (e) { toast(errText(e, (e as Error).message), 'error'); } finally { setUploading(false); }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await api<PlaylistDetail>(`playlists/${data.id}`, { method: 'PATCH', body: { name, description, visibility, is_collaborative: collab, cover_url: cover } });
      onSaved(d);
      onClose();
      toast('Playlist atualizada', 'ok');
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Editar detalhes" wide>
      <form onSubmit={save} className="grid gap-4 pt-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <div className="mx-auto w-40 sm:mx-0">
          <label className="group relative block cursor-pointer">
            <Cover url={cover} mosaic={data.mosaic} alt="Capa" className="w-full" />
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-md bg-black/60 text-sm font-semibold opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
              {uploading ? <Spinner className="h-6 w-6" /> : <ImagePlus className="h-7 w-7" />} Escolher foto
            </span>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          {cover && <button type="button" className="mt-1 min-h-11 w-full text-xs text-muted hover:text-white" onClick={() => setCover(null)}>Usar capa automática</button>}
        </div>
        <div className="min-w-0 space-y-4">
          <Field label="Nome"><input className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Descrição" hint={`${description.length}/300`}><textarea className="input min-h-20 py-3" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="Visibilidade">
            <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as PlaylistDetail['visibility'])}>
              <option value="private">Privada</option>
              <option value="public">Pública (aparece na busca)</option>
              <option value="link">Somente por link</option>
            </select>
          </Field>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Colaborativa</span>
            <Toggle checked={collab} onChange={setCollab} label="Colaborativa" />
          </div>
          <button className="btn-primary w-full" disabled={busy || uploading || !name.trim()}>{busy && <Spinner className="h-4 w-4" />} Salvar</button>
        </div>
      </form>
    </Sheet>
  );
}

function ShareSheet({ open, onClose, data, onChanged }: { open: boolean; onClose: () => void; data: PlaylistDetail; onChanged: () => void }) {
  const toast = useToast();
  const url = shareUrl(`s/${data.share_token}`);
  const makeLink = async () => {
    try {
      await api(`playlists/${data.id}/share`, { body: { make_link: true } });
      toast('Agora qualquer pessoa com o link pode ver', 'ok');
      onChanged();
    } catch (e) {
      toast(errText(e), 'error');
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Compartilhar">
      <div className="space-y-4 pt-2">
        {data.visibility === 'private' && (
          <div className="rounded-xl bg-amber-500/15 p-3 text-sm text-amber-100">
            Esta playlist é privada: só você e colaboradores conseguem abrir o link.
            {data.is_owner && <button className="mt-2 block min-h-11 font-semibold underline" onClick={makeLink}>Permitir acesso por link</button>}
          </div>
        )}
        <QrBlock url={url} />
        <CopyRow url={url} />
        {'share' in navigator && (
          <button className="btn-primary w-full" onClick={() => navigator.share({ title: data.name, text: `Ouça "${data.name}" no KeshTune`, url }).catch(() => {})}>
            <Share2 className="h-4 w-4" /> Enviar por…
          </button>
        )}
      </div>
    </Sheet>
  );
}

function CollabSheet({ open, onClose, data, onChanged }: { open: boolean; onClose: () => void; data: PlaylistDetail; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const inviteUrl = data.invite_token ? shareUrl(`invite/${data.invite_token}`) : null;
  const make = async (regenerate = false) => {
    setBusy(true);
    try {
      await api(`playlists/${data.id}/collaborators`, { body: { regenerate } });
      onChanged();
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Colaboradores">
      <div className="space-y-4 pt-2">
        <p className="text-sm text-muted">Quem entrar pelo convite pode adicionar, remover e reordenar faixas (até 200 colaboradores).</p>
        {inviteUrl && data.is_collaborative ? (
          <>
            <QrBlock url={inviteUrl} />
            <CopyRow url={inviteUrl} />
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" disabled={busy} onClick={() => make(true)}>Gerar novo link</button>
              <button className="btn-secondary" disabled={busy} onClick={async () => { await api(`playlists/${data.id}/invite`, { method: 'DELETE' }).catch(() => {}); onChanged(); }}>Desativar link</button>
            </div>
          </>
        ) : (
          <button className="btn-primary w-full" disabled={busy} onClick={() => make(false)}>{busy && <Spinner className="h-4 w-4" />} <UserPlus className="h-4 w-4" /> Criar link de convite</button>
        )}
        <ul className="divide-y divide-line">
          {data.collaborators.map((c) => (
            <li key={c.id} className="flex min-h-14 items-center gap-3">
              <span className="min-w-0 flex-1 truncate">{c.display_name}</span>
              <span className="text-xs text-muted">{c.role === 'owner' ? 'Dono' : 'Editor'}</span>
              {c.role !== 'owner' && (
                <button className="icon-btn text-red-300" aria-label={`Remover ${c.display_name}`} onClick={async () => { await api(`playlists/${data.id}/collaborators/${c.id}`, { method: 'DELETE' }).catch((e) => toast(errText(e), 'error')); onChanged(); }}>
                  <X className="h-5 w-5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

function AddSongsSheet({ open, onClose, onAdd, existing }: { open: boolean; onClose: () => void; onAdd: (t: Track) => Promise<void>; existing: Set<string> }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Track[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setQ(''); setRes([]); } }, [open]);
  useEffect(() => {
    if (!q.trim()) { setRes([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      setBusy(true);
      api<{ tracks: Track[] }>(`search?type=track&limit=30&q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal })
        .then((r) => setRes(r.tracks || []))
        .catch(() => {})
        .finally(() => setBusy(false));
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  return (
    <Sheet open={open} onClose={onClose} title="Adicionar músicas" wide>
      <div className="sticky top-0 z-10 bg-surface2 pb-3 pt-2">
        <input className="input" autoFocus placeholder="Buscar músicas ou artistas" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar músicas" />
      </div>
      {busy && <div className="flex justify-center py-4"><Spinner className="h-5 w-5 text-muted" /></div>}
      <ul>
        {res.map((t) => (
          <li key={t.id} className="flex min-h-14 items-center gap-3">
            <Cover url={t.cover_url} alt="" className="h-11 w-11 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{t.title}</span>
              <span className="block truncate text-xs text-muted">{t.artists.map((a) => a.name).join(', ')}</span>
            </span>
            <button className="chip min-h-11 shrink-0" onClick={() => onAdd(t)}>{existing.has(t.id) ? 'Adicionar de novo' : 'Adicionar'}</button>
          </li>
        ))}
      </ul>
      {q && !busy && !res.length && <p className="py-6 text-center text-sm text-muted">Nada encontrado.</p>}
    </Sheet>
  );
}
