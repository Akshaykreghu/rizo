'use client';

import { useQuery } from '@tanstack/react-query';

/**
 * Shared accessors for Company Setup lookup lists (branches, departments, designations,
 * grades, salary structures, shifts, …).
 *
 * Why this exists: every `/api/setup/*` list used to be fetched ad hoc with
 * `useQuery({ queryKey: ['setup/x'], queryFn: ... })`, and the same key was filled with
 * three incompatible shapes across the app — raw API rows, `{code, name}` maps, and
 * `{value, label}` maps (via copy-pasted `useLookup` / `useSetupOptions` helpers). React
 * Query keys its cache by `queryKey` alone, so whichever screen mounted first won the cache
 * entry and every other consumer read a shape it couldn't render — dropdowns showed blank
 * `<option>`s depending on navigation order.
 *
 * The fix: one `queryFn` per setup path (returns the raw rows), one cache entry, and every
 * consumer shapes what it needs from that entry via `select` (which runs per-observer and
 * never writes the cache). `useSetupOptions`'s `select` also falls back to `value` / `label`
 * so a stale entry left by an old-style caller still renders correctly.
 *
 * The cache key stays `[path]` (e.g. `['setup/branches']`) so existing
 * `invalidateQueries({ queryKey: ['setup/branches'] })` calls in the Setup CRUD screens keep
 * refreshing these lists.
 */

export interface SetupOption {
  value: string;
  label: string;
}

type Row = Record<string, unknown>;

/** Accept either `'branches'` or `'setup/branches'`; both resolve to the same key + URL. */
function normalisePath(path: string): string {
  return path.startsWith('setup/') ? path : `setup/${path}`;
}

function fetchRows(path: string): Promise<Row[]> {
  return fetch(`/api/${path}`).then((r) => r.json());
}

/**
 * Raw setup rows, cached once per path. Use when you need fields the option mapper drops
 * (e.g. a branch's address) or you already render with the API's own field names.
 */
export function useSetupRows<T = Row>(path: string, options?: { enabled?: boolean }) {
  const p = normalisePath(path);
  return useQuery<T[]>({
    queryKey: [p],
    queryFn: () => fetchRows(p) as Promise<T[]>,
    enabled: options?.enabled,
  });
}

/**
 * Setup rows mapped to `{ value, label }` for `<select>` / `<datalist>`.
 *
 * @param valueKey  row field to use as the option value (e.g. `'branch_code'`)
 * @param label     row field name for the option label, or a function deriving it
 */
export function useSetupOptions(
  path: string,
  valueKey: string,
  label: string | ((row: Row) => string),
  options?: { enabled?: boolean },
) {
  const p = normalisePath(path);
  const labelFn = typeof label === 'function' ? label : (row: Row) => String(row[label] ?? '');
  return useQuery<Row[], Error, SetupOption[]>({
    queryKey: [p],
    queryFn: () => fetchRows(p),
    enabled: options?.enabled,
    select: (rows) =>
      (rows ?? []).map((row) => ({
        value: String(row[valueKey] ?? row.value ?? ''),
        label: labelFn(row) || String(row.label ?? ''),
      })),
  });
}
