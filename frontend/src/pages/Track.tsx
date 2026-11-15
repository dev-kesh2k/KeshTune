import { Link, useParams } from 'react-router-dom';
import { Heart, ListPlus, Radio, Share2 } from 'lucide-react';
import { artistNames, fmtDate, fmtTime } from '../lib/format';
import { usePlayer } from '../lib/player';
import { useFetch } from '../lib/useFetch';
import { useTitle } from '../lib/useTitle';
import type { Track as T } from '../lib/types';
import { CollectionHeader, PlayActions } from '../components/Collection';
import { useUi } from '../components/TrackActions';
import { Cover, ErrorBox, PageLoading, Section } from '../components/ui';
import { Explicit } from '../components/TrackList';
import { pagePad } from '../components/Layout';

type Detail = T & {
  isrc: string | null; lyrics: string | null; lyrics_synced: boolean; release_date: string | null; label: string | null; plays: number;
  credits: { id: string; name: string; role: string }[]; genres: { id: number; name: string; kind: string }[];
};
const ROLE: Record<string, string> = { main: 'Artista principal', featured: 'Participação', composer: 'Composição', producer: 'Produção' };

export default function Track() {
  const { id } = useParams();
  const { data, error, loading, offline, reload } = useFetch<Detail>(`tracks/${id}`, [id]);
  useTitle(data?.title);
  const player = usePlayer();
  const ui = useUi();
  if (loading) return <PageLoading />;
  if (error || !data) return <ErrorBox text={error || 'Faixa não encontrada'} offline={offline} onRetry={() => reload()} />;
  const liked = ui.isLiked(data);
  const lyricsText = data.lyrics_synced ? data.lyrics!.replace(/\[[^\]]*\]/g, '').replace(/\n{3,}/g, '\n\n').trim() : data.lyrics;
  return (
    <div>
      <CollectionHeader
        cover={<Cover url={data.cover_url} alt={data.title} className="w-full" />}
        kind="Música"
        title={data.title}
        meta={
          <>
            {data.explicit && <Explicit />}
            {data.artists.map((a, i) => (
              <span key={a.id}>
                {i > 0 && ', '}
                <Link to={`/artist/${a.id}`} className="font-bold hover:underline">{a.name}</Link>
              </span>
            ))}
            {data.album && <span>· <Link to={`/album/${data.album.id}`} className="hover:underline">{data.album.title}</Link></span>}
            {data.release_date && <span>· {data.release_date.slice(0, 4)}</span>}
            <span>· {fmtTime(data.duration_ms)}</span>
            <span>· {data.plays.toLocaleString('pt-BR')} reproduções</span>
          </>
        }
      />
      <PlayActions tracks={[data]} ctx={{ type: 'track', id: data.id, name: data.title }}>
        <button className={`icon-btn ${liked ? 'text-accent' : ''}`} aria-label={liked ? 'Remover das curtidas' : 'Curtir'} onClick={() => ui.toggleLike(data)}>
          <Heart className={`h-7 w-7 ${liked ? 'fill-accent' : ''}`} />
        </button>
        <button className="icon-btn" aria-label="Adicionar à playlist" onClick={() => ui.openAddToPlaylist([data])}>
          <ListPlus className="h-6 w-6" />
        </button>
        <button className="icon-btn" aria-label="Iniciar rádio" onClick={() => player.startRadio('track', data.id, data.title)}>
          <Radio className="h-6 w-6" />
        </button>
        <button className="icon-btn" aria-label="Compartilhar" onClick={() => ui.share(`track/${data.id}`, `${data.title} — ${artistNames(data.artists)}`)}>
          <Share2 className="h-6 w-6" />
        </button>
      </PlayActions>
      <div className={`${pagePad} grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]`}>
        <Section title="Letra">
          {lyricsText ? (
            <div className="card p-5">
              <p className="whitespace-pre-wrap break-words text-lg leading-relaxed text-white/90">{lyricsText}</p>
              {data.lyrics_synced && <p className="mt-4 text-xs text-muted">Letra sincronizada: abra a letra no player para acompanhar.</p>}
            </div>
          ) : (
            <p className="text-sm text-muted">Letra não disponível.</p>
          )}
        </Section>
        <Section title="Créditos">
          <div className="card divide-y divide-line">
            {data.credits.map((c) => (
              <Link key={`${c.id}-${c.role}`} to={`/artist/${c.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-white/[0.04]">
                <span className="min-w-0 truncate font-medium">{c.name}</span>
                <span className="shrink-0 text-xs text-muted">{ROLE[c.role] || c.role}</span>
              </Link>
            ))}
            <div className="space-y-1 px-4 py-3 text-xs text-muted">
              {data.genres.length > 0 && (
                <p>
                  {data.genres.map((g, i) => (
                    <span key={g.id}>{i > 0 && ' · '}<Link to={`/genre/${g.id}`} className="hover:text-white hover:underline">{g.name}</Link></span>
                  ))}
                </p>
              )}
              {data.release_date && <p>Lançamento: {fmtDate(data.release_date, { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
              {data.label && <p>℗ {data.label}</p>}
              {data.isrc && <p>ISRC {data.isrc}</p>}
              <p>Fonte: {data.source === 'youtube' ? 'YouTube (só online, player oficial)' : 'Biblioteca própria (pode baixar)'}</p>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
