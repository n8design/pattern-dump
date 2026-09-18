// The rendered a11y tier — runs axe inside the live preview iframe.
//
// scanGen is module-private and MUST stay beside runRenderedA11yScan. It is a generation counter:
// each scan captures `++scanGen`, and every async continuation checks it is still current before
// writing. That is how a superseded scan (the user navigated, switched variant, or HMR fired
// mid-scan) is discarded instead of overwriting fresh results with stale ones. Splitting the counter
// from the scan into different modules would quietly break that discard.
//
// Callers set session.scanPending = true and call refreshDiagnostics() BEFORE invoking this, so the
// pending state paints immediately rather than after axe resolves.

import { PD_ROUTES } from "@pattern-dump/contracts";
import { dom } from "../core/dom.js";
import { resourceUrl } from "../core/runtime.js";
import { session } from "../core/session.js";
import { mapAxeResults } from "./axe-map.js";
import { refreshDiagnostics } from "./diagnostics.js";

let scanGen = 0;


async function injectAxe(): Promise<void> {
  const script = dom.iframe.contentDocument!.createElement("script");
  script.src = resourceUrl(PD_ROUTES.axeCore);
  await new Promise<void>((res, rej) => {
    script.onload = () => res();
    script.onerror = rej;
    dom.iframe.contentDocument!.head.appendChild(script);
  });
}

// Callers must set scanPending = true and call refreshDiagnostics() before invoking this.
// Generation token (scanGen) ensures only the latest scan writes results — superseded scans
// bail without clobbering renderedA11y or prematurely dropping scanPending.
export async function runRenderedA11yScan(): Promise<void> {
  if (!session.current || !dom.iframe.contentDocument) return;
  const gen = ++scanGen;

  if (session.needsRenderingRules.length === 0) {
    await new Promise<void>(res => setTimeout(res, 200));
    if (session.needsRenderingRules.length === 0) {
      if (gen === scanGen) { session.scanPending = false; refreshDiagnostics(); }
      return;
    }
  }

  try {
    // srcdoc sets the document immediately but linked CSS still fetches over the network.
    // Axe needs computed contrast, so wait for the iframe's load event if not yet complete.
    if (dom.iframe.contentDocument?.readyState !== "complete") {
      await new Promise<void>(res => dom.iframe.addEventListener("load", () => res(), { once: true }));
    }
    if (!dom.iframe.contentDocument) {
      if (gen === scanGen) { session.scanPending = false; refreshDiagnostics(); }
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axeWindow = dom.iframe.contentWindow as any;
    if (!axeWindow.axe) await injectAxe();
    // The whole page: the component's markup is the body's content (there is no wrapper to scope to).
    const root = dom.iframe.contentDocument.body;
    const results = await axeWindow.axe.run(root, { runOnly: session.needsRenderingRules }) as {
      violations?: unknown[]; incomplete?: unknown[];
    };
    if (gen !== scanGen) return;
    session.renderedA11y = mapAxeResults(results);
  } catch (err) {
    if (gen !== scanGen) return;
    session.renderedA11y = [];
    console.error("[pd-a11y] scan error:", err);
  } finally {
    if (gen === scanGen) {
      session.scanPending = false;
      refreshDiagnostics();
    }
  }
}
