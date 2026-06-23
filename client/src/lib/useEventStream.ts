import { useEffect, useRef } from 'react';

export interface EventStreamHandlers {
  // Default `data:` messages, JSON-parsed.
  onMessage?: (data: any) => void;
  // Named SSE events (e.g. scan's `done`), JSON-parsed when a payload exists.
  onNamed?: Record<string, (data: any) => void>;
  // The EventSource `error` event. `serverError` is set when the server
  // explicitly emitted `event: error` with a JSON payload; `closed` is true
  // when the transport itself closed (mirrors readyState === CLOSED checks in
  // the original UI).
  onError?: (info: { serverError?: { error: string }; closed: boolean }) => void;
}

// Opens an EventSource for `url` and tears it down on unmount or when `url`
// changes (pass null to keep it closed). Handlers are read through a ref so
// re-renders don't reconnect — only a url change does.
export function useEventStream(url: string | null, handlers: EventStreamHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!url) return;
    const es = new EventSource(url);

    es.onmessage = (e) => ref.current.onMessage?.(JSON.parse(e.data));

    const cleanups: Array<() => void> = [];
    for (const [name, fn] of Object.entries(ref.current.onNamed || {})) {
      const listener = (e: MessageEvent) =>
        fn(e.data ? JSON.parse(e.data) : undefined);
      es.addEventListener(name, listener as EventListener);
      cleanups.push(() => es.removeEventListener(name, listener as EventListener));
    }

    es.addEventListener('error', (e: any) => {
      ref.current.onError?.({
        serverError: e?.data ? JSON.parse(e.data) : undefined,
        closed: es.readyState === EventSource.CLOSED,
      });
    });

    return () => {
      cleanups.forEach((c) => c());
      es.close();
    };
  }, [url]);
}
