"use client";

import { useSyncExternalStore } from "react";

// module-level, not React state - a Server Action's refresh() (called by
// reviewAuditEntry) re-renders the page's Server Component tree, and if
// that causes a client component wrapping this in a Provider to be treated
// as a fresh instance instead of reconciled in place, plain useState here
// would silently reset, wiping out everything else you'd simulated. a
// module-level array lives outside the React tree entirely, so it
// survives that - while still genuinely resetting on an actual page
// reload, since that re-runs this whole module fresh
let simulatedRecordIds: string[] = [];

// bumped on every simulate, even one for a record already in the list
// above. the list itself only changes shape the *first* time a given
// record is simulated - if PendingReviews only resubscribed to changes in
// the list, simulating the same record a second time would be a no-op:
// nothing in the list actually changed, so nothing would tell it to
// refetch, and it would keep showing whatever was there before
let version = 0;

// true for the span of the Simulate button's own submit, so the "Simulate"
// stage in the Workflow run diagram can actually light up - by the time an
// entry shows up there at all, the submit that created it has already
// finished, so entry !== null alone can never mean "Simulate" is active
let simulating = false;

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getIdsSnapshot(): string[] {
  return simulatedRecordIds;
}

function getVersionSnapshot(): number {
  return version;
}

function getServerIdsSnapshot(): string[] {
  return [];
}

function getServerVersionSnapshot(): number {
  return 0;
}

function getSimulatingSnapshot(): boolean {
  return simulating;
}

function getServerSimulatingSnapshot(): boolean {
  return false;
}

export function setSimulating(value: boolean): void {
  simulating = value;
  notify();
}

export function addSimulatedRecordId(recordId: string): void {
  if (!simulatedRecordIds.includes(recordId)) {
    simulatedRecordIds = [...simulatedRecordIds, recordId];
  }
  version += 1;
  notify();
}

export function useSimulatedRecordIds(): string[] {
  return useSyncExternalStore(subscribe, getIdsSnapshot, getServerIdsSnapshot);
}

// not read directly for its value - components depend on it purely to
// force a re-run (e.g. in a useEffect's dependency array) on every
// simulate, including repeats of the same record
export function useSimulateVersion(): number {
  return useSyncExternalStore(subscribe, getVersionSnapshot, getServerVersionSnapshot);
}

export function useIsSimulating(): boolean {
  return useSyncExternalStore(subscribe, getSimulatingSnapshot, getServerSimulatingSnapshot);
}
