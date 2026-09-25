// @pattern-dump/renderer
// render(): Handlebars + data cascade (defaults ← variant ← live) + global flat-name partial registry.
// Helpers: {{id 'name'}} (ambient, named, deterministic, base-seeded, composition-spanning) + core generics + legacy shim.
// M4.1: Shiki syntax highlighter (initHighlighter / highlight / getShikiCSS / wrapWithCopyButton).
// M6: collectComponents (old folder-per-component walk) replaced by DiscoveryMap from RendererOptions.
//     When RendererOptions.discoveryMap is absent the renderer calls buildDiscoveryMap(patternsDir)
//     from @pattern-dump/discovery — never the old walk. No path reconstruction anywhere.
export { initHighlighter, highlight, getShikiCSS, wrapWithCopyButton } from "./highlight";
import type {
  CreateRenderer, RendererOptions, Diagnostic, RenderMeta,
} from "@pattern-dump/contracts";
import { HtmlValidate } from "html-validate";
import Handlebars from "handlebars";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { buildDiscoveryMap } from "@pattern-dump/discovery";

// Fragment-scoped HTML content-model validator (M4.9 finalise).
// Only content-model rules — no document-structure checks (no doctype/html/head noise).
const htmlValidator = new HtmlValidate({
  rules: {
    "element-permitted-content": "error",
    "element-permitted-parent": "error",
  },
});

export function deepMerge(
  target: Record<string, unknown>,
  ...sources: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
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

/** Line and column of a JSON parse error, from the parser's message (best-effort). */
function jsonErrorPosition(reason: string, text: string): { line?: number; column?: number } {
  const lineColumn = /line (\d+) column (\d+)/.exec(reason);
  if (lineColumn) return { line: Number(lineColumn[1]), column: Number(lineColumn[2]) };
  const position = /position (\d+)/.exec(reason);
  if (!position) return {};
  const lines = text.slice(0, Number(position[1])).split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/**
 * Read a component or variant data file. A file that cannot be read is no data. A file that does
 * not parse is no data plus a DATA_INVALID diagnostic, so the dropped data shows up on the Console
 * instead of the component silently rendering without it.
 */
async function readDataFile(path: string): Promise<{ data?: Record<string, unknown>; diagnostic?: Diagnostic }> {
  let text: string;
  try { text = await readFile(path, "utf-8"); } catch { return {}; }
  try {
    return { data: JSON.parse(text) as Record<string, unknown> };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return {
      diagnostic: {
        kind: "DATA_INVALID", source: "render", severity: "error",
        message: `${basename(path)} is not valid JSON (${reason}); its data was not used`,
        location: { file: path, ...jsonErrorPosition(reason, text) },
      },
    };
  }
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

  // Core generic helpers
  env.registerHelper("eq",  (a: unknown, b: unknown) => a === b);
  env.registerHelper("ne",  (a: unknown, b: unknown) => a !== b);
  env.registerHelper("lt",  (a: unknown, b: unknown) => (a as number) < (b as number));
  env.registerHelper("gt",  (a: unknown, b: unknown) => (a as number) > (b as number));
  env.registerHelper("lte", (a: unknown, b: unknown) => (a as number) <= (b as number));
  env.registerHelper("gte", (a: unknown, b: unknown) => (a as number) >= (b as number));
  env.registerHelper("and", (a: unknown, b: unknown) => Boolean(a) && Boolean(b));
  env.registerHelper("or",  (a: unknown, b: unknown) => Boolean(a) || Boolean(b));
  env.registerHelper("not", (a: unknown) => !a);
  env.registerHelper("isdefined", (v: unknown) => v !== undefined && v !== null);
  env.registerHelper("defaultValue", (v: unknown, fallback: unknown) =>
    v !== undefined && v !== null ? v : fallback
  );
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

export const createRenderer: CreateRenderer = (options: RendererOptions) => {
  return async (input) => {
    const { patternsDir } = options;

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
    const templateSrc = templateHbsPath ? await readFile(templateHbsPath, "utf-8") : "";

    // Data files that do not parse, reported once each (DATA_INVALID) — the component's own, the
    // variant's, and those of partials this render actually includes.
    const dataDiagnostics = new Map<string, Diagnostic>();
    const readData = async (path: string): Promise<Record<string, unknown> | undefined> => {
      const { data, diagnostic } = await readDataFile(path);
      if (diagnostic) dataDiagnostics.set(path, diagnostic);
      return data;
    };

    const defaultData: Record<string, unknown> = (entry.jsonPath ? await readData(entry.jsonPath) : undefined) ?? {};
    const variantData = variantJsonPath ? await readData(variantJsonPath) : undefined;

    // Cascade (lowest → highest): project global data → component defaults → variant → live.
    // globalData is the base (cloned so the shared, once-loaded object is never mutated); component
    // data overrides it on every key.
    const data = deepMerge(
      structuredClone(options.globalData ?? {}),
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

    registerHelpers(env, mintId, () => lastMintedId, options.helpers, options.helperRegistrars);

    // Register every discovered component as a cascade-aware, base-seeded partial.
    // Iterates handleMap (handle → id) and looks up file paths in discoveryMap — no reconstruction.
    for (const [flatName, compId] of handleMap) {
      const compEntry = discoveryMap.get(compId);
      if (!compEntry?.hbsPath) continue; // skip synthesized base-less nodes (no template to register)
      try {
        const partialSrc = await readFile(compEntry.hbsPath, "utf-8");

        // Every discovered component is registered, but only one this render includes reports its
        // invalid data: the diagnostic is added when the partial runs, below.
        const childData = compEntry.jsonPath ? await readDataFile(compEntry.jsonPath) : {};
        const childDataPath = compEntry.jsonPath;
        // A variant included by its handle (`{{> "atoms-chip~danger"}}`) gets its base's data beneath
        // its own, exactly as the variant renders on its own page.
        const variantTilde = compId.indexOf("~");
        const baseJsonPath = variantTilde > 0 ? discoveryMap.get(compId.slice(0, variantTilde))?.jsonPath : undefined;
        const baseData = baseJsonPath ? await readDataFile(baseJsonPath) : {};
        const childDefaults: Record<string, unknown> = deepMerge(structuredClone(baseData.data ?? {}), childData.data);

        const childTemplate = env.compile(partialSrc);
        const capturedDefaults = childDefaults;
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

            const merged = deepMerge(
              structuredClone(capturedDefaults),
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
            const result = childTemplate(merged, runtime);

            currentBase = savedBase;
            return result;
          } as unknown as string
        );
      } catch {
        // directory without a matching .hbs — skip
      }
    }

    // A no-op `@partial-block` for the top-level render: a block partial viewed standalone (e.g.
    // dialog-content, whose template has `{{> @partial-block}}`) has no enclosing block, so it must
    // render an empty block rather than throw. Block invocations override this with the real body.
    const html = env.compile(templateSrc)(data, {
      partials: { ...env.partials, "@partial-block": () => "" },
    });

    // ---- Diagnostics (M4.9 / M4.9-finalise) ----
    const diagnostics: Diagnostic[] = [...dataDiagnostics.values()];

    // HTML content-model validation (fragment-scoped — no doctype/shell noise).
    const htmlReport = htmlValidator.validateStringSync(html);
    for (const result of htmlReport.results) {
      for (const msg of result.messages) {
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
    }

    // Schema validation (M4.9). schemaPath comes from the discovery entry — no reconstruction.
    try {
      if (!entry.schemaPath) throw new Error("no schema");
      const schemaText = await readFile(entry.schemaPath, "utf-8");
      const schema = JSON.parse(schemaText) as {
        required?: string[];
        properties?: Record<string, { type?: string | string[] }>;
      };

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
        const jsType = typeof val;
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
    } catch { /* no schema file — skip */ }

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
