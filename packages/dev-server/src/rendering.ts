// What pd dev renders with: the renderer, the global data it was built with, and its helpers, held as one
// object and replaced in one assignment. A request takes `current` once and uses that one object
// throughout, so it never pairs new data with an old renderer, or the reverse, even while a reload of
// helpers or data replaces it.

import type { Render } from "@pattern-dump/contracts";

export type HelperRegistrar = (hb: unknown) => void;
export type GlobalData = Record<string, unknown> | undefined;

export interface Rendering {
  readonly render: Render;
  readonly globalData: GlobalData;
  readonly registrars: readonly HelperRegistrar[];
}

/** Builds a renderer from helpers and global data, the same way every time (the dev-server's options). */
export type BuildRenderer = (registrars: readonly HelperRegistrar[], globalData: GlobalData) => Render;

export interface RenderingHandle {
  /** The rendering in use. Take it once per request or event and keep that object. */
  readonly current: Rendering;
  /** Replace helpers, data or both: a new renderer is built from the result, and all three swap at once. */
  replace(next: { registrars?: readonly HelperRegistrar[]; globalData?: GlobalData }): Rendering;
}

export function createRenderingHandle(build: BuildRenderer, registrars: readonly HelperRegistrar[], globalData: GlobalData): RenderingHandle {
  const make = (r: readonly HelperRegistrar[], d: GlobalData): Rendering =>
    Object.freeze({ render: build(r, d), globalData: d, registrars: r });
  let current = make(registrars, globalData);
  return {
    get current() { return current; },
    replace(next) {
      const registrarsNext = next.registrars ?? current.registrars;
      const dataNext = "globalData" in next ? next.globalData : current.globalData;
      current = make(registrarsNext, dataNext);
      return current;
    },
  };
}
