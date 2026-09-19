// @pattern-dump/dev-server — flattening diagnostic (corpus-level, [SUBJECT-DEBT])
//
// Detects clusters of components that are near-duplicate copies of ONE template, flattened along a
// class-token (hTWOo's `ql-list-button-*` is the archetype). This is a SUBJECT-DEBT lens: PD reports
// the sprawl; it grows no model to absorb it, and never touches the subject.
//
// Pure module — no I/O. The dev-server wiring (surfaceFlattening) reads the .hbs sources, supplies
// composition edges, and writes FLATTENED.generated.md. Reuses the same node-html-parser parse as
// extractUsedClasses (Handlebars expressions survive as harmless text nodes) — no new dependency,
// no Handlebars AST.
//
// The discriminator triple (the false-positive defence): a pair is a flattened-copy candidate iff
//   (1) shared static class root, AND
//   (2) skeleton similarity >= theta, AND
//   (3) no composition edge between the pair (a wrapper that includes+restyles a base is legitimate
//       composition, not a copy).
// "One derived graph (composition) sharpens another (flattening)" — that is why the finding is precise.
//
// SCOPE (calibrated against hTWOo, read-only): the reliable signal is CLASS-TOKEN drift — copies that
// differ only in class values (the `oneline`/`one-line`, dropped-token bugs) keep an IDENTICAL skeleton
// and score exactly 1.0, so they cluster cleanly. STRUCTURAL drift — a copy whose markup also changed —
// scores in the same ≤0.89 band as a genuinely-distinct-but-similar sibling family, and NO threshold
// separates the two (see FlatteningOpts.theta). This detector catches class-token flattening; structural
// near-duplicates need a second signal or human review. The triple + skeleton-identity do the work; θ
// only needs to sit in the empty gap above the sibling-family band.

import { parse as parseHtml } from "node-html-parser";
import type { HTMLElement } from "node-html-parser";

// ---- Skeleton: tag-name + attribute-NAME structure, values/text/hbs-expr stripped ----

export interface SkelNode {
  tag: string;
  attrs: string[];        // attribute NAMES only (sorted); values dropped
  children: SkelNode[];
}

export interface Skeleton {
  tree: SkelNode[];       // top-level element forest (a template may have multiple roots)
  preorder: string[];     // depth-marked token sequence, for the similarity metric
  root: string | null;    // the static class root (first static class on the first top-level element)
  staticClasses: string[]; // all static class tokens in the markup (for delta reporting)
}

const isElement = (n: { nodeType: number }): boolean => n.nodeType === 1;

/** Static class tokens on an element, preserving document order.
 *  hbs expressions are stripped FIRST (replaced with a space) so a static token glued to a
 *  conditional — hTWOo's `class="hoo-qlbtn center{{#if mode}} mode-edit{{/if}}"` — still yields
 *  `center` (calibration showed these tokens are exactly the drift the delta list must surface).
 *  A dangling BEM connector left by a stripped dynamic suffix (`hoo-qlbtn--{{variant}}` → `hoo-qlbtn--`)
 *  is trimmed back to its base. Minor imprecision: a conditionally-rendered class (`mode-edit`) is
 *  counted as static — acceptable for a delta readout, and it never affects clustering (the skeleton
 *  ignores class values entirely). */
function staticClassTokens(el: HTMLElement): string[] {
  const raw = el.attributes?.class ?? "";
  return raw
    .replace(/\{\{[^}]*\}\}/g, " ")     // drop hbs expressions, recovering tokens glued to them
    .split(/\s+/)
    .map((t) => t.replace(/-+$/, ""))    // trim a dangling connector left by a stripped dynamic suffix
    .filter((t) => t && !t.includes("{") && !t.includes("}"));
}

function toSkelNode(el: HTMLElement): SkelNode {
  const attrs = Object.keys(el.attributes ?? {}).sort();
  const children: SkelNode[] = [];
  for (const child of el.childNodes) {
    if (isElement(child)) children.push(toSkelNode(child as HTMLElement));
  }
  return { tag: el.tagName ? el.tagName.toLowerCase() : "", attrs, children };
}

/** Elements plus attribute names: how much shape a skeleton carries. */
function skeletonSize(nodes: SkelNode[]): number {
  return nodes.reduce((n, node) => n + 1 + node.attrs.length + skeletonSize(node.children), 0);
}

function toPreorder(nodes: SkelNode[], depth: number, out: string[]): void {
  for (const n of nodes) {
    out.push(`${depth}<${n.tag}${n.attrs.length ? " " + n.attrs.join(",") : ""}>`);
    toPreorder(n.children, depth + 1, out);
  }
}

/** Strip Handlebars comments so commented-out markup never counts as real structure or classes.
 *  (Real hTWOo templates carry `{{!-- <li class="sh-ql-menuiterm"> --}}` — without this the parser
 *  reads that `<li>` as a live element and leaks its class.) */
function stripHbsComments(hbs: string): string {
  return hbs.replace(/\{\{!--[\s\S]*?--\}\}/g, "").replace(/\{\{![\s\S]*?\}\}/g, "");
}

/** Parse a raw .hbs and derive its structural skeleton.
 *  NOTE (parse fidelity): node-html-parser reads raw hbs with expressions as text — robust for the
 *  tag skeleton, but on malformed templates (a stray `</meuu>`, `{{#if}}` inside an attribute value)
 *  it can drop a container element's class. That degrades the DELTA readout on those files, never the
 *  clustering (which keys on tag structure). A lossy delta is honest under-reporting, not a wrong cluster. */
export function deriveSkeleton(hbs: string): Skeleton {
  const doc = parseHtml(stripHbsComments(hbs));
  const topElements = doc.childNodes.filter(isElement) as HTMLElement[];

  const tree = topElements.map(toSkelNode);
  const preorder: string[] = [];
  toPreorder(tree, 0, preorder);

  // All static classes (querySelectorAll mirrors extractUsedClasses' harvest).
  const staticClasses = new Set<string>();
  for (const el of doc.querySelectorAll("[class]")) {
    for (const tok of staticClassTokens(el)) staticClasses.add(tok);
  }

  // Root = first static class token on the first top-level element.
  const root = topElements.length ? (staticClassTokens(topElements[0])[0] ?? null) : null;

  return { tree, preorder, root, staticClasses: [...staticClasses] };
}

// ---- Similarity metric (behind an interface — calibration picks the implementation) ----

export interface SimilarityMetric {
  name: string;
  /** Cheap pre-filter in [0,1] — shingle-Jaccard over preorder k-grams. */
  prefilter(a: Skeleton, b: Skeleton): number;
  /** Precise confirm in [0,1] — normalized edit distance over the skeleton preorder. */
  confirm(a: Skeleton, b: Skeleton): number;
}

function shingles(tokens: string[], k: number): Set<string> {
  const set = new Set<string>();
  if (tokens.length < k) {
    if (tokens.length) set.add(tokens.join(""));
    return set;
  }
  for (let i = 0; i + k <= tokens.length; i++) set.add(tokens.slice(i, i + k).join(""));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Levenshtein distance over token arrays. */
function levenshtein(a: string[], b: string[]): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Default metric: shingle-Jaccard prefilter + normalized-Levenshtein confirm. Both on the preorder
 *  token sequence, which reflects nesting via depth markers. Tree-edit-distance (Zhang–Shasha) is the
 *  named upgrade behind the same `confirm` seam if calibration shows the linear form mis-ranks. */
export function defaultMetric(shingleK = 2): SimilarityMetric {
  return {
    name: `jaccard(k=${shingleK})+levenshtein`,
    prefilter: (a, b) => jaccard(shingles(a.preorder, shingleK), shingles(b.preorder, shingleK)),
    confirm: (a, b) => {
      const max = Math.max(a.preorder.length, b.preorder.length);
      if (max === 0) return 1;
      return 1 - levenshtein(a.preorder, b.preorder) / max;
    },
  };
}

// ---- Detection ----

export interface FlatteningInput {
  id: string;
  hbs: string;
}

export interface FlatteningOpts {
  /** Confirm-similarity cutoff [0,1]. Calibrated default 0.95. The score distribution is discrete,
   *  not continuous: flattened copies score EXACTLY 1.0 (class-token drift keeps the skeleton
   *  identical), distinct-but-similar sibling families sit ≤0.89, and the [0.90,1.0) band is empty —
   *  0.95 is the centre of that gap. LIMITATION: STRUCTURAL drift (a copy whose markup also changed)
   *  lands in the ≤0.89 band, indistinguishable from a distinct sibling family by threshold alone;
   *  no θ separates those (lowering θ merges real families). Catching structural drift needs a second
   *  signal or human review — it is a real limit, not solved here. */
  theta?: number;
  /** Prefilter cutoff [0,1] — pairs below this skip the (costlier) confirm. */
  prefilterCutoff?: number;
  shingleK?: number;
  minClusterSize?: number;
  /** Smallest skeleton compared at all, counted as elements plus attribute names. Default 3: a bare
   *  `<main class>` or `<div class>` around includes (size 2) is shared by unrelated templates and
   *  says nothing about copied markup, while a single `<input>` with a dozen attributes is a real
   *  shape to copy. */
  minSkeletonSize?: number;
  rootMatch?: "exact" | "prefix";
  metric?: SimilarityMetric;
  /** Composition-edge predicate (supplied by dev-server from the composition registry). */
  hasEdge?: (a: string, b: string) => boolean;
}

export interface ClusterMemberDelta {
  id: string;
  extraClasses: string[];   // static classes this member has that the cluster's modal set lacks
  missingClasses: string[]; // modal-set classes this member lacks (the dropped token)
}

export interface FlatteningCluster {
  root: string;
  members: string[];            // sorted component ids
  skeleton: string[];           // representative preorder (the shared shape)
  memberClasses: Record<string, string[]>;
  deltas: ClusterMemberDelta[]; // members that diverge from the modal class set (the drift)
}

const DEFAULTS: Required<Omit<FlatteningOpts, "metric" | "hasEdge">> = {
  theta: 0.95,           // centre of the empty [0.89,1.0] score gap — see FlatteningOpts.theta
  prefilterCutoff: 0.6,
  shingleK: 2,
  minClusterSize: 2,
  minSkeletonSize: 3,
  rootMatch: "exact",    // full root-class match — emphasis families (hoo-button vs -primary) stay distinct
};

/** The bucket key for a component's root under the chosen match mode. */
function rootKey(root: string, mode: "exact" | "prefix"): string {
  if (mode === "exact") return root;
  // "prefix": drop the last dash-separated segment (a modifier), e.g. hoo-qlbtn-fill → hoo-qlbtn.
  const i = root.lastIndexOf("-");
  return i > 0 ? root.slice(0, i) : root;
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    // path-compress
    let c = x;
    while (this.parent.get(c) !== r) { const nxt = this.parent.get(c)!; this.parent.set(c, r); c = nxt; }
    return r;
  }
  union(a: string, b: string): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/** Detect flattened-copy clusters. Pure: same inputs → same output (ids sorted throughout). */
export function detectFlattening(
  inputs: FlatteningInput[],
  opts: FlatteningOpts = {},
): FlatteningCluster[] {
  const o = { ...DEFAULTS, ...opts };
  const metric = opts.metric ?? defaultMetric(o.shingleK);
  const hasEdge = opts.hasEdge ?? (() => false);

  // Skeletons, deterministic order by id.
  const sorted = [...inputs].sort((a, b) => a.id.localeCompare(b.id));
  const skel = new Map<string, Skeleton>();
  for (const { id, hbs } of sorted) skel.set(id, deriveSkeleton(hbs));

  // Bucket by root key; a component with no static root can't satisfy triple #1 → excluded.
  const buckets = new Map<string, string[]>();
  for (const { id } of sorted) {
    const s = skel.get(id)!;
    if (!s.root) continue;
    if (skeletonSize(s.tree) < o.minSkeletonSize) continue;
    const key = rootKey(s.root, o.rootMatch);
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(id);
  }

  const clusters: FlatteningCluster[] = [];

  for (const [, ids] of [...buckets].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (ids.length < o.minClusterSize) continue;

    const uf = new UnionFind();
    for (const id of ids) uf.find(id); // seed singletons

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j];
        const sa = skel.get(a)!, sb = skel.get(b)!;
        if (metric.prefilter(sa, sb) < o.prefilterCutoff) continue;   // #2 (cheap)
        if (metric.confirm(sa, sb) < o.theta) continue;               // #2 (precise)
        if (hasEdge(a, b)) continue;                                  // #3 composition-edge exclusion
        uf.union(a, b);
      }
    }

    // Gather connected components of size >= minClusterSize.
    const groups = new Map<string, string[]>();
    for (const id of ids) {
      const r = uf.find(id);
      (groups.get(r) ?? groups.set(r, []).get(r)!).push(id);
    }
    for (const members of groups.values()) {
      if (members.length < o.minClusterSize) continue;
      members.sort((a, b) => a.localeCompare(b));
      clusters.push(buildCluster(members, skel));
    }
  }

  // Deterministic order: by root, then first member id.
  clusters.sort((a, b) => a.root.localeCompare(b.root) || a.members[0].localeCompare(b.members[0]));
  return clusters;
}

function buildCluster(members: string[], skel: Map<string, Skeleton>): FlatteningCluster {
  const memberClasses: Record<string, string[]> = {};
  const freq = new Map<string, number>();
  for (const id of members) {
    const classes = [...skel.get(id)!.staticClasses].sort();
    memberClasses[id] = classes;
    for (const c of classes) freq.set(c, (freq.get(c) ?? 0) + 1);
  }
  // Modal set: classes present in a strict majority of members.
  const half = members.length / 2;
  const modal = new Set([...freq].filter(([, n]) => n > half).map(([c]) => c));

  const deltas: ClusterMemberDelta[] = [];
  for (const id of members) {
    const mine = new Set(memberClasses[id]);
    const extra = [...mine].filter((c) => !modal.has(c)).sort();
    const missing = [...modal].filter((c) => !mine.has(c)).sort();
    if (extra.length || missing.length) deltas.push({ id, extraClasses: extra, missingClasses: missing });
  }

  const root = skel.get(members[0])!.root ?? "";
  return { root, members, skeleton: skel.get(members[0])!.preorder, memberClasses, deltas };
}

// ---- Report rendering (the side artifact) ----

export interface FlatteningReportMeta {
  subjectSha?: string;
  generatedAt?: string;
}

/** Deterministic markdown. "No clusters" writes a clean empty-state (never parse it — re-derive). */
export function renderFlatteningReport(
  clusters: FlatteningCluster[],
  meta: FlatteningReportMeta = {},
): string {
  const head = [
    "# Flattened templates (structural)",
    "",
    "> **Scope:** this detects **structural flattening** — clusters of components that are " +
      "near-duplicate copies of one template, flattened along a class-token. It is a separate corpus " +
      "lens: **not** the diagnostics graph, **not** a11y, **not** HTML validation.",
    ">",
    "> Every finding is `[SUBJECT-DEBT]` — the subject flattened its own templates; PD reports the " +
      "sprawl and grows no model to absorb it. One derived graph (composition) sharpens another " +
      "(flattening): a wrapper that *includes* a base is excluded as legitimate composition, not a copy.",
    ">",
    "> **Boundary:** this catches **class-token** flattening — copies with identical structure that " +
      "differ only in class values. A copy whose **markup** also drifted is not distinguishable from a " +
      "genuinely-distinct sibling family by structural similarity alone; those need review, not a lower " +
      "threshold. Absence of a cluster is not proof of no duplication.",
    ">",
    "> **Reading the count:** a component being *in a cluster* is not the same as a distinct flattening " +
      "problem. With exact root-match, one logical family whose emphasis is baked into the root class " +
      "(`hoo-button` vs `hoo-button-primary`) is reported as **separate clusters** — so the cluster count " +
      "and the in-cluster percentage **over-count** distinct problems (the emphasis under-reporting). " +
      "Read the number as \"templates touched by flattening,\" never \"N distinct defects.\"",
    "",
  ];
  if (meta.subjectSha) head.push(`_subject: \`${meta.subjectSha}\`_`, "");
  if (meta.generatedAt) head.push(`_generated: ${meta.generatedAt}_`, "");

  if (clusters.length === 0) {
    return [...head, "No flattened template clusters detected.", ""].join("\n");
  }

  const totalMembers = clusters.reduce((n, c) => n + c.members.length, 0);
  head.push(
    `${clusters.length} flattened cluster${clusters.length > 1 ? "s" : ""} detected across ` +
      `${totalMembers} components.`,
    "",
  );

  const body = clusters.flatMap((c) => {
    const lines = [
      `## \`${c.root}\` — ${c.members.length} copies  \`[SUBJECT-DEBT]\``,
      "",
      "**Members:**",
      ...c.members.map((m) => `- \`${m}\``),
      "",
      "**Shared skeleton:**",
      "",
      "```",
      ...c.skeleton,
      "```",
      "",
    ];
    if (c.deltas.length) {
      lines.push("**Drift (per-member deltas from the cluster's modal class set):**");
      for (const d of c.deltas) {
        const parts: string[] = [];
        if (d.extraClasses.length) parts.push(`+ ${d.extraClasses.map((x) => `\`${x}\``).join(" ")}`);
        if (d.missingClasses.length) parts.push(`− ${d.missingClasses.map((x) => `\`${x}\``).join(" ")}`);
        lines.push(`- \`${d.id}\`: ${parts.join("  ")}`);
      }
      lines.push("");
    } else {
      lines.push("_No class-token drift between members (byte-clean copies)._", "");
    }
    return lines;
  });

  return [...head, ...body].join("\n");
}
