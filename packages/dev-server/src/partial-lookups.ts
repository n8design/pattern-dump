// Which partials a project helper includes by name at render time (hTWOo's dynamicPartial looks one up from data):
// no template names them, so the composition graph doesn't have them, and the audit's cache must still know them
// (a defect put into such a partial has to show on the component that includes it). Each project helper registrar is
// given the renderer's environment through a stand-in that notes every `partials[name]` it reads; an audit records
// the names read while it runs (recordPartialLookups). Two recordings at once both get every name: a component's
// set can only grow that way, which costs a re-audit, never a stale verdict.

const active = new Set<Set<string>>();

/** `registrar`, given the environment through the stand-in that notes partial lookups. */
export function recordingPartials(registrar: (hb: unknown) => void): (hb: unknown) => void {
  return hb => {
    if (!hb || typeof hb !== "object") { registrar(hb); return; }
    registrar(new Proxy(hb as object, {
      get(target, key, receiver) {
        const value: unknown = Reflect.get(target, key, receiver);
        if (key !== "partials" || !value || typeof value !== "object") return value;
        return new Proxy(value as object, {
          get(partials, name, r) {
            if (typeof name === "string") for (const names of active) names.add(name);
            return Reflect.get(partials, name, r) as unknown;
          },
        });
      },
    }));
  };
}

/** `run()`, with the names of the partials project helpers looked up while it ran. */
export async function recordPartialLookups<T>(run: () => Promise<T>): Promise<{ value: T; names: Set<string> }> {
  const names = new Set<string>();
  active.add(names);
  try {
    return { value: await run(), names };
  } finally {
    active.delete(names);
  }
}
