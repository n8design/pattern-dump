// @pattern-dump/renderer
// render(): Handlebars + data cascade (defaults ← variant ← live) + global flat-name partial registry.
// Helpers: {{id 'name'}} (ambient, named, deterministic, base-seeded, composition-spanning) + core generics + legacy shim.
// M4.1: Shiki syntax highlighter (initHighlighter / highlight / getShikiCSS / wrapWithCopyButton).
// M6: collectComponents (old folder-per-component walk) replaced by DiscoveryMap from RendererOptions.
//     When RendererOptions.discoveryMap is absent the renderer calls buildDiscoveryMap(patternsDir)
//     from @pattern-dump/discovery — never the old walk. No path reconstruction anywhere.
export { initHighlighter, highlight, getShikiCSS, getCodeCSS, codeKindOf, CODE_KINDS, wrapWithCopyButton, type CodeKind } from "./highlight";
export { unescapedOutputs, type UnescapedOutput } from "./unescaped";
export { itemsWrittenAsText, type ItemAsText } from "./item-text";
export { checkSchemaExtensions, QUERY_OPTIONS, readExampleHeight, readLayoutMarker, readPreviewMode, readProseSlot, type ProseSlot, type SchemaExtensionContext, type SchemaExtensionProblem } from "./schema-extensions";
export { checkSchemaHelperNames, isHelperNameProblem, type SchemaHelperNameProblem } from "./schema-helper-names";
export { helperShadows, type HelperShadow } from "./helper-shadow";
export { inlineStyles, styleAttributes, type InlineStyle, type StyleAttribute } from "./inline-style";
export { parseJson, type ParsedJson } from "./json";
import { helperShadows } from "./helper-shadow";
import { inlineStyles } from "./inline-style";
import { parseJson } from "./json";
import { tagShapeProblems } from "./tag-shape";
import { checkSchemaExtensions } from "./schema-extensions";
import { SLOT_KEY, withImageSlots, type ImageSlot } from "./image-slots";
import { checkSchemaHelperNames } from "./schema-helper-names";
import { createSourceStore, deepFreeze, mergeData, PROTOTYPE_KEYS, templateKey, templateSpec, type SourceStore } from "./source-store";
import type {
  CreateRenderer, RendererOptions, Diagnostic, RenderMeta,
  ImageLookup, ImageSource,
} from "@pattern-dump/contracts";
import { HtmlValidate } from "html-validate";
import Handlebars from "handlebars";
import { basename, isAbsolute, relative, sep } from "node:path";
import { buildDiscoveryMap } from "@pattern-dump/discovery";

/** How every template compiles. `preventIndent`: a partial included on a line of its own is not indented by the
 *  include's indentation, which Handlebars otherwise adds to every line of its output, the content of a <pre>
 *  (a code block) included. */
const COMPILE = { preventIndent: true } as const;

// Fragment-scoped HTML content-model validator (M4.9 finalise).
// Only content-model rules — no document-structure checks (no doctype/html/head noise).
const htmlValidator = new HtmlValidate({
  rules: {
    "element-permitted-content": "error",
    "element-permitted-parent": "error",
  },
});

/** A template outside the patterns (a site's own head file): plain Handlebars, escaping as templates do, with no
 *  helpers but Handlebars' own and no partials, compiled as every template is (preventIndent). */
export function renderPlainTemplate(source: string, data: Record<string, unknown>): string {
  return Handlebars.create().compile(source, COMPILE)(data);
}

/** `sources` merged into `target`, later over earlier, descending where both hold an object. PROTOTYPE_KEYS are
 *  left out: merging a parsed `__proto__` would otherwise change Object.prototype. */
export function deepMerge(
  target: Record<string, unknown>,
  ...sources: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (PROTOTYPE_KEYS.has(key)) continue;
      const targetVal = target[key];
      if (
        value !== null && typeof value === "object" && !Array.isArray(value) &&
        targetVal !== null && typeof targetVal === "object" && !Array.isArray(targetVal)
      ) {
        deepMerge(targetVal as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        target[key] = value;
      }
    }
  }
  return target;
}

const safePart = (n: string) => n.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();

/**
 * Read a component or variant data file. A file that cannot be read is no data. A file that does
 * not parse is no data plus a DATA_INVALID diagnostic, so the dropped data shows up on the Console
 * instead of the component silently rendering without it.
 */
function dataFile(store: SourceStore, path: string, display: (absPath: string) => string): Promise<{ data?: Record<string, unknown>; diagnostic?: Diagnostic }> {
  // Parsed once for the store, and frozen: every render shares it.
  return store.derived(`data ${path}`, async () => {
    const text = await store.textOr(path, null);
    if (text === null) return {};
    const parsed = parseJson(text);
    if (parsed.ok) return { data: deepFreeze(parsed.value as Record<string, unknown>) };
    return {
      diagnostic: {
        kind: "DATA_INVALID", source: "render", severity: "error",
        message: `${basename(path)} is not valid JSON (${parsed.reason}); its data was not used`,
        location: { file: display(path), ...(parsed.line !== undefined ? { line: parsed.line, column: parsed.column } : {}) },
      },
    };
  });
}

/**
 * An image as an <img>: with its variants (the slot's widths the image has as displayed, and its own width when a slot
 * width is wider, so the srcset reaches the original and nothing is upscaled; `src` the largest), or a single file at
 * its size. `className` is written on the <img>, escaped like every attribute. Shared by `{{pd-image}}` and the
 * storefront's prose images, so both write the same markup. With `dark`, a <picture> whose
 * `(prefers-color-scheme: dark)` <source> is that image, in the same widths, at its own size; the <img> is the light one.
 */
export function imageTag(
  source: Exclude<ImageSource, { kind: "unavailable" }>,
  o: { widths: readonly number[]; sizes: string; alt: string; title?: string; eager: boolean; settings?: "site";
    dark?: Exclude<ImageSource, { kind: "unavailable" }>; className?: string },
): string {
  const esc = Handlebars.escapeExpression;
  const rest = `alt="${esc(o.alt)}"${o.title !== undefined ? ` title="${esc(o.title)}"` : ""}`
    + `${o.className ? ` class="${esc(o.className)}"` : ""} loading="${o.eager ? "eager" : "lazy"}" decoding="async"`;
  const light = candidates(source, o);
  const img = light.srcset === undefined
    ? `<img src="${esc(light.src)}" width="${light.width}" height="${light.height}" ${rest}>`
    : `<img src="${esc(light.src)}" srcset="${light.srcset}" sizes="${esc(o.sizes)}" width="${light.width}" height="${light.height}" ${rest}>`;
  if (!o.dark) return img;
  const dark = candidates(o.dark, o);
  const sizes = dark.srcset === undefined ? "" : ` sizes="${esc(o.sizes)}"`;
  return `<picture><source media="(prefers-color-scheme: dark)" srcset="${dark.srcset ?? esc(dark.src)}"${sizes} `
    + `width="${dark.width}" height="${dark.height}">${img}</picture>`;
}

/** An image's URLs and size as imageTag writes them: a srcset (escaped) for one with variants. */
function candidates(
  source: Exclude<ImageSource, { kind: "unavailable" }>, o: { widths: readonly number[]; settings?: "site" },
): { src: string; srcset?: string; width: number; height: number } {
  if (source.kind === "single") return { src: source.url, width: source.width, height: source.height };
  const esc = Handlebars.escapeExpression;
  // The slot's widths up to the image's own; then its own width, when a wider slot width would have shown more of it
  // (a 602 px image in a slot of 480 and 960 gets 480 and 602, never a smaller variant as its largest).
  const widths = o.widths.filter(w => w <= source.width);
  if (!widths.includes(source.width) && (widths.length === 0 || o.widths.some(w => w > source.width))) widths.push(source.width);
  const urls = widths.map(w => source.variantUrl(w, o.settings));
  const top = widths[widths.length - 1]!;
  return { src: urls[urls.length - 1]!, srcset: urls.map((u, i) => `${esc(u)} ${widths[i]}w`).join(", "),
    width: top, height: Math.round(top * source.height / source.width) };
}

/** `{{pd-image field alt=… [class="…"] [loading="eager"]}}`: an image in its slot (image-slots.ts) as an <img> with its
 *  variants, the class on the <img>. */
function registerImageHelper(env: ReturnType<typeof Handlebars.create>, images: ImageLookup | undefined): void {
  env.registerHelper("pd-image", function (value: unknown, options: { hash?: Record<string, unknown>; data?: { pdImages?: "site" } }) {
    const raw = options.hash?.[SLOT_KEY];
    if (typeof raw !== "string") {
      throw new Error(`{{pd-image}} has no image slot: the component's schema problem (SCHEMA_INVALID) says why`);
    }
    const slot = JSON.parse(raw) as ImageSlot;
    const alt = options.hash?.["alt"];
    if (alt === undefined || alt === null) {
      throw new Error(`{{pd-image}}: the image's alt text is missing: give it a text alternative, or alt="" for a decorative image`);
    }
    if (typeof value !== "string" || value === "") throw new Error(`{{pd-image}}: the image field is empty`);
    if (!images) throw new Error(`{{pd-image}}: this renderer was given no image index`);
    const source = images(value);
    if (!source) throw new Error(`{{pd-image}}: "${value}" is not an image in the assets`);
    if (source.kind === "unavailable") throw new Error(source.reason);
    const settings = options.data?.pdImages;
    const className = options.hash?.["class"];
    return new env.SafeString(imageTag(source, {
      widths: slot.widths, sizes: slot.sizes, alt: String(alt), eager: options.hash?.["loading"] === "eager",
      ...(settings ? { settings } : {}),
      ...(className !== undefined && className !== null && String(className) !== "" ? { className: String(className) } : {}),
    }));
  });
}

/** Register core + legacy + project helpers on a Handlebars env.
 *  mintId and getLastId are closures owned by the render call so they see the live currentBase. */
function registerHelpers(
  env: ReturnType<typeof Handlebars.create>,
  mintId: (name: string) => string,
  getLastId: () => string,
  projectHelpers?: Record<string, (...args: unknown[]) => unknown>,
  helperRegistrars?: Array<(handlebars: unknown) => void>
): void {
  env.registerHelper("id", (name: string) => mintId(name));

  // Legacy shim (@deprecated — hTWOo migration, same API, now deterministic + scoped)
  env.registerHelper("getId", (name: string) => mintId(name));
  env.registerHelper("getLastId", () => getLastId());
  env.registerHelper("getLastNumericId", () => {
    const id = getLastId();
    const m = id.match(/(\d+)$/);
    return m ? m[1] : "0";
  });

  // Core generic helpers. Handlebars hands a helper its options object last, so a call an argument short would read
  // that object as the argument (`[object Object]`, a silent false): each counts what it was given. `and` and `or`
  // take exactly two (a third was ignored); the others ignore extras, as before.
  const counted = (name: string, n: number, exact: boolean, f: (...args: unknown[]) => unknown) =>
    (...args: unknown[]): unknown => {
      const given = args.length - 1;
      const word = `argument${n === 1 ? "" : "s"}`;
      if (given < n) throw new Error(`${name} needs ${n} ${word}, got ${given}`);
      if (exact && given > n) throw new Error(`${name} takes exactly ${n} ${word}, got ${given}`);
      return f(...args.slice(0, n));
    };
  const helper = (name: string, n: number, f: (...args: unknown[]) => unknown, exact = false): void => {
    env.registerHelper(name, counted(name, n, exact, f));
  };
  helper("eq",  2, (a, b) => a === b);
  helper("ne",  2, (a, b) => a !== b);
  helper("lt",  2, (a, b) => (a as number) < (b as number));
  helper("gt",  2, (a, b) => (a as number) > (b as number));
  helper("lte", 2, (a, b) => (a as number) <= (b as number));
  helper("gte", 2, (a, b) => (a as number) >= (b as number));
  helper("and", 2, (a, b) => Boolean(a) && Boolean(b), true);
  helper("or",  2, (a, b) => Boolean(a) || Boolean(b), true);
  helper("not", 1, a => !a);
  helper("isdefined", 1, v => v !== undefined && v !== null);
  helper("defaultValue", 2, (v, fallback) => v !== undefined && v !== null ? v : fallback);
  env.registerHelper("ifCond", function(
    this: unknown,
    a: unknown, op: string, b: unknown,
    options: { fn(ctx: unknown): string; inverse(ctx: unknown): string }
  ) {
    let result = false;
    switch (op) {
      case "==": case "===": result = a === b; break;
      case "!=": case "!==": result = a !== b; break;
      case "<":  result = (a as number) < (b as number); break;
      case ">":  result = (a as number) > (b as number); break;
      case "<=": result = (a as number) <= (b as number); break;
      case ">=": result = (a as number) >= (b as number); break;
      case "&&": result = Boolean(a) && Boolean(b); break;
      case "||": result = Boolean(a) || Boolean(b); break;
    }
    return result ? options.fn(this) : options.inverse(this);
  });

  if (projectHelpers) {
    for (const [name, fn] of Object.entries(projectHelpers)) {
      env.registerHelper(name, fn as (...args: unknown[]) => unknown);
    }
  }

  // Registrar-style project helpers (PatternLab shape). Invoked with the env itself so helpers that
  // read env.partials / env.compile at call time (dynamicPartial) resolve against the real registry.
  // A failing registrar must not blank the whole render — isolate and continue.
  if (helperRegistrars) {
    for (const register of helperRegistrars) {
      try { register(env); }
      catch (e) { console.warn("[renderer] project helper registrar failed:", e); }
    }
  }
}

/**
 * A template called a helper that is not registered. It names the helper, and the template that called
 * it: the innermost template the error passes through stamps itself on it, so a helper missing in a
 * partial is reported against the partial, not the page that included it. `location` is a diagnostic's.
 */
/** V8's messages for a write to a frozen object. */
const READ_ONLY = /^Cannot (?:assign to read only property|add property|delete property|define property|redefine property) /;
/** Says, on a write to the data a render shares (frozen: source-store.ts), which render it was, why the data is read-only
 *  and the code that wrote to it, since the bare message names none of them. The error stays the same TypeError. */
function explainReadOnly(e: unknown, component: string): void {
  if (!(e instanceof TypeError) || !READ_ONLY.test(e.message) || e.message.includes(", so it is read-only:")) return;
  // The first frame of the stack is the code that made the change (a project helper, say).
  const at = /\n\s+at (.+)/.exec(e.stack ?? "")?.[1];
  e.message = `${e.message}, while rendering ${component}. A render's data (the component's data files, the global data, `
    + `a site page's data) is shared by every render, so it is read-only: copy a value before changing it${at ? ` (changed at ${at})` : ""}`;
}

export class MissingHelperError extends Error {
  template?: string;
  file?: string;
  constructor(readonly helper: string, readonly line?: number, readonly column?: number) {
    super(`Missing helper "${helper}"`);
    this.name = "MissingHelperError";
  }
  /** Stamp the template running when the error passed through, if none has yet: the one that called it. */
  stamp(template: string, file: string | undefined): void {
    if (this.template !== undefined) return;
    this.template = template;
    this.file = file;
    const at = this.line !== undefined ? ` (line ${this.line}${this.column !== undefined ? `, column ${this.column + 1}` : ""})` : "";
    this.message = `Missing helper "${this.helper}", called by ${template}${at}`;
  }
  get location(): { file?: string; line?: number; column?: number } {
    return { ...(this.file ? { file: this.file } : {}), ...(this.line !== undefined ? { line: this.line } : {}), ...(this.column !== undefined ? { column: this.column + 1 } : {}) };
  }
}

/**
 * How a diagnostic names a file: the caller's `displayPath`, else the path relative to the pattern root
 * that holds it, else its base name. Never an absolute path: one the caller returns falls back too.
 */
function makeDisplayPath(roots: readonly string[], displayPath?: (absPath: string) => string): (absPath: string) => string {
  const underRoot = (absPath: string): string => {
    for (const root of roots) {
      const rel = relative(root, absPath);
      if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).join("/");
    }
    return basename(absPath);
  };
  return absPath => {
    const named = displayPath?.(absPath);
    return named && !isAbsolute(named) ? named : underRoot(absPath);
  };
}

/**
 * Run one helper registrar on a fresh Handlebars environment, as a render would, and say why it failed:
 * its message, or null when it registers cleanly. A reload checks each module this way before using it.
 */
export function dryRunHelperRegistrar(register: (handlebars: unknown) => void): string | null {
  try {
    register(Handlebars.create());
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export const createRenderer: CreateRenderer = (options: RendererOptions) => {
  const display = makeDisplayPath((options.patternRoots ?? []).map(r => r.dir).concat(options.patternsDir), options.displayPath);
  // Given its maps, the renderer reads each file once for its life (source-store.ts): the caller makes a new
  // renderer when the design system's files change. Without them it discovers again, and reads again, per call.
  const ownStore = options.discoveryMap && options.handleMap ? createSourceStore() : undefined;
  // The global data, copied once and frozen: every render merges it beneath its own data, and none may change it.
  const globalData = deepFreeze(structuredClone(options.globalData ?? {}));
  return async (input) => {
    const { patternsDir } = options;
    const store = ownStore ?? createSourceStore();

    // Resolve discovery maps per-call: use provided maps or fall back to the M6 internal walk.
    // Called per-call (not cached) so new/removed files are always picked up — same as collectComponents was.
    // The fallback is the real M6 file-as-component walk — never the old collectComponents walk.
    let discoveryMap = options.discoveryMap;
    let handleMap    = options.handleMap;
    if (!discoveryMap || !handleMap) {
      const maps = await buildDiscoveryMap(options.patternRoots ?? patternsDir);
      discoveryMap ??= maps.discoveryMap;
      handleMap    ??= maps.handleMap;
    }

    // A variant addressed by its own id (`atoms/chip~danger`, as in /preview/atoms/chip~danger) is
    // the base component rendered with that variant — the same as `?variant=danger`, so the base's
    // data, template and schema apply beneath the variant's.
    let componentId = input.component;
    let variant = input.variant;
    const tilde = componentId.indexOf("~");
    if (tilde > 0 && !variant && discoveryMap.has(componentId.slice(0, tilde))) {
      variant = componentId.slice(tilde + 1);
      componentId = componentId.slice(0, tilde);
    }

    // Resolve the requested component's entry.
    const entry = discoveryMap.get(componentId);
    if (!entry) throw new Error(`[renderer] Component not found: "${componentId}"`);

    // For own-markup variants (separate .hbs), use that template; otherwise use the base .hbs.
    // Data-overlay variants (json only, no .hbs) always use the base template.
    let templateHbsPath = entry.hbsPath;
    let variantJsonPath: string | undefined;
    if (variant) {
      const variantEntry = discoveryMap.get(`${componentId}~${variant}`);
      if (!variantEntry) throw new Error(`[renderer] Variant not found: "${componentId}~${variant}"`);
      if (variantEntry.ownMarkup && variantEntry.hbsPath) {
        templateHbsPath = variantEntry.hbsPath;
      }
      variantJsonPath = variantEntry.jsonPath; // undefined for own-markup variants with no data file
    }

    // A base-less synthesized node (M6) has hbsPath="" — no markup of its own. It must render a
    // clean empty state, never throw `ENOENT: open ''` (the all-variants gallery is the deferred
    // M6 "render-on-select"; this guard is independent of when that lands).
    const templateSrc = templateHbsPath ? await store.text(templateHbsPath) : "";

    // Data files that do not parse, reported once each (DATA_INVALID) — the component's own, the
    // variant's, and those of partials this render actually includes.
    const dataDiagnostics = new Map<string, Diagnostic>();
    const readData = async (path: string): Promise<Record<string, unknown> | undefined> => {
      const { data, diagnostic } = await dataFile(store, path, display);
      if (diagnostic) dataDiagnostics.set(path, diagnostic);
      return data;
    };

    // A site page renders without sample data (RenderInput.sampleData): only what it is given reaches it. The files
    // are still read, so one that doesn't parse is reported as before.
    const samples = input.sampleData !== false;
    const ownData = entry.jsonPath ? await readData(entry.jsonPath) : undefined;
    const ownVariantData = variantJsonPath ? await readData(variantJsonPath) : undefined;
    const defaultData: Record<string, unknown> = (samples ? ownData : undefined) ?? {};
    const variantData = samples ? ownVariantData : undefined;

    // Cascade (lowest → highest): project global data → component defaults → variant → live.
    // A new object: every source is shared and frozen (source-store.ts), so none is changed.
    const data = mergeData(
      globalData,
      defaultData,
      variantData,
      input.data as Record<string, unknown> | undefined
    );

    const env = Handlebars.create();

    // ---- Base-seeded id scope (shared across main template + all partials in this render) ----
    //
    // currentBase is the active base for {{id 'name'}}. It is set before the main template runs
    // and swapped around partial invocations so each instance has the right base.
    //
    // Minting rule: the first invocation of a partial with a given parent base INHERITS that
    // parent base (composition propagation). A repeated invocation mints a new base
    // (pd-<partial-slug>-<N>) so independent instances of the same component don't collide.
    //
    // Supplied base: a parent may pass base="<value>" as a partial hash arg to seed the child's
    // entire id cluster, making every {{id 'name'}} in the subtree externally predictable.
    const componentSlug = safePart(componentId.replace(/[\\/]/g, "-"));
    let currentBase = `pd-${componentSlug}`;

    // idCache: base:name → id string. One cache per render; memoises deterministic derivations.
    const idCache = new Map<string, string>();
    let lastMintedId = "";

    const mintId = (name: string): string => {
      const key = `${currentBase}:${String(name)}`;
      if (!idCache.has(key)) {
        idCache.set(key, `${currentBase}-${safePart(String(name))}`);
      }
      const id = idCache.get(key)!;
      lastMintedId = id;
      return id;
    };

    // invocationCounters: "flatName:parentBase" → count of invocations so far
    const invocationCounters = new Map<string, number>();

    // A helper the templates call but nobody registered: stock Handlebars throws a bare `Missing helper`.
    // This one says which template called it (MissingHelperError). A `{{name}}` with no arguments is not
    // a helper call and renders nothing, as stock. Registered first, so a project may still replace it.
    env.registerHelper("helperMissing", function (...args: unknown[]) {
      if (args.length === 1) return undefined;
      const opts = args[args.length - 1] as { name: string; loc?: { start?: { line: number; column: number } } };
      throw new MissingHelperError(opts.name, opts.loc?.start?.line, opts.loc?.start?.column);
    });
    registerHelpers(env, mintId, () => lastMintedId, options.helpers, options.helperRegistrars);
    registerImageHelper(env, options.images);

    // A template with {{pd-image}} is compiled from its AST with each call's image slot resolved against its
    // component's schema (image-slots.ts); any other template from its source, as before.
    // Each template is compiled once for its hash, and only when a render calls it (source-store.ts).
    const schemaJson = (id: string): Promise<unknown> => {
      const base = id.includes("~") ? id.slice(0, id.indexOf("~")) : id;
      const path = discoveryMap.get(id)?.schemaPath ?? discoveryMap.get(base)?.schemaPath;
      if (!path) return Promise.resolve(null);
      return store.derived(`schema ${path}`, async () => {
        try { return deepFreeze(JSON.parse(await store.text(path)) as unknown); } catch { return null; }
      });
    };
    /** What compiles `src` (the template of `id`): its hash, and how to get the input when it isn't compiled yet. */
    const compileInput = async (src: string, id: string): Promise<{ key: string; input: () => string | hbs.AST.Program }> => {
      if (!src.includes("pd-image")) return { key: templateKey(src, COMPILE), input: () => src };
      const schema = await schemaJson(id);
      return { key: templateKey(src, COMPILE, `pd-image ${JSON.stringify(schema)}`), input: () => withImageSlots(src, schema) };
    };

    // Every discovered component as a partial: its files are read once for the store, in parallel, and each
    // render registers a stand-in per component, which binds its compiled template on its first call only. So a
    // lookup by name (a helper reading env.partials, like hTWOo's dynamicPartial) finds every component, and a
    // component no render calls is never compiled.
    // Iterates handleMap (handle → id) and looks up file paths in discoveryMap — no reconstruction.
    const partialTable = await store.derived("partials", async () => (await Promise.all([...handleMap].map(async ([flatName, compId]) => {
      const compEntry = discoveryMap.get(compId);
      if (!compEntry?.hbsPath) return undefined; // skip synthesized base-less nodes (no template to register)
      try {
        const partialSrc = await store.text(compEntry.hbsPath);
        // Every discovered component is registered, but only one this render includes reports its
        // invalid data: the diagnostic is added when the partial runs, below.
        const childData = compEntry.jsonPath ? await dataFile(store, compEntry.jsonPath, display) : {};
        // A variant included by its handle (`{{> "atoms-chip~danger"}}`) gets its base's data beneath
        // its own, exactly as the variant renders on its own page.
        const variantTilde = compId.indexOf("~");
        const baseJsonPath = variantTilde > 0 ? discoveryMap.get(compId.slice(0, variantTilde))?.jsonPath : undefined;
        const baseData = baseJsonPath ? await dataFile(store, baseJsonPath, display) : {};
        return {
          flatName, compId, hbsPath: compEntry.hbsPath, childData, childDataPath: compEntry.jsonPath, baseData, baseJsonPath,
          defaults: deepFreeze(mergeData(baseData.data, childData.data)),
          compile: await compileInput(partialSrc, compId),
        };
      } catch {
        return undefined; // directory without a matching .hbs — skip
      }
    }))).filter(p => p !== undefined));

    for (const { flatName, compId, hbsPath, childData, childDataPath, baseData, baseJsonPath, defaults, compile } of partialTable) {
      { // One stand-in per component: its compiled template is bound on its first call in this render.
        let childTemplate: Handlebars.TemplateDelegate | undefined;
        const capturedDefaults = defaults;
        const partialSlug = safePart(compId.replace(/[\\/]/g, "-"));

        env.registerPartial(
          flatName,
          function(
            context: Record<string, unknown>,
            opts: { hash?: Record<string, unknown>; fn?: (...args: unknown[]) => unknown; data?: Record<string, unknown> }
          ) {
            // Determine this instance's base.
            const suppliedBase = opts?.hash?.base != null
              ? safePart(String(opts.hash.base))
              : null;

            let thisBase: string;
            if (suppliedBase !== null) {
              // Parent supplied the base — use it directly.
              thisBase = suppliedBase;
            } else {
              // Mint or propagate.
              // First invocation with this parent base: inherit (base propagation / sub-component).
              // Subsequent invocations: mint a new base (independent instances, no collision).
              const counterKey = `${flatName}:${currentBase}`;
              const n = invocationCounters.get(counterKey) ?? 0;
              invocationCounters.set(counterKey, n + 1);
              thisBase = n === 0 ? currentBase : `pd-${partialSlug}-${n}`;
            }

            if (childData.diagnostic && childDataPath) dataDiagnostics.set(childDataPath, childData.diagnostic);
            if (baseData.diagnostic && baseJsonPath) dataDiagnostics.set(baseJsonPath, baseData.diagnostic);

            // Swap base, execute, restore — synchronous so no interleaving.
            const savedBase = currentBase;
            currentBase = thisBase;

            const merged = mergeData(
              samples ? capturedDefaults : {},
              context != null && typeof context === "object" && !Array.isArray(context)
                ? (context as Record<string, unknown>)
                : {}
            );
            // Block partial (`{{#> name}}block{{/name}}`): Handlebars hands the block body as
            // opts.fn. Wire it as the `@partial-block` partial so the template's `{{> @partial-block}}`
            // yields the block back (stock Handlebars; PD's function-partial path must thread it
            // through since it compiles + runs the template itself). Non-block partials pass undefined.
            // opts.fn is the block body (registered-partial signature `(...args) => unknown`), but at
            // runtime it is a Handlebars template delegate returning the rendered block string. Cast it
            // to the partial value type Handlebars' RuntimeOptions expects (Template = TemplateDelegate |
            // string) so the whole project typechecks — the runtime contract is unchanged.
            //
            // The caller's data frame (opts.data) is passed on as in stock Handlebars, so `@root` stays
            // the page's data and `@index` etc. stay visible inside the partial. For a block call the
            // body is also the `@partial-block` data variable, which `{{#if @partial-block}}` reads.
            const data = { ...opts?.data, ...(opts?.fn ? { "partial-block": opts.fn } : {}) };
            const runtime: Handlebars.RuntimeOptions = opts?.fn
              ? { data, partials: { ...env.partials, "@partial-block": opts.fn as unknown as Handlebars.TemplateDelegate } }
              : { data };
            let result: string;
            try {
              childTemplate ??= env.template(templateSpec(compile.key, compile.input, COMPILE));
              result = childTemplate(merged, runtime);
            } catch (e) {
              if (e instanceof MissingHelperError) e.stamp(compId, display(hbsPath));
              throw e;
            } finally {
              currentBase = savedBase;
            }
            return result;
          } as unknown as string
        );
      }
    }

    // A no-op `@partial-block` for the top-level render: a block partial viewed standalone (e.g.
    // dialog-content, whose template has `{{> @partial-block}}`) has no enclosing block, so it must
    // render an empty block rather than throw. Block invocations override this with the real body.
    let html: string;
    try {
      const main = await compileInput(templateSrc, componentId);
      html = env.template(templateSpec(main.key, main.input, COMPILE))(data, {
        partials: { ...env.partials, "@partial-block": () => "" },
        // The render's image settings, for {{pd-image}} here and in every partial (data frames pass on).
        data: { pdImages: input.images },
      });
    } catch (e) {
      if (e instanceof MissingHelperError) e.stamp(input.component, templateHbsPath ? display(templateHbsPath) : undefined);
      explainReadOnly(e, input.component);
      throw e;
    }

    // ---- Diagnostics (M4.9 / M4.9-finalise) ----
    const diagnostics: Diagnostic[] = [...dataDiagnostics.values()];

    // HTML content-model validation (fragment-scoped — no doctype/shell noise).
    // Validated once per distinct markup for the store (a component's markup is rendered for its detail, its preview
    // and its source view alike); each render gets diagnostics of its own.
    // `validateHtml: false` (pd build --skip-checks=html) leaves it out.
    const htmlMessages = options.validateHtml === false ? [] : store.once(`html ${html}`, () => htmlValidator.validateStringSync(html).results
      .flatMap(result => result.messages.map(msg => ({ message: msg.message, ruleId: msg.ruleId, line: msg.line, column: msg.column }))));
    for (const msg of htmlMessages) {
      diagnostics.push({
        kind: "HTML_INVALID",
        severity: "warning",
        source: "html",
        message: msg.message,
        // The specific html-validate rule (e.g. "element-permitted-content") — the granular rule id
        // the diagnostics graph keys its rule nodes on, distinct from the coarse "HTML_INVALID" kind.
        ...(msg.ruleId ? { ruleId: msg.ruleId } : {}),
        ...(msg.line != null ? { location: { line: msg.line, column: msg.column } } : {}),
      });
    }

    // Schema validation (M4.9). schemaPath comes from the discovery entry — no reconstruction.
    // A schema that doesn't parse is an error, never "no schema": that would turn every check below off unsaid.
    const schemaText = entry.schemaPath ? await store.textOr(entry.schemaPath, undefined) : undefined;
    // Parsed once for the store, and frozen: every render of the component shares it.
    const parsedSchema = schemaText === undefined ? undefined
      : store.once(`schema json ${entry.schemaPath}`, () => { const p = parseJson(schemaText); return p.ok ? { ...p, value: deepFreeze(p.value) } : p; });
    if (parsedSchema && !parsedSchema.ok) {
      diagnostics.push({
        kind: "SCHEMA_INVALID",
        severity: "error",
        source: "schema",
        message: `${basename(entry.schemaPath!)} is not valid JSON (${parsedSchema.reason}), so ${componentId} isn't checked against its schema until it's fixed`,
        location: { file: display(entry.schemaPath!), ...(parsedSchema.line !== undefined ? { line: parsedSchema.line, column: parsedSchema.column } : {}) },
      });
    }
    try {
      if (!parsedSchema?.ok) throw new Error("no schema");
      const schema = parsedSchema.value as {
        required?: string[];
        properties?: Record<string, { type?: string | string[] }>;
      };

      // The placement extensions, and the template of a schema that uses them (schema-extensions.ts).
      for (const p of checkSchemaExtensions(schema, templateSrc, {
        componentExists: id => discoveryMap.has(id),
        hasSchema: id => discoveryMap.get(id)?.schemaPath !== undefined,
      })) {
        diagnostics.push({
          kind: "SCHEMA_INVALID",
          severity: "error",
          source: "schema",
          message: p.message,
          path: p.path,
          location: { file: display(entry.schemaPath!) },
        });
      }

      // A field named like a helper this render has registered (schema-helper-names.ts).
      for (const p of checkSchemaHelperNames(schema, Object.keys(env.helpers))) {
        diagnostics.push({
          kind: "SCHEMA_INVALID",
          severity: "error",
          source: "schema",
          message: p.message,
          path: p.path,
          location: { file: display(entry.schemaPath!) },
        });
      }

      for (const key of schema.required ?? []) {
        if (data[key] === undefined || data[key] === null) {
          diagnostics.push({
            kind: "UNFILLED_REQUIRED",
            severity: "error",
            source: "schema",
            message: `Required field "${key}" is absent in the merged data`,
            path: `#/properties/${key}`,
          });
        }
      }

      for (const [key, def] of Object.entries(schema.properties ?? {})) {
        const val = data[key];
        if (val === undefined || val === null || !def.type) continue;
        const types = Array.isArray(def.type) ? def.type : [def.type];
        // A list is JSON's array, not an object: typeof [] is "object", so it is told apart first.
        const jsType = Array.isArray(val) ? "array" : typeof val;
        const jsonType = jsType === "number" ? (Number.isInteger(val) ? "integer" : "number") : jsType;
        if (!types.includes(jsonType) && !types.includes(jsType)) {
          diagnostics.push({
            kind: "SHAPE_MISMATCH",
            severity: "warning",
            source: "schema",
            message: `Field "${key}" expected ${types.join(" | ")} but got ${jsType}`,
            path: `#/properties/${key}`,
          });
        }
      }
    } catch { /* no schema, or one that doesn't parse (reported above) */ }

    // Tags read as objects while the sample data or the schema gives strings, or the reverse (tag-shape.ts).
    if (templateHbsPath) {
      diagnostics.push(...tagShapeProblems({
        template: templateSrc, templateFile: display(templateHbsPath), data,
        ...(entry.jsonPath ? { dataPath: entry.jsonPath } : {}),
        ...(parsedSchema?.ok && entry.schemaPath
          ? { schema: parsedSchema.value as object, schemaPath: entry.schemaPath, schemaFile: display(entry.schemaPath) } : {}),
      }));
    }

    // A data field a bare {{name}} never reads, since a helper of that name answers (helper-shadow.ts). A field the
    // schema declares is the schema check's error already (SCHEMA_INVALID), and not said twice.
    const schemaNamed = new Set(diagnostics.filter(d => d.kind === "SCHEMA_INVALID" && d.path)
      .map(d => /\/properties\/([^/]+)$/.exec(d.path!)?.[1]).filter((n): n is string => !!n));
    for (const s of helperShadows(templateSrc, data, Object.keys(env.helpers), schemaNamed)) {
      diagnostics.push({
        kind: "HELPER_SHADOW",
        severity: "warning",
        source: "render",
        message: `{{${s.name}}} calls the helper "${s.name}", so the data's "${s.at}" is never read here: write {{this.${s.name}}} `
          + `to read the field, or give the field another name`,
        location: { file: display(entry.hbsPath), line: s.line, column: s.column },
      });
    }

    // A style attribute that sets more than custom properties (inline-style.ts): the template's own text.
    if (templateHbsPath) {
      for (const s of inlineStyles(templateSrc)) {
        diagnostics.push({
          kind: "INLINE_STYLE",
          severity: "warning",
          source: "render",
          message: `the style attribute sets ${s.declarations.join("; ")}, which ${s.declarations.length === 1 ? "isn't a custom property" : "aren't custom properties"}: `
            + `in a template, an inline style is the component's API and sets custom properties only (style="--name: value", read `
            + `by its stylesheet); move the rest into the stylesheet`,
          location: { file: display(templateHbsPath), line: s.line, column: s.column },
        });
      }
    }

    const meta: RenderMeta | undefined = diagnostics.length > 0
      ? { componentId, variant, diagnostics }
      : undefined;

    return { html, document: buildDocument(html, options), ...(meta ? { meta } : {}) };
  };
};

function buildDocument(html: string, options: RendererOptions): string {
  const bodyAttr = options.defaultTheme ? ` data-theme="${options.defaultTheme}"` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body${bodyAttr}>
${html}
</body>
</html>`;
}
