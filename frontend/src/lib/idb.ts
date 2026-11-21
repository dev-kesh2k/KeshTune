// IndexedDB mínimo (banco local do aparelho, seção 7.4)
const DB = 'spotify-x';
let dbp: Promise<IDBDatabase> | null = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('downloads')) d.createObjectStore('downloads', { keyPath: 'track_id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('Não foi possível abrir o banco local'));
    });
  }
  return dbp;
}
function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error('Falha no banco local'));
      })
  );
}
export const kvGet = <T = any>(k: string) => run<T | undefined>('kv', 'readonly', (s) => s.get(k));
export const kvSet = (k: string, v: unknown) => run('kv', 'readwrite', (s) => s.put(v, k));
export const kvDel = (k: string) => run('kv', 'readwrite', (s) => s.delete(k));
export const dlAll = <T = any>() => run<T[]>('downloads', 'readonly', (s) => s.getAll());
export const dlGet = <T = any>(id: string) => run<T | undefined>('downloads', 'readonly', (s) => s.get(id));
export const dlPut = (v: unknown) => run('downloads', 'readwrite', (s) => s.put(v));
export const dlDel = (id: string) => run('downloads', 'readwrite', (s) => s.delete(id));
