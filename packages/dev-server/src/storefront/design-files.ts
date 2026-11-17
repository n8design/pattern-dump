// The design system's files as the storefront's checks read them: each template, schema and sample-data file read and
// parsed once per discovery, by its real path, and what is worked out from them alone (every layout's regions, the
// schemas that don't parse) once too. A page used to read the same ten files about 22 times.
//
// Kept per DiscoveryMap object, the way the renderer and the composition registry are kept per discovery: every .hbs
// and .json event in a pattern root, schemas and linked packages included, drops the discovery (watch.ts), even one
// the watcher can't place in a component, so the next request gets a new discovery and an empty store. pd build has
// one discovery throughout, and its input stamps stop a build whose files change. The server drops the discovery once
// more when its watcher is ready (index.ts): nothing read before the watcher could see an edit is kept.
//
// Only .hbs and .json files go through it: those are the files whose events drop the discovery. A component's .md
// is read as before.
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { readFile, realpath } from "node:fs/promises";
import { parseJson } from "@pattern-dump/renderer";

/** A schema as the storefront reads it: `schema` absent when there is no file, `error` when it can't be read. */
export interface SchemaReading<T> { schema?: T; error?: string }

export interface DesignFiles {
  /** The file's text; rejects as readFile does (and is read again on the next call). */
  text(path: string): Promise<string>;
  /** The file parsed with JSON.parse, frozen; rejects with readFile's or JSON.parse's error. */
  data(path: string): Promise<unknown>;
  /** The schema file, parsed and frozen (readSchema in declared-values.ts). */
  schema<T>(path: string | undefined): Promise<SchemaReading<T>>;
  /** What `make` works out from these files alone, once per key. */
  derived<T>(key: string, make: () => Promise<T>): Promise<T>;
}

/** Freezes `value` and everything in it: a reading is shared by every page, so none may change it. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

export function createDesignFiles(): DesignFiles {
  const real = new Map<string, Promise<string>>();
  const texts = new Map<string, Promise<string>>();
  const datas = new Map<string, Promise<unknown>>();
  const schemas = new Map<string, Promise<SchemaReading<unknown>>>();
  const derived = new Map<string, Promise<unknown>>();
  /** The path with its links resolved, so a package reached through node_modules and through its folder is one file. */
  const realOf = (path: string): Promise<string> => {
    let p = real.get(path);
    if (!p) { p = realpath(path).catch(() => path); real.set(path, p); }
    return p;
  };
  const once = <T>(map: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> => {
    let p = map.get(key);
    if (!p) { p = make(); map.set(key, p); }
    return p;
  };
  const text = async (path: string): Promise<string> => {
    const at = await realOf(path);
    const read = once(texts, at, () => readFile(at, "utf8"));
    // A read that failed is tried again next time, as the renderer's store does.
    read.catch(() => { if (texts.get(at) === read) texts.delete(at); });
    return read;
  };
  return {
    text,
    async data(path) {
      const at = await realOf(path);
      const parsed = once(datas, at, async () => deepFreeze(JSON.parse(await text(at)) as unknown));
      parsed.catch(() => { if (datas.get(at) === parsed) datas.delete(at); });
      return parsed;
    },
    async schema<T>(path: string | undefined): Promise<SchemaReading<T>> {
      if (!path) return {};
      const at = await realOf(path);
      return once(schemas, at, async () => {
        let source: string;
        try {
          source = await text(at);
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
        const parsed = parseJson(source);
        if (parsed.ok) return { schema: deepFreeze(parsed.value) };
        return { error: `not valid JSON (${parsed.reason})${parsed.line !== undefined ? ` at line ${parsed.line}, column ${parsed.column}` : ""}` };
      }) as Promise<SchemaReading<T>>;
    },
    derived<T>(key: string, make: () => Promise<T>): Promise<T> {
      return once(derived, key, make) as Promise<T>;
    },
  };
}

const stores = new WeakMap<DiscoveryMap, DesignFiles>();

/** The store of `discoveryMap`'s discovery, made on first use. */
export function designFiles(discoveryMap: DiscoveryMap): DesignFiles {
  let files = stores.get(discoveryMap);
  if (!files) { files = createDesignFiles(); stores.set(discoveryMap, files); }
  return files;
}
