// The live-reload generation, client side (PD_GENERATION_HEADER in contracts).
//
// The server counts the reload messages it sends; every response carries the count it was taken at, and
// every message the count it moved to. Two things follow for a document the shell puts in a frame:
//   - a response older than the one a frame already shows for the same component is dropped: two quick
//     saves start two fetches, and the older one can resolve last;
//   - a response taken before a message the shell has already heard may predate the change that message
//     announced (sent while the fetch was in flight, its own reload applied to the document being
//     replaced), so it is fetched again. A refetch takes a generation at least as new as every message
//     heard so far, so it repeats only if yet another change arrives.
// In core/ because it reads no shared state beyond its own and belongs to no region.

import type { ComponentDetail } from "@pattern-dump/contracts";
import { PD_GENERATION_HEADER, componentUrl, generationBehind } from "@pattern-dump/contracts";
import { session } from "./session.js";

let newest: string | undefined;

/** A generation the server has told us of (hello, or a reload message). */
export function heard(generation: string | undefined): void {
  if (generation && (!newest || generationBehind(newest, generation))) newest = generation;
}

/** The generation a response was taken at, or null from a server without live reload. */
export function generationOf(res: Response): string | null {
  return res.headers.get(PD_GENERATION_HEADER);
}

/** True when a response taken at `generation` may predate a change the shell has heard of. */
export function behindHeard(generation: string | null): boolean {
  return generationBehind(generation, newest);
}

// What each frame slot shows: which document (component and variant) at which generation.
const shown = new Map<string, { readonly key: string; readonly generation: string | null }>();

/**
 * Whether a response for `slot`, showing `key`, taken at `generation`, may replace what the slot shows:
 * not when it is older than the response the slot already shows for the same key. Recorded when it may.
 */
export function claim(slot: string, key: string, generation: string | null): boolean {
  const current = shown.get(slot);
  if (current && current.key === key && generationBehind(generation, current.generation)) return false;
  shown.set(slot, { key, generation });
  return true;
}

/**
 * Fetch a document for `slot` and show it with `apply`, unless `wanted()` says the slot has moved on
 * (navigation) or an older response than the one shown arrives; then, while what was shown is behind a
 * change heard meanwhile, fetch it again.
 */
export async function loadDocument(
  slot: string, key: string, url: string, apply: (doc: string) => void, wanted: () => boolean,
): Promise<void> {
  for (;;) {
    const res = await fetch(url);
    const doc = await res.text();
    const generation = generationOf(res);
    if (!wanted() || !claim(slot, key, generation)) return;
    apply(doc);
    if (!behindHeard(generation)) return;
  }
}

/**
 * A fresh detail of `componentId` for session.current, or null when it must not be applied: the component
 * is no longer the current one by the time it arrives (navigation meanwhile), or the response is older
 * than the detail already applied (two refetches resolving out of order). Rejects on a non-ok response.
 */
export async function fetchDetail(componentId: string, variant?: string): Promise<ComponentDetail | null> {
  const res = await fetch(componentUrl(componentId, variant));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const detail = await res.json() as ComponentDetail;
  if (session.current?.id !== componentId || !claim("detail", componentId, generationOf(res))) return null;
  return detail;
}
