import { useEffect } from 'react';

/** Título da aba/janela: "<página> · KeshTune" (volta para "KeshTune" ao sair da página). */
export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · KeshTune` : 'KeshTune';
    return () => { document.title = 'KeshTune'; };
  }, [title]);
}
