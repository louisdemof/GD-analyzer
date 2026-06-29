import { useSyncExternalStore } from 'react';

// Tiny global sync-status signal (no store dependency, so the storage layer can set it
// without import cycles). The TopBar subscribes via useSyncStatus().
export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

let current: SyncStatus = 'idle';
const listeners = new Set<() => void>();

export function setSyncStatus(s: SyncStatus) {
  if (s === current) return;
  current = s;
  listeners.forEach(l => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
