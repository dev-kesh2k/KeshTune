import type { ReactNode } from 'react';
import { CircleArrowDown, CheckCircle2, Pause, Play, Shuffle } from 'lucide-react';
import { usePlayer, type PlayContext } from '../lib/player';
import type { Track } from '../lib/types';
import { useUi } from './TrackActions';
import { Spinner } from './ui';

export function CollectionHeader({
  cover, kind, title, meta, color = '#4c1d95', description,
}: { cover: ReactNode; kind: string; title: string; meta: ReactNode; color?: string; description?: ReactNode }) {
  return (
    <div
      className="px-4 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))] md:px-6 md:pt-8"
      style={{ background: `linear-gradient(180deg, ${color} 0%, ${color}80 60%, transparent 100%)` }}
    >
      <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:text-left">
        <div className="w-[min(60vw,14rem)] shrink-0 shadow-2xl sm:w-48 lg:w-56">{cover}</div>
        <div className="w-full min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/80">{kind}</p>
          <h1 className="my-1 break-words text-[clamp(1.6rem,7vw,3.5rem)] font-black leading-[1.05]">{title}</h1>
          {description && <p className="mb-1 line-clamp-3 break-words text-sm text-white/75">{description}</p>}
          <div className="flex flex-wrap items-center justify-center gap-x-1.5 text-sm text-white/85 sm:justify-start">{meta}</div>
        </div>
      </div>
    </div>
  );
}

/** Botões tocar/aleatório/baixar de uma coleção (playlist, álbum, artista...). */
export function PlayActions({ tracks, ctx, children }: { tracks: Track[]; ctx: PlayContext; children?: ReactNode }) {
  const p = usePlayer();
  const ui = useUi();
  const inCtx = p.context?.type === ctx.type && p.context?.id === ctx.id && !!p.current;
  const downloadable = tracks.filter((t) => t.downloadable);
  const states = downloadable.map((t) => ui.dlState(t.id));
  const allDone = downloadable.length > 0 && states.every((s) => s === 'READY' || s === 'EXPIRING');
  const busy = states.some((s) => s === 'QUEUED' || s === 'DOWNLOADING');
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-4 md:px-6">
      <button
        className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent shadow-lg transition hover:scale-105 hover:bg-accent-soft active:scale-95 disabled:opacity-40"
        aria-label={inCtx && p.playing ? 'Pausar' : 'Tocar'}
        disabled={!tracks.some((t) => t.playable)}
        onClick={() => (inCtx ? p.toggle() : p.playTracks(tracks, 0, ctx))}
      >
        {inCtx && p.playing ? <Pause className="h-6 w-6 fill-white" /> : <Play className="h-6 w-6 translate-x-[1px] fill-white" />}
      </button>
      <button
        className="icon-btn"
        aria-label="Tocar em ordem aleatória"
        disabled={!tracks.some((t) => t.playable)}
        onClick={() => {
          const playable = tracks.filter((t) => t.playable);
          if (!p.shuffle) p.toggleShuffle();
          p.playTracks(playable, Math.floor(Math.random() * playable.length), ctx);
        }}
      >
        <Shuffle className="h-6 w-6" />
      </button>
      {downloadable.length > 0 && (
        <button
          className={`icon-btn ${allDone ? 'text-accent-soft' : ''}`}
          aria-label={allDone ? 'Baixado' : 'Baixar'}
          title={allDone ? 'Baixado para ouvir offline' : 'Baixar para ouvir offline'}
          onClick={() => !allDone && ui.download(downloadable)}
        >
          {busy ? <Spinner className="h-6 w-6" /> : allDone ? <CheckCircle2 className="h-7 w-7" /> : <CircleArrowDown className="h-7 w-7" />}
        </button>
      )}
      {children}
    </div>
  );
}
