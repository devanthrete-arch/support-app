import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, errorText } from './api';
export function useRefresh<T>(identity: string, load: () => Promise<T>) {
  const loader = useRef(load);
  loader.current = load;
  const sequence = useRef(0);
  const [state, setState] = useState<{
    identity: string;
    data?: T;
    error: string;
    busy: boolean;
    updated?: Date;
  }>({ identity, error: '', busy: true });
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setState((old) =>
      old.identity === identity
        ? { ...old, busy: true, error: '' }
        : { identity, busy: true, error: '' },
    );
    try {
      const data = await loader.current();
      if (request === sequence.current)
        setState({ identity, data, busy: false, error: '', updated: new Date() });
      return data;
    } catch (error) {
      if (request === sequence.current)
        setState((old) => ({
          ...old,
          identity,
          busy: false,
          error: errorText(error),
          ...(error instanceof ApiError && [403, 404].includes(error.status)
            ? { data: undefined }
            : {}),
        }));
      throw error;
    }
  }, [identity]);
  useEffect(() => {
    void refresh().catch(() => undefined);
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh().catch(() => undefined);
    };
    const timer = window.setInterval(tick, 30_000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      ++sequence.current;
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);
  return {
    ...(state.identity === identity
      ? state
      : { error: '', busy: true, data: undefined, updated: undefined }),
    refresh,
  };
}
