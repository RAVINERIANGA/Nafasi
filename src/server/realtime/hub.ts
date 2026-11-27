import type { WsEvent } from "@/domain/types";

type Listener = (event: WsEvent) => void;

type Hub = { listeners: Set<Listener>; pending: WsEvent[] };

const g = globalThis as typeof globalThis & { __nafasiHub?: Hub };

function hub(): Hub {
  if (!g.__nafasiHub) g.__nafasiHub = { listeners: new Set(), pending: [] };
  return g.__nafasiHub;
}

export function queueWs(event: WsEvent) {
  hub().pending.push(event);
}

export function drainWs() {
  return hub().pending.splice(0, hub().pending.length);
}

export function publish(event: WsEvent) {
  for (const listener of hub().listeners) listener(event);
}

export function subscribe(listener: Listener) {
  hub().listeners.add(listener);
  return () => hub().listeners.delete(listener);
}

export function listenerCount() {
  return hub().listeners.size;
}
