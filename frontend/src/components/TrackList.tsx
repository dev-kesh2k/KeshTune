import { Link } from 'react-router-dom';
import { CheckCircle2, CircleArrowDown, Clock3, Heart, MoreHorizontal, Play, Youtube } from 'lucide-react';
import { artistNames, fmtDate, fmtTime } from '../lib/format';
import { usePlayer } from '../lib/player';
import type { Track } from '../lib/types';
import { useUi } from './TrackActions';
import { Cover } from './ui';

export function Equalizer() {
  return (
    <span className="flex h-4 items-end gap-[2px]" aria-label="Tocando">
      {[0, 0.2, 0.4].map((d) => (
        <span key={d} className="eq-bar block w-[3px] rounded-sm bg-accent-soft" style={{ height: '100%', animationDelay: `${d}s` }} />
      ))}
    </span>
  );
}

export function Explicit() {
  return <span className="inline-flex h-4 shrink-0 items-center rounded-sm bg-white/60 px-1 text-[10px] font-bold text-black" title="Explícito">E</span>;
}

export function DlBadge({ id }: { id: string }) {
  const ui = useUi();
  const st = ui.dlState(id);
  if (!st) return null;
  if (st === 'READY') return <CheckCircle2 className="h-4 w-4 shrink-0 text-accent-soft" aria-label="Baixada" />;
  if (st === 'EXPIRING') return <CheckCircle2 className="h-4 w-4 shrink-0 text-amber-400" aria-label="Licença vencendo" />;
  if (st === 'DOWNLOADING' || st === 'QUEUED')
    return (
      <span className="relative inline-flex h-4 w-4 shrink-0" aria-label={`Baixando ${ui.dlProgress(id) ?? 0}%`}>
        <CircleArrowDown className="h-4 w-4 animate-pulse text-accent-soft" />
      </span>
    );
  if (st === 'FAILED' || st === 'EXPIRED') return <CircleArrowDown className="h-4 w-4 shrink-0 text-red-400" aria-label="Falha no download" />;
  return null;
}

type RowProps = {
  track: Track;
  index: number;
  onPlay: () => void;
  showCover?: boolean;
  showAlbum?: boolean;
  addedAt?: string;
  numbered?: boolean;
  onRemove?: () => void;
  removeLabel?: string;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  dragHandle?: React.ReactNode;
};

export function TrackRow({ track: t, index, onPlay, showCover = true, showAlbum, addedAt, numbered, onRemove, removeLabel, selectable, selected, onSelect, dragHandle }: RowProps) {
  const player = usePlayer();
  const ui = useUi();
  const isCurrent = player.current?.track.id === t.id;
  const liked = ui.isLiked(t);
  return (
    <div
      className={`group grid min-h-14 cursor-pointer select-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-white/[0.06] md:px-3 ${
        selected ? 'bg-accent/20' : ''
      } ${!t.playable ? 'opacity-45' : ''}`}
      onClick={() => (selectable ? onSelect?.() : t.playable && onPlay())}
      onContextMenu={(e) => {
        e.preventDefault();
        ui.openTrackMenu(t, { onRemove, removeLabel });
      }}
    >
      <div className="flex items-center gap-3">
        {dragHandle}
        {selectable && (
          <input type="checkbox" className="h-5 w-5 accent-[#8b5cf6]" checked={!!selected} onChange={() => onSelect?.()} onClick={(e) => e.stopPropagation()} aria-label={`Selecionar ${t.title}`} />
        )}
        {numbered && (
          <span className="hidden w-6 text-center text-sm tabular-nums text-muted sm:block">
            {isCurrent && player.playing ? <Equalizer /> : <span className="group-hover:hidden">{index + 1}</span>}
            {!(isCurrent && player.playing) && <Play className="mx-auto hidden h-4 w-4 fill-white text-white group-hover:block" />}
          </span>
        )}
        {showCover && (
          <div className="relative h-11 w-11 shrink-0">
            <Cover url={t.cover_url} alt={t.title} className="h-11 w-11" />
            {isCurrent && player.playing && !numbered && (
              <span className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50"><Equalizer /></span>
            )}
          </div>
        )}
      </div>
      <div className="min-w-0 md:grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:items-center md:gap-4">
        <div className="min-w-0">
          <p className={`truncate text-[15px] font-medium ${isCurrent ? 'text-accent-soft' : ''}`}>{t.title}</p>
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
            {t.explicit && <Explicit />}
            <DlBadge id={t.id} />
            {t.source === 'youtube' && <Youtube className="h-4 w-4 shrink-0 text-red-400" aria-label="YouTube (só online)" />}
            <span className="truncate">
              {t.artists.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ', '}
                  <Link to={`/artist/${a.id}`} className="hover:text-white hover:underline" onClick={(e) => e.stopPropagation()}>
                    {a.name}
                  </Link>
                </span>
              ))}
              {!t.playable && t.unavailable_reason ? ` · ${t.unavailable_reason}` : ''}
            </span>
          </p>
        </div>
        {showAlbum && (
          <p className="hidden truncate text-sm text-muted md:block">
            {t.album ? (
              <Link to={`/album/${t.album.id}`} className="hover:text-white hover:underline" onClick={(e) => e.stopPropagation()}>
                {t.album.title}
              </Link>
            ) : addedAt ? (
              fmtDate(addedAt)
            ) : null}
          </p>
        )}
      </div>
      <div className="flex items-center">
        <button
          className={`icon-btn hidden sm:inline-flex ${liked ? 'text-accent' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
          aria-label={liked ? 'Remover das curtidas' : 'Curtir'}
          onClick={(e) => {
            e.stopPropagation();
            ui.toggleLike(t);
          }}
        >
          <Heart className={`h-[18px] w-[18px] ${liked ? 'fill-accent' : ''}`} />
        </button>
        <span className="hidden w-12 text-right text-sm tabular-nums text-muted sm:block">{t.duration_ms ? fmtTime(t.duration_ms) : '–'}</span>
        <button
          className="icon-btn"
          aria-label={`Mais opções de ${t.title}`}
          onClick={(e) => {
            e.stopPropagation();
            ui.openTrackMenu(t, { onRemove, removeLabel });
          }}
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export function TrackListHeader({ showAlbum, numbered, albumLabel = 'Álbum' }: { showAlbum?: boolean; numbered?: boolean; albumLabel?: string }) {
  return (
    <div className="mb-2 hidden grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-3 pb-2 text-xs uppercase tracking-wider text-muted md:grid">
      <span className={numbered ? 'w-6 text-center' : 'w-11'}>#</span>
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4">
        <span>Título</span>
        {showAlbum && <span>{albumLabel}</span>}
      </div>
      <span className="flex w-[100px] justify-end pr-14">
        <Clock3 className="h-4 w-4" />
      </span>
    </div>
  );
}

export function TrackList({ tracks, onPlay, ...rest }: { tracks: Track[]; onPlay: (i: number) => void } & Omit<RowProps, 'track' | 'index' | 'onPlay'>) {
  return (
    <div className="min-w-0">
      {tracks.map((t, i) => (
        <TrackRow key={`${t.id}-${i}`} track={t} index={i} onPlay={() => onPlay(i)} {...rest} />
      ))}
    </div>
  );
}
