import { Link } from 'react-router-dom';
import { BadgeCheck, Play, UserRound } from 'lucide-react';
import { albumType, artistNames } from '../lib/format';
import type { AlbumCard, ArtistCard, PlaylistCard } from '../lib/types';
import { Cover } from './ui';

const tile = 'group block w-[clamp(8.5rem,38vw,11rem)] shrink-0 rounded-xl p-2 transition hover:bg-white/[0.06] sm:w-44';
const gridTile = 'group block min-w-0 rounded-xl p-2 transition hover:bg-white/[0.06]';

function PlayHint() {
  return (
    <span className="absolute bottom-2 right-2 hidden h-11 w-11 items-center justify-center rounded-full bg-accent shadow-xl group-hover:flex">
      <Play className="h-5 w-5 fill-white text-white" />
    </span>
  );
}

export function AlbumTile({ a, grid }: { a: AlbumCard; grid?: boolean }) {
  return (
    <Link to={`/album/${a.id}`} className={grid ? gridTile : tile}>
      <div className="relative mb-2">
        <Cover url={a.cover_url} alt={a.title} className="w-full shadow-lg" />
        <PlayHint />
      </div>
      <p className="truncate text-sm font-semibold">{a.title}</p>
      <p className="truncate text-xs text-muted">
        {a.release_date ? `${a.release_date.slice(0, 4)} · ` : ''}
        {artistNames(a.artists) || albumType(a.type)}
      </p>
    </Link>
  );
}

export function PlaylistTile({ p, grid }: { p: PlaylistCard; grid?: boolean }) {
  return (
    <Link to={`/playlist/${p.id}`} className={grid ? gridTile : tile}>
      <div className="relative mb-2">
        <Cover url={p.cover_url} mosaic={p.mosaic} alt={p.name} className="w-full shadow-lg" />
        <PlayHint />
      </div>
      <p className="truncate text-sm font-semibold">{p.name}</p>
      <p className="truncate text-xs text-muted">Por {p.owner_name} · {p.track_count} faixas</p>
    </Link>
  );
}

export function ArtistTile({ a, grid }: { a: ArtistCard; grid?: boolean }) {
  return (
    <Link to={`/artist/${a.id}`} className={grid ? gridTile : tile}>
      <Cover url={a.image_url} alt={a.name} round className="mb-2 w-full shadow-lg" icon={<UserRound className="h-1/3 w-1/3" />} />
      <p className="flex items-center gap-1 truncate text-sm font-semibold">
        <span className="truncate">{a.name}</span>
        {a.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-sky-400" />}
      </p>
      <p className="text-xs text-muted">Artista</p>
    </Link>
  );
}

export const tileGrid = 'grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';
