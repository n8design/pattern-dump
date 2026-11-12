// A behaviour script as it is served: its TypeScript entry point compiled once (esbuild, @pattern-dump/build)
// and kept until the watcher reports a change to it. The script route serves it, and documents stamp its
// URL with the hash of these same bytes, so a stamp changes exactly when the served script does, an import's
// change included.
import { compileScriptFile } from "@pattern-dump/build";
import { containedFile } from "./contained-file.js";
import { contentHash } from "./content-hash.js";
import { scriptFor, type ServerState } from "./server-state.js";

/** No entry point `<id>.ts` in any scripts folder. */
export class ScriptMissing extends Error {}

/** The compiled script. Throws ScriptMissing when no folder has it, or the compile error. */
export function compiledScript(state: ServerState, scriptsDirs: readonly string[], scriptId: string): Promise<string> {
  return scriptFor(state, scriptId).get(async () => {
    // The project's scripts first, then each package's — a project script replaces a package's. Each
    // entry point must be inside its scripts folder.
    let entryPoint: string | undefined;
    for (const d of scriptsDirs) { entryPoint = (await containedFile(d, `${scriptId}.ts`)) ?? undefined; if (entryPoint) break; }
    // Say what is missing. Compiling a path we know is absent would report it as an ENOENT
    // compile error inside the preview, naming neither the id nor where it was looked for.
    if (entryPoint === undefined) throw new ScriptMissing(scriptId);
    return compileScriptFile(entryPoint);
  });
}

/** Each script's stamp: the content hash of its compiled bytes. A script that is missing or doesn't compile
 *  gets none; its URL stays bare and the script route reports why. */
export async function scriptStamps(state: ServerState, scriptsDirs: readonly string[], ids: readonly string[]): Promise<Map<string, string>> {
  const stamps = new Map<string, string>();
  await Promise.all(ids.map(async id => {
    try { stamps.set(id, contentHash(await compiledScript(state, scriptsDirs, id))); } catch { /* no stamp */ }
  }));
  return stamps;
}
