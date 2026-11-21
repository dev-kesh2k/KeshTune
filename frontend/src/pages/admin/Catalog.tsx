import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Flame, ImagePlus, Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { api, errText } from '../../lib/api';
import { albumType, fmtDate } from '../../lib/format';
import { uploadSquareImage } from '../../lib/image';
import { useToast } from '../../lib/toast';
import { useFetch } from '../../lib/useFetch';
import type { Genre } from '../../lib/types';
import { Confirm, Cover, Empty, ErrorBox, Field, PageLoading, Sheet, Spinner, Toggle } from '../../components/ui';
import { SearchBar } from './AdminLayout';

function ImagePick({ value, onChange, round }: { value: string | null; onChange: (v: string | null) => void; round?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <label className="group relative mx-auto block w-32 cursor-pointer sm:mx-0">
      <Cover url={value} alt="Imagem" round={round} className="w-full" icon={round ? <UserRound className="h-1/3 w-1/3" /> : undefined} />
      <span className={`absolute inset-0 flex items-center justify-center bg-black/50 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 ${round ? 'rounded-full' : 'rounded-md'}`}>
        {busy ? <Spinner className="h-6 w-6" /> : <ImagePlus className="h-6 w-6" />}
      </span>
      <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setBusy(true);
        try { onChange(await uploadSquareImage(f, 800)); } catch (err) { toast((err as Error).message, 'error'); } finally { setBusy(false); }
      }} />
    </label>
  );
}

function useDebounced(v: string) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), 300); return () => clearTimeout(t); }, [v]);
  return d;
}

// ---------------- Artistas ----------------
type A = { id: string; name: string; bio: string | null; image_url: string | null; verified: boolean; country: string | null; track_count: number };
export function Artists() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useFetch<{ items: A[] }>(`admin/artists?q=${encodeURIComponent(dq)}`, [dq]);
  const [edit, setEdit] = useState<Partial<A> | null>(null);
  const [del, setDel] = useState<A | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: edit!.name, bio: edit!.bio || null, image_url: edit!.image_url || null, verified: !!edit!.verified, country: edit!.country || null };
      if (edit!.id) await api(`admin/artists/${edit!.id}`, { method: 'PATCH', body });
      else await api('admin/artists', { body });
      toast('Artista salvo', 'ok');
      setEdit(null);
      reload(true);
    } catch (err) { toast(errText(err), 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="pb-6">
      <SearchBar value={q} onChange={setQ} placeholder="Buscar artista">
        <button
          className="btn-secondary"
          title="Usa a foto do canal do YouTube com o mesmo nome do artista"
          onClick={async () => {
            try {
              const r = await api<{ pending: number }>('admin/artists/fetch-images', { method: 'POST' });
              toast(r.pending ? `Buscando fotos de ${r.pending} artistas em segundo plano` : 'Todos os artistas já têm foto', 'ok');
            } catch (err) { toast(errText(err), 'error'); }
          }}
        >
          <ImagePlus className="h-4 w-4" /> Buscar fotos
        </button>
        <button className="btn-primary" onClick={() => setEdit({ name: '' })}><Plus className="h-4 w-4" /> Novo artista</button>
      </SearchBar>
      {loading ? <PageLoading /> : error ? <ErrorBox text={error} onRetry={() => reload()} /> : !data?.items.length ? <Empty title="Nenhum artista" text="Artistas também são criados automaticamente ao adicionar músicas." /> : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((a) => (
            <li key={a.id} className="card flex items-center gap-3 p-3">
              <Cover url={a.image_url} alt="" round className="h-12 w-12 shrink-0" icon={<UserRound className="h-5 w-5" />} />
              <Link to={`/artist/${a.id}`} className="min-w-0 flex-1">
                <span className="flex items-center gap-1 truncate font-semibold">{a.name}{a.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-sky-400" />}</span>
                <span className="text-xs text-muted">{a.track_count} faixas{a.country ? ` · ${a.country}` : ''}</span>
              </Link>
              <button className="icon-btn" aria-label={`Editar ${a.name}`} onClick={() => setEdit(a)}><Pencil className="h-5 w-5" /></button>
              <button className="icon-btn text-red-300" aria-label={`Excluir ${a.name}`} onClick={() => setDel(a)}><Trash2 className="h-5 w-5" /></button>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Editar artista' : 'Novo artista'} wide>
        {edit && (
          <form onSubmit={save} className="grid gap-4 pt-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <ImagePick value={edit.image_url || null} onChange={(v) => setEdit({ ...edit, image_url: v })} round />
            <div className="min-w-0 space-y-3">
              <Field label="Nome"><input className="input" required maxLength={200} value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="País (sigla)"><input className="input uppercase" maxLength={2} value={edit.country || ''} onChange={(e) => setEdit({ ...edit, country: e.target.value })} placeholder="BR" /></Field>
              <Field label="Biografia"><textarea className="input min-h-28 py-3" maxLength={5000} value={edit.bio || ''} onChange={(e) => setEdit({ ...edit, bio: e.target.value })} /></Field>
              <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Verificado</span><Toggle checked={!!edit.verified} onChange={(v) => setEdit({ ...edit, verified: v })} label="Verificado" /></div>
              <button type="submit" className="btn-primary w-full" disabled={busy}>{busy && <Spinner className="h-4 w-4" />} Salvar</button>
            </div>
          </form>
        )}
      </Sheet>
      <Confirm open={!!del} title={`Excluir ${del?.name}?`} text="Só é possível excluir artistas sem faixas." confirmLabel="Excluir" danger onClose={() => setDel(null)}
        onConfirm={async () => { try { await api(`admin/artists/${del!.id}`, { method: 'DELETE' }); setDel(null); reload(true); } catch (e) { toast(errText(e), 'error'); setDel(null); } }} />
    </div>
  );
}

// ---------------- Álbuns ----------------
type Al = { id: string; title: string; type: string; release_date: string | null; label: string | null; upc: string | null; cover_url: string | null; artists: { id: string; name: string }[]; track_count: number };
export function Albums() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useFetch<{ items: Al[] }>(`admin/albums?q=${encodeURIComponent(dq)}`, [dq]);
  const [edit, setEdit] = useState<(Partial<Al> & { artistText?: string }) | null>(null);
  const [del, setDel] = useState<Al | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        title: edit!.title, type: edit!.type || 'album', release_date: edit!.release_date || null, label: edit!.label || null, upc: edit!.upc || null,
        cover_url: edit!.cover_url || null, artists: (edit!.artistText || '').split(',').map((x) => x.trim()).filter(Boolean),
      };
      if (!body.artists.length) throw new Error('Informe o artista');
      if (edit!.id) await api(`admin/albums/${edit!.id}`, { method: 'PATCH', body });
      else await api('admin/albums', { body });
      toast('Álbum salvo', 'ok');
      setEdit(null);
      reload(true);
    } catch (err) { toast(errText(err, (err as Error).message), 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="pb-6">
      <SearchBar value={q} onChange={setQ} placeholder="Buscar álbum">
        <button className="btn-primary" onClick={() => setEdit({ title: '', type: 'album', artistText: '' })}><Plus className="h-4 w-4" /> Novo álbum</button>
      </SearchBar>
      {loading ? <PageLoading /> : error ? <ErrorBox text={error} onRetry={() => reload()} /> : !data?.items.length ? <Empty title="Nenhum álbum" /> : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((a) => (
            <li key={a.id} className="card flex items-center gap-3 p-3">
              <Cover url={a.cover_url} alt="" className="h-12 w-12 shrink-0" />
              <Link to={`/album/${a.id}`} className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{a.title}</span>
                <span className="block truncate text-xs text-muted">{albumType(a.type)} · {a.artists.map((x) => x.name).join(', ')} · {a.track_count} faixas{a.release_date ? ` · ${fmtDate(a.release_date)}` : ''}</span>
              </Link>
              <button className="icon-btn" aria-label={`Editar ${a.title}`} onClick={() => setEdit({ ...a, artistText: a.artists.map((x) => x.name).join(', ') })}><Pencil className="h-5 w-5" /></button>
              <button className="icon-btn text-red-300" aria-label={`Excluir ${a.title}`} onClick={() => setDel(a)}><Trash2 className="h-5 w-5" /></button>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Editar álbum' : 'Novo álbum'} wide>
        {edit && (
          <form onSubmit={save} className="grid gap-4 pt-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <ImagePick value={edit.cover_url || null} onChange={(v) => setEdit({ ...edit, cover_url: v })} />
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Field label="Título"><input className="input" required maxLength={200} value={edit.title || ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field></div>
              <div className="sm:col-span-2"><Field label="Artista(s)" hint="Separe por vírgula"><input className="input" required value={edit.artistText || ''} onChange={(e) => setEdit({ ...edit, artistText: e.target.value })} /></Field></div>
              <Field label="Tipo">
                <select className="input" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
                  <option value="album">Álbum</option><option value="single">Single</option><option value="ep">EP</option><option value="compilation">Coletânea</option>
                </select>
              </Field>
              <Field label="Lançamento"><input className="input" type="date" value={edit.release_date || ''} onChange={(e) => setEdit({ ...edit, release_date: e.target.value })} /></Field>
              <Field label="Gravadora"><input className="input" value={edit.label || ''} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></Field>
              <Field label="UPC"><input className="input" inputMode="numeric" value={edit.upc || ''} onChange={(e) => setEdit({ ...edit, upc: e.target.value.replace(/\D/g, '') })} /></Field>
              <button type="submit" className="btn-primary w-full sm:col-span-2" disabled={busy}>{busy && <Spinner className="h-4 w-4" />} Salvar</button>
            </div>
          </form>
        )}
      </Sheet>
      <Confirm open={!!del} title={`Excluir o álbum "${del?.title}"?`} text="As faixas continuam no catálogo, só ficam sem álbum." confirmLabel="Excluir" danger onClose={() => setDel(null)}
        onConfirm={async () => { try { await api(`admin/albums/${del!.id}`, { method: 'DELETE' }); setDel(null); reload(true); } catch (e) { toast(errText(e), 'error'); } }} />
    </div>
  );
}

// ---------------- Gêneros ----------------
export function Genres() {
  const toast = useToast();
  const { data, error, loading, reload } = useFetch<{ items: Genre[] }>('browse/categories');
  const [edit, setEdit] = useState<Partial<Genre> | null>(null);
  const [del, setDel] = useState<Genre | null>(null);
  const [filling, setFilling] = useState<number | null>(null);
  /** Busca no YouTube as músicas em alta de cada gênero e cadastra (tocam online; nada é baixado). */
  const fill = async (list: Genre[]) => {
    let total = 0;
    for (const g of list) {
      setFilling(g.id);
      try {
        const r = await api<{ added: number; linked: number }>(`admin/genres/${g.id}/trending`, { body: { limit: 100 } });
        total += r.added;
        toast(`${g.name}: ${r.added} novas, ${r.linked} já estavam no catálogo`, 'ok');
        reload(true);
      } catch (err) {
        toast(`${g.name}: ${errText(err)}`, 'error');
      }
    }
    setFilling(null);
    if (list.length > 1) toast(`Pronto: ${total} músicas novas no catálogo`, 'ok');
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (edit!.id) await api(`admin/genres/${edit!.id}`, { method: 'PATCH', body: { name: edit!.name, color: edit!.color } });
      else await api('admin/genres', { body: edit });
      setEdit(null);
      reload(true);
    } catch (err) { toast(errText(err), 'error'); }
  };
  if (loading) return <PageLoading />;
  if (error) return <ErrorBox text={error} onRetry={() => reload()} />;
  return (
    <div className="space-y-6 pb-6">
      {(['genre', 'mood'] as const).map((k) => (
        <section key={k}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-bold">{k === 'genre' ? 'Gêneros' : 'Humores / momentos'}</h2>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" disabled={filling !== null} onClick={() => fill(data!.items.filter((g) => g.kind === k))}>
                <Flame className="h-4 w-4" /> Preencher todos com músicas em alta
              </button>
              <button className="btn-secondary" onClick={() => setEdit({ kind: k, name: '', color: '#7c5cff' })}><Plus className="h-4 w-4" /> Adicionar</button>
            </div>
          </div>
          <ul className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-4">
            {data?.items.filter((g) => g.kind === k).map((g) => (
              <li key={g.id} className="card flex items-center gap-2 p-2 pl-3">
                <span className="h-5 w-5 shrink-0 rounded" style={{ background: g.color }} />
                <span className="min-w-0 flex-1 truncate text-sm">{g.name} <span className="text-muted">({g.track_count})</span></span>
                <button className="icon-btn" aria-label={`Músicas em alta: ${g.name}`} title="Buscar 100 músicas em alta no YouTube" disabled={filling !== null} onClick={() => fill([g])}>
                  {filling === g.id ? <Spinner className="h-4 w-4" /> : <Flame className="h-4 w-4" />}
                </button>
                <button className="icon-btn" aria-label={`Editar ${g.name}`} onClick={() => setEdit(g)}><Pencil className="h-4 w-4" /></button>
                <button className="icon-btn text-red-300" aria-label={`Excluir ${g.name}`} onClick={() => setDel(g)}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Editar' : 'Adicionar'}>
        {edit && (
          <form onSubmit={save} className="space-y-4 pt-2">
            <Field label="Nome"><input className="input" required maxLength={60} value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Cor"><input className="input h-12 p-1" type="color" value={edit.color || '#7c5cff'} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></Field>
            <button type="submit" className="btn-primary w-full">Salvar</button>
          </form>
        )}
      </Sheet>
      <Confirm open={!!del} title={`Excluir "${del?.name}"?`} text="As faixas deixam de estar classificadas nele." confirmLabel="Excluir" danger onClose={() => setDel(null)}
        onConfirm={async () => { await api(`admin/genres/${del!.id}`, { method: 'DELETE' }).catch((e) => toast(errText(e), 'error')); setDel(null); reload(true); }} />
    </div>
  );
}
