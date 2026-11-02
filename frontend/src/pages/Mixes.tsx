import { useEffect, useState } from 'react';
import { useFetch } from '../lib/useFetch';
import { ErrorBox, PageLoading, Section, Shelf, Spinner } from '../components/ui';
import { MixTile, type MixCard } from '../components/Tiles';
import { pagePad } from '../components/Layout';

type Mixes = { sections: { title: string; items: MixCard[] }[]; pending?: boolean };

/** Playlists do YouTube Music e mixes do YouTube (Seus mixes, artistas em alta), como na aba Mixes do app. */
export default function Mixes() {
  const { data, error, loading, offline, reload } = useFetch<Mixes>('youtube/mixes');
  // Servidor recém-ligado ainda montando as playlists do YouTube Music: pede de novo daqui a pouco
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!data?.pending || tries >= 8) return;
    const t = setTimeout(() => {
      setTries((n) => n + 1);
      reload(true);
    }, 15000);
    return () => clearTimeout(t);
  }, [data, tries, reload]);

  return (
    <div className={`${pagePad} pt-[max(1.25rem,env(safe-area-inset-top))] md:pt-6`}>
      <h1 className="text-[clamp(1.5rem,6vw,2.25rem)] font-black">Mixes</h1>
      <p className="mb-6 text-muted">Playlists do YouTube Music e mixes feitos para você</p>
      {loading ? (
        <PageLoading />
      ) : error ? (
        <ErrorBox text={error} offline={offline} onRetry={() => reload()} />
      ) : data ? (
        <>
          {data.sections.map((s) => (
            <Section key={s.title} title={s.title}>
              <Shelf>{s.items.map((m) => <MixTile key={m.id} m={m} />)}</Shelf>
            </Section>
          ))}
          {data.pending ? (
            <p className="flex items-center gap-3 py-4 text-muted"><Spinner className="h-5 w-5" /> Carregando as playlists do YouTube Music…</p>
          ) : !data.sections.length ? (
            <p className="py-4 text-muted">Nenhum mix disponível agora.</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
