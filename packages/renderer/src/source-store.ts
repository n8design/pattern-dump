// What a render reads from the design system, read once: templates, data files and schemas, by path. A renderer
// given its discovery maps keeps one store for its whole life, so a build reads each file once; the dev-server
// makes a new renderer, and so a new store, whenever a template, data or schema file changes (it drops the
// discovery). A renderer without the maps discovers again on every call and takes a new store each time.
//
// Data is frozen when it is read: renders share it, so nothing may change it (mergeData builds new objects
// instead), and code that tries throws a TypeError rather than changing every later render.
//
// Compiled templates are kept apart, by a hash of what they are compiled from (the source, or for a template with
// {{pd-image}} its source and its schema), the Handlebars version and PD's compile options: a template compiles
// once per process, and only one a render calls. The same source always gives the same compiled template.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import Handlebars from "handlebars";

/** A value frozen with every object and array it holds. Data files hold nothing else. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * `sources` merged, later over earlier, into a new object; no source is changed. Where two sources both give an
 * object (not an array) under a key, the result holds a new object merging the two; any other value is taken as
 * it is, so a frozen source's values stay shared and frozen. The same result as deepMerge(structuredClone(first),
 * ...rest), without the copy.
 */
export function mergeData(...sources: Array<Record<string, unknown> | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      const current = out[key];
      out[key] = isPlainObject(value) && isPlainObject(current) ? mergeData(current, value) : value;
    }
  }
  return out;
}

export interface SourceStore {
  /** A file's text, read once; rejects as readFile does (and is then read again on the next call). */
  text(path: string): Promise<string>;
  /** The same, read once and kept as it was read; `fallback` when the file cannot be read. */
  textOr<T>(path: string, fallback: T): Promise<string | T>;
  /** Something derived from the store's files, made once under `key`. */
  derived<T>(key: string, make: () => Promise<T>): Promise<T>;
}

export function createSourceStore(): SourceStore {
  const texts = new Map<string, Promise<string>>();
  const made = new Map<string, Promise<unknown>>();
  const text = (path: string): Promise<string> => {
    let t = texts.get(path);
    if (!t) {
      t = readFile(path, "utf-8");
      texts.set(path, t);
      t.catch(() => { if (texts.get(path) === t) texts.delete(path); });
    }
    return t;
  };
  return {
    text,
    textOr: (path, fallback) => text(path).catch(() => fallback),
    derived<T>(key: string, make: () => Promise<T>): Promise<T> {
      let m = made.get(key) as Promise<T> | undefined;
      if (!m) {
        m = make();
        made.set(key, m);
        m.catch(() => { if (made.get(key) === m) made.delete(key); });
      }
      return m;
    },
  };
}

/** Handlebars' compile, split: the template spec it builds, which any environment can bind (env.template). */
export type TemplateSpec = Parameters<typeof Handlebars.template>[0];
interface CompilerParts {
  Compiler: new () => { compile(program: hbs.AST.Program, options: object): unknown };
  JavaScriptCompiler: new () => { compile(environment: unknown, options: object, context: undefined, asObject: true): TemplateSpec };
}

const specs = new Map<string, TemplateSpec>();

/** The hash a compiled template is kept by: what it is compiled from, the Handlebars version and the options. */
export function templateKey(source: string, options: object, extra = ""): string {
  return createHash("sha256").update(`${Handlebars.VERSION}\0${JSON.stringify(options)}\0${extra}\0${source}`).digest("hex");
}

/** The compiled template under `key` (templateKey), compiled from what `input` gives the first time, exactly as
 *  Handlebars.compile compiles. */
export function templateSpec(key: string, input: () => string | hbs.AST.Program, options: object): TemplateSpec {
  let spec = specs.get(key);
  if (!spec) {
    // As Handlebars.compile does (compiler.js, compileInput): data on unless the options say otherwise.
    const opts = { data: true, ...options };
    const parts = Handlebars as unknown as CompilerParts;
    const environment = new parts.Compiler().compile(Handlebars.parse(input() as string), opts);
    spec = new parts.JavaScriptCompiler().compile(environment, opts, undefined, true);
    specs.set(key, spec);
  }
  return spec;
}
