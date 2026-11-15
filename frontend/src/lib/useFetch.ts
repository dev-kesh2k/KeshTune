import { useCallback, useEffect, useRef, useState } from 'react';
import { api, NetworkError, errText } from './api';

export function useFetch<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(
    async (quiet = false) => {
      if (!path) return;
      const s = ++seq.current;
      if (!quiet) setLoading(true);
      try {
        const r = await api<T>(path);
        if (s === seq.current) {
          setData(r);
          setError(null);
          setOffline(false);
        }
      } catch (e) {
        if (s === seq.current && !quiet) {
          setError(e instanceof NetworkError ? 'Você está sem conexão. Abra Downloads para ouvir o que foi baixado.' : errText(e));
          setOffline(e instanceof NetworkError);
        }
      } finally {
        if (s === seq.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, ...deps]
  );
  useEffect(() => {
    // Ao trocar de página o erro da anterior não pode ficar na tela enquanto a nova carrega
    setData(null);
    setError(null);
    setOffline(false);
    load();
  }, [load]);
  return { data, setData, error, offline, loading, reload: load };
}
