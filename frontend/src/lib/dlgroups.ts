import { useSyncExternalStore } from 'react';

/**
 * De onde vieram os downloads em lote (mix, playlist, álbum...), para a tela Downloads organizar por coleção, como no app.
 * Fica no navegador (localStorage): os arquivos baixados também são só deste aparelho.
 */
export type DlGroup = { id: string; title: string; kind: string; image: string | null; trackIds: string[]; createdAt: number };

const KEY = 'spx.dlgroups';
let cache: DlGroup[] | null = null;
const subs = new Set<() => void>();

function read(): DlGroup[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    cache = [];
  }
  return cache!;
}

function write(list: DlGroup[]) {
  cache = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* sem espaço ou bloqueado: vale só nesta sessão */ }
  subs.forEach((f) => f());
}

/** Registra (ou atualiza) a coleção; baixar de novo a mesma a sobe para o topo. */
export function saveGroup(g: Omit<DlGroup, 'createdAt'>) {
  write([{ ...g, createdAt: Date.now() }, ...read().filter((x) => x.id !== g.id)]);
}

export function removeGroup(id: string) {
  write(read().filter((x) => x.id !== id));
}

export function useDlGroups(): DlGroup[] {
  return useSyncExternalStore((f) => {
    subs.add(f);
    return () => subs.delete(f);
  }, read);
}
