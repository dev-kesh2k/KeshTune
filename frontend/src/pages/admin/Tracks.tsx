import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, FileAudio, ImagePlus, Pencil, Plus, RotateCcw, Trash2, Upload, XCircle, Youtube, Ban } from 'lucide-react';
import { api, API, ApiError, errText, getTokens } from '../../lib/api';
import { fmtBytes, fmtTime } from '../../lib/format';
import { stripVideoTags } from '../../lib/text';
import { uploadSquareImage } from '../../lib/image';
import { useToast } from '../../lib/toast';
import { useFetch } from '../../lib/useFetch';
import type { Genre } from '../../lib/types';
import { Confirm, Cover, Empty, ErrorBox, Field, PageLoading, Sheet, Spinner, Toggle } from '../../components/ui';
import { SearchBar } from './AdminLayout';

type Credit = { id: string; name: string; role: string };
type AT = {
  id: string; title: string; source: 'file' | 'youtube'; youtube_id: string | null; status: 'active' | 'takedown'; takedown_reason: string | null; duration_ms: number;
  isrc: string | null; explicit: boolean; track_number: number | null; disc_number: number; lyrics: string | null; cover_url: string | null; audio_size: number | null;
  audio_mime: string | null; bitrate_kbps: number | null; album_id: string | null; album_title: string | null; album_cover: string | null; credits: Credit[]; genre_ids: number[]; plays: number;
};
type Meta = { title: string; artists: string[]; album: string | null; year: number | null; date: string | null; track_number: number | null; disc_number: number | null; isrc: string | null; genre: string | null; composers: string[]; label: string | null; lyrics: string | null; duration_ms: number; cover_url: string | null };

const names = (s: string) => s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
const byRole = (c: Credit[], r: string) => c.filter((x) => x.role === r).map((x) => x.name).join(', ');

async function uploadAudio(file: File, onProgress?: (p: number) => void): Promise<{ upload_id: string; meta: Meta; mime: string; size: number }> {
  // XHR para ter progresso de envio (arquivos grandes pelo celular)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}admin/uploads/audio`);
    const t = getTokens();
    if (t) xhr.setRequestHeader('Authorization', `Bearer ${t.access_token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body: any = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(xhr.status, body?.error?.code || 'UPLOAD', body?.error?.message || 'Falha no envio'));
    };
    xhr.onerror = () => reject(new Error('Falha de conexão no envio'));
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

function guessFromName(file: string) {
  const base = file.replace(/\.[^.]+$/, '').replace(/^\d+[\s.\-_]+/, '');
  const [a, ...rest] = base.split(' - ');
  return rest.length ? { artist: a.trim(), title: rest.join(' - ').trim() } : { artist: '', title: base.trim() };
}

export default function Tracks() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [deb, setDeb] = useState('');
  const [status, setStatus] = useState('all');
  useEffect(() => { const t = setTimeout(() => setDeb(q), 300); return () => clearTimeout(t); }, [q]);
  const { data, error, loading, reload } = useFetch<{ items: AT[] }>(`admin/tracks?q=${encodeURIComponent(deb)}&status=${status}`, [deb, status]);
  const [form, setForm] = useState<{ track?: AT } | null>(null);
  const [batch, setBatch] = useState(false);
  const [takedown, setTakedown] = useState<AT | null>(null);
  const [reason, setReason] = useState('');
  const [del, setDel] = useState<AT | null>(null);

  return (
    <div className="pb-6">
      <SearchBar value={q} onChange={setQ} placeholder="Buscar por título ou artista">
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
          <option value="all">Todas</option><option value="active">No ar</option><option value="takedown">Retiradas</option>
        </select>
        <button className="btn-secondary" onClick={() => setBatch(true)}><Upload className="h-4 w-4" /> Enviar vários</button>
        <button className="btn-primary" onClick={() => setForm({})}><Plus className="h-4 w-4" /> Nova música</button>
      </SearchBar>
      {loading ? <PageLoading /> : error ? <ErrorBox text={error} onRetry={() => reload()} /> : !data?.items.length ? (
        <Empty icon={<FileAudio className="h-10 w-10" />} title="Nenhuma música" text="Envie arquivos de áudio (MP3, M4A, OGG, FLAC, WAV) ou adicione links do YouTube." />
      ) : (
        <ul className="space-y-2">
          {data.items.map((t) => (
            <li key={t.id} className={`card flex flex-wrap items-center gap-3 p-3 ${t.status === 'takedown' ? 'opacity-70' : ''}`}>
              <Cover url={t.cover_url || t.album_cover} alt="" className="h-12 w-12 shrink-0" />
              <div className="min-w-0 flex-1 basis-40">
                <Link to={`/track/${t.id}`} className="block truncate font-semibold hover:underline">{t.title}</Link>
                <p className="truncate text-sm text-muted">{byRole(t.credits, 'main')}{t.album_title ? ` · ${t.album_title}` : ''}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  {t.source === 'youtube' ? <span className="inline-flex items-center gap-1 text-red-300"><Youtube className="h-3 w-3" /> YouTube</span> : <span>{t.audio_mime?.replace('audio/', '').toUpperCase()} · {fmtBytes(t.audio_size || 0)}{t.bitrate_kbps ? ` · ${t.bitrate_kbps} kbps` : ''}</span>}
                  <span>· {t.duration_ms ? fmtTime(t.duration_ms) : '--:--'}</span>
                  <span>· {t.plays} reproduções</span>
                  {t.status === 'takedown' && <span className="text-red-300">· Retirada: {t.takedown_reason}</span>}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button className="icon-btn" aria-label="Editar" onClick={() => setForm({ track: t })}><Pencil className="h-5 w-5" /></button>
                {t.status === 'active' ? (
                  <button className="icon-btn text-amber-300" aria-label="Retirar do ar" onClick={() => { setReason(''); setTakedown(t); }}><Ban className="h-5 w-5" /></button>
                ) : (
                  <button className="icon-btn text-emerald-300" aria-label="Devolver ao catálogo" onClick={async () => { await api(`admin/takedown/${t.id}`, { method: 'PATCH', body: { takedown: false } }).catch((e) => toast(errText(e), 'error')); reload(true); }}><RotateCcw className="h-5 w-5" /></button>
                )}
                <button className="icon-btn text-red-300" aria-label="Excluir" onClick={() => setDel(t)}><Trash2 className="h-5 w-5" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {form && <TrackForm track={form.track} onClose={(saved) => { setForm(null); if (saved) reload(true); }} />}
      <BatchUpload open={batch} onClose={() => { setBatch(false); reload(true); }} />
      <Sheet open={!!takedown} onClose={() => setTakedown(null)} title="Retirar do catálogo">
        <form className="space-y-4 pt-2" onSubmit={async (e) => { e.preventDefault(); try { await api(`admin/takedown/${takedown!.id}`, { method: 'PATCH', body: { takedown: true, reason } }); toast('Faixa retirada; downloads serão apagados na próxima sincronização', 'ok'); setTakedown(null); reload(true); } catch (err) { toast(errText(err), 'error'); } }}>
          <p className="text-sm text-muted">"{takedown?.title}" deixa de tocar para todos e some das buscas. Use para notificações de direitos autorais (prazo de 24 h).</p>
          <Field label="Motivo"><textarea className="input min-h-24 py-3" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: notificação de direitos autorais recebida em 01/11" /></Field>
          <button type="submit" className="btn-danger w-full">Retirar</button>
        </form>
      </Sheet>
      <Confirm open={!!del} title={`Excluir "${del?.title}"?`} text="Apaga a faixa, o arquivo de áudio e as contagens de reprodução. Para só tirar do ar, use Retirar." confirmLabel="Excluir" danger onClose={() => setDel(null)}
        onConfirm={async () => { try { await api(`admin/tracks/${del!.id}`, { method: 'DELETE' }); setDel(null); reload(true); toast('Faixa excluída'); } catch (e) { toast(errText(e), 'error'); } }} />
    </div>
  );
}

function GenrePicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const { data } = useFetch<{ items: Genre[] }>('browse/categories');
  return (
    <div className="space-y-2">
      {(['genre', 'mood'] as const).map((k) => (
        <div key={k} className="flex flex-wrap gap-1.5">
          {data?.items.filter((g) => g.kind === k).map((g) => {
            const on = value.includes(g.id);
            return (
              <button type="button" key={g.id} className={`chip min-h-9 ${on ? 'chip-on' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== g.id) : [...value, g.id])}>
                {g.name}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TrackForm({ track, onClose }: { track?: AT; onClose: (saved: boolean) => void }) {
  const toast = useToast();
  const editing = !!track;
  const [source, setSource] = useState<'file' | 'youtube'>(track?.source || 'file');
  const [upload, setUpload] = useState<{ id: string; name: string; size: number; duration: number } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [yt, setYt] = useState('');
  const [ytId, setYtId] = useState<string | null>(track?.youtube_id || null);
  const [f, setF] = useState({
    title: track?.title || '', artists: track ? byRole(track.credits, 'main') : '', featured: track ? byRole(track.credits, 'featured') : '',
    composers: track ? byRole(track.credits, 'composer') : '', producers: track ? byRole(track.credits, 'producer') : '',
    album_title: track?.album_title || '', album_type: 'album', release_date: '', label: '',
    track_number: track?.track_number ? String(track.track_number) : '', disc_number: String(track?.disc_number || 1),
    isrc: track?.isrc || '', explicit: track?.explicit || false, lyrics: track?.lyrics || '', duration: track?.duration_ms ? fmtTime(track.duration_ms) : '',
  });
  const [cover, setCover] = useState<string | null>(track?.cover_url || null);
  const [genres, setGenres] = useState<number[]>(track?.genre_ids || []);
  const [busy, setBusy] = useState(false);
  const albums = useFetch<{ items: { id: string; title: string; artists: { name: string }[] }[] }>('admin/albums');
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  const pickAudio = async (file?: File) => {
    if (!file) return;
    setProgress(0);
    try {
      const r = await uploadAudio(file, setProgress);
      setUpload({ id: r.upload_id, name: file.name, size: r.size, duration: r.meta.duration_ms });
      const g = guessFromName(file.name);
      setF((x) => ({
        ...x,
        title: x.title || r.meta.title || g.title,
        artists: x.artists || r.meta.artists.join(', ') || g.artist,
        composers: x.composers || r.meta.composers.join(', '),
        album_title: x.album_title || r.meta.album || '',
        release_date: x.release_date || r.meta.date || (r.meta.year ? `${r.meta.year}-01-01` : ''),
        label: x.label || r.meta.label || '',
        track_number: x.track_number || (r.meta.track_number ? String(r.meta.track_number) : ''),
        disc_number: r.meta.disc_number ? String(r.meta.disc_number) : x.disc_number,
        isrc: x.isrc || r.meta.isrc || '',
        lyrics: x.lyrics || r.meta.lyrics || '',
      }));
      if (!cover && r.meta.cover_url) setCover(r.meta.cover_url);
      toast('Arquivo enviado; confira os dados lidos das tags', 'ok');
    } catch (e) {
      toast(errText(e, (e as Error).message), 'error');
    } finally {
      setProgress(null);
    }
  };
  const lookupYt = async () => {
    try {
      const r = await api<{ youtube_id: string; title: string; author_name: string; thumbnail_url: string }>('admin/youtube/lookup', { body: { url: yt } });
      setYtId(r.youtube_id);
      const parts = r.title.split(' - ');
      setF((x) => ({ ...x, title: x.title || stripVideoTags(parts.length > 1 ? parts.slice(1).join(' - ') : r.title).trim(), artists: x.artists || (parts.length > 1 ? parts[0] : r.author_name) }));
      if (!cover) setCover(r.thumbnail_url);
    } catch (e) {
      toast(errText(e), 'error');
    }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!names(f.artists).length) return toast('Informe o artista principal', 'error');
    const dur = f.duration && /^\d+:\d{2}$/.test(f.duration) ? (Number(f.duration.split(':')[0]) * 60 + Number(f.duration.split(':')[1])) * 1000 : undefined;
    const body: Record<string, unknown> = {
      title: f.title, artists: names(f.artists), featured: names(f.featured), composers: names(f.composers), producers: names(f.producers),
      album_title: f.album_title || null, album_type: f.album_type, release_date: f.release_date || null, label: f.label || null,
      track_number: f.track_number || null, disc_number: f.disc_number || 1, isrc: f.isrc || null, explicit: f.explicit, lyrics: f.lyrics || null,
      cover_url: cover, genre_ids: genres, duration_ms: dur,
    };
    setBusy(true);
    try {
      if (editing) {
        if (!f.album_title) body.album_id = null;
        await api(`admin/tracks/${track!.id}`, { method: 'PATCH', body });
      } else {
        if (source === 'file') {
          if (!upload) throw new Error('Envie o arquivo de áudio');
          body.upload_id = upload.id;
        } else {
          if (!ytId) throw new Error('Busque o link do YouTube');
          body.youtube_url = ytId;
        }
        body.source = source;
        await api('admin/tracks', { body });
      }
      toast(editing ? 'Música atualizada' : 'Música adicionada ao catálogo', 'ok');
      onClose(true);
    } catch (e) {
      toast(e instanceof Error && !(e instanceof ApiError) ? e.message : errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={() => onClose(false)} title={editing ? 'Editar música' : 'Nova música'} wide>
      <form onSubmit={save} className="space-y-4 pt-2">
        {!editing && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={`chip min-h-11 justify-center ${source === 'file' ? 'chip-on' : ''}`} onClick={() => setSource('file')}><FileAudio className="h-4 w-4" /> Arquivo de áudio</button>
            <button type="button" className={`chip min-h-11 justify-center ${source === 'youtube' ? 'chip-on' : ''}`} onClick={() => setSource('youtube')}><Youtube className="h-4 w-4" /> YouTube</button>
          </div>
        )}
        {!editing && source === 'file' && (
          <div className="card p-3">
            <input ref={fileRef} type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.flac,.wav,.webm" className="sr-only" onChange={(e) => pickAudio(e.target.files?.[0])} />
            {upload ? (
              <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" /><span className="min-w-0 truncate">{upload.name} · {fmtBytes(upload.size)} · {fmtTime(upload.duration)}</span></p>
            ) : progress !== null ? (
              <div><p className="mb-2 text-sm">Enviando… {progress}%</p><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-accent" style={{ width: `${progress}%` }} /></div></div>
            ) : (
              <button type="button" className="btn-secondary w-full" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Escolher arquivo (MP3, M4A, OGG, FLAC, WAV · até 80 MB)</button>
            )}
            <p className="mt-2 text-xs text-muted">Título, artista, álbum, capa, ISRC e letra são lidos das tags do arquivo. Use só áudio próprio, licenciado ou de licença aberta.</p>
          </div>
        )}
        {!editing && source === 'youtube' && (
          <div className="card space-y-2 p-3">
            <div className="flex gap-2">
              <input className="input min-w-0 flex-1" inputMode="url" placeholder="https://www.youtube.com/watch?v=…" value={yt} onChange={(e) => setYt(e.target.value)} aria-label="Link do YouTube" />
              <button type="button" className="btn-secondary shrink-0" onClick={lookupYt} disabled={!yt.trim()}>Buscar</button>
            </div>
            {ytId && <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-5 w-5 text-emerald-400" /> Vídeo {ytId}</p>}
            <p className="text-xs text-muted">Toca pelo player oficial do YouTube, só online e com os anúncios que o YouTube exibir; não pode ser baixado.</p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <label className="group relative mx-auto block w-32 cursor-pointer sm:mx-0">
            <Cover url={cover} alt="Capa" className="w-full" />
            <span className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"><ImagePlus className="h-6 w-6" /></span>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={async (e) => { const file = e.target.files?.[0]; if (file) { try { setCover(await uploadSquareImage(file, 800)); } catch (err) { toast((err as Error).message, 'error'); } } }} />
          </label>
          <div className="min-w-0 space-y-3">
            <Field label="Título"><input className="input" required maxLength={200} value={f.title} onChange={(e) => set('title', e.target.value)} /></Field>
            <Field label="Artista(s) principal(is)" hint="Separe por vírgula. Artistas novos são criados automaticamente."><input className="input" required value={f.artists} onChange={(e) => set('artists', e.target.value)} /></Field>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Participações"><input className="input" value={f.featured} onChange={(e) => set('featured', e.target.value)} /></Field>
          <Field label="Compositores"><input className="input" value={f.composers} onChange={(e) => set('composers', e.target.value)} /></Field>
          <Field label="Produtores"><input className="input" value={f.producers} onChange={(e) => set('producers', e.target.value)} /></Field>
          <Field label="Álbum" hint="Escolha um existente ou digite um novo">
            <input className="input" list="album-list" value={f.album_title} onChange={(e) => set('album_title', e.target.value)} />
            <datalist id="album-list">{albums.data?.items.map((a) => <option key={a.id} value={a.title}>{a.artists.map((x) => x.name).join(', ')}</option>)}</datalist>
          </Field>
          {!editing && (
            <>
              <Field label="Tipo (álbum novo)">
                <select className="input" value={f.album_type} onChange={(e) => set('album_type', e.target.value)}>
                  <option value="album">Álbum</option><option value="single">Single</option><option value="ep">EP</option><option value="compilation">Coletânea</option>
                </select>
              </Field>
              <Field label="Data de lançamento"><input className="input" type="date" value={f.release_date} onChange={(e) => set('release_date', e.target.value)} /></Field>
              <Field label="Gravadora"><input className="input" value={f.label} onChange={(e) => set('label', e.target.value)} /></Field>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Faixa nº"><input className="input" inputMode="numeric" value={f.track_number} onChange={(e) => set('track_number', e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="Disco"><input className="input" inputMode="numeric" value={f.disc_number} onChange={(e) => set('disc_number', e.target.value.replace(/\D/g, ''))} /></Field>
          </div>
          <Field label="ISRC"><input className="input uppercase" maxLength={15} value={f.isrc} onChange={(e) => set('isrc', e.target.value)} placeholder="BRABC2400001" /></Field>
          {(source === 'youtube' || track?.source === 'youtube') && <Field label="Duração (m:ss)" hint="Opcional; o player preenche ao tocar"><input className="input" value={f.duration} onChange={(e) => set('duration', e.target.value)} placeholder="3:45" /></Field>}
        </div>
        <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Conteúdo explícito</span><Toggle checked={f.explicit} onChange={(v) => set('explicit', v)} label="Explícito" /></div>
        <Field label="Gêneros e humores"><GenrePicker value={genres} onChange={setGenres} /></Field>
        <Field label="Letra" hint="Texto simples ou LRC sincronizado: [00:12.50] primeira linha"><textarea className="input min-h-32 py-3 font-mono text-sm" value={f.lyrics} onChange={(e) => set('lyrics', e.target.value)} /></Field>
        <button type="submit" className="btn-primary w-full" disabled={busy || progress !== null}>{busy && <Spinner className="h-4 w-4" />} {editing ? 'Salvar alterações' : 'Adicionar ao catálogo'}</button>
      </form>
    </Sheet>
  );
}

type BatchItem = { file: File; status: 'waiting' | 'uploading' | 'done' | 'error'; progress: number; msg?: string };

function BatchUpload({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [defaultArtist, setDefaultArtist] = useState('');
  const [genres, setGenres] = useState<number[]>([]);
  const [running, setRunning] = useState(false);
  useEffect(() => { if (open) { setItems([]); setRunning(false); } }, [open]);
  const update = (i: number, p: Partial<BatchItem>) => setItems((l) => l.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const run = async () => {
    setRunning(true);
    for (let i = 0; i < items.length; i++) {
      if (items[i].status === 'done') continue;
      update(i, { status: 'uploading', progress: 0, msg: undefined });
      try {
        const r = await uploadAudio(items[i].file, (p) => update(i, { progress: p }));
        const g = guessFromName(items[i].file.name);
        const artists = r.meta.artists.length ? r.meta.artists : g.artist ? [g.artist] : names(defaultArtist);
        if (!artists.length) throw new Error('Sem artista nas tags; preencha o artista padrão');
        await api('admin/tracks', {
          body: {
            source: 'file', upload_id: r.upload_id, title: r.meta.title || g.title, artists, composers: r.meta.composers,
            album_title: r.meta.album, release_date: r.meta.date || (r.meta.year ? `${r.meta.year}-01-01` : null), label: r.meta.label,
            track_number: r.meta.track_number, disc_number: r.meta.disc_number || 1, isrc: r.meta.isrc, lyrics: r.meta.lyrics, cover_url: r.meta.cover_url, genre_ids: genres,
          },
        });
        update(i, { status: 'done', progress: 100 });
      } catch (e) {
        update(i, { status: 'error', msg: errText(e, (e as Error).message) });
      }
    }
    setRunning(false);
  };
  return (
    <Sheet open={open} onClose={() => !running && onClose()} title="Enviar vários arquivos" wide>
      <div className="space-y-4 pt-2">
        <p className="text-sm text-muted">Cada arquivo vira uma música usando as tags (título, artista, álbum, capa). Sem tags, usa o nome "Artista - Título.mp3".</p>
        <input type="file" multiple accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.flac,.wav" className="input py-2.5" disabled={running}
          onChange={(e) => setItems([...(e.target.files || [])].map((file) => ({ file, status: 'waiting', progress: 0 })))} aria-label="Arquivos de áudio" />
        <Field label="Artista padrão (se faltar nas tags)"><input className="input" value={defaultArtist} onChange={(e) => setDefaultArtist(e.target.value)} /></Field>
        <Field label="Gêneros para todas"><GenrePicker value={genres} onChange={setGenres} /></Field>
        {items.length > 0 && (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {items.map((it, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                {it.status === 'done' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" /> : it.status === 'error' ? <XCircle className="h-4 w-4 shrink-0 text-red-400" /> : it.status === 'uploading' ? <Spinner className="h-4 w-4 shrink-0" /> : <FileAudio className="h-4 w-4 shrink-0 text-muted" />}
                <span className="min-w-0 flex-1 truncate">{it.file.name}</span>
                <span className="shrink-0 text-xs text-muted">{it.status === 'uploading' ? `${it.progress}%` : it.status === 'error' ? 'erro' : ''}</span>
                {it.msg && <span className="w-full basis-full pl-6 text-xs text-red-300">{it.msg}</span>}
              </li>
            ))}
          </ul>
        )}
        <button className="btn-primary w-full" disabled={!items.length || running} onClick={run}>{running && <Spinner className="h-4 w-4" />} Enviar {items.length || ''} arquivo(s)</button>
      </div>
    </Sheet>
  );
}
