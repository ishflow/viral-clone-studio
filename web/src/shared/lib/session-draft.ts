/**
 * A form kept in the browser tab (`sessionStorage`): it survives a page change and a refresh, and goes with the tab.
 * Every call is safe where storage is not: a private window, a full store, the server. Then nothing is kept and nothing throws.
 */

export function readDraft<T>(key: string): T | null {
  try {
    const text = window.sessionStorage.getItem(key);
    return text === null ? null : (JSON.parse(text) as T);
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not kept: the form still works.
  }
}

/** Every draft kept for a person starts with this (the generate form and the add-video form build their keys from it). */
const DRAFT_PREFIX = 'vc:draft:';

/** Removes every kept form: the next person on this tab (after a log-out or a deleted account) must not find the last one's typing. */
export function dropAllDrafts(): void {
  try {
    const store = window.sessionStorage;
    for (let i = store.length - 1; i >= 0; i--) {
      const key = store.key(i);
      if (key?.startsWith(DRAFT_PREFIX)) store.removeItem(key);
    }
  } catch {
    // Nothing to drop.
  }
}

export function dropDraft(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Nothing to drop.
  }
}
