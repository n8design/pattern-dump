// One JSON parse for the files a component is made of (its data, its schema), so every reader reports a file that
// doesn't parse the same way: the parser's reason, at a line and column. Used by the renderer and by the storefront.

/** A parsed JSON text, or why it isn't one: the parser's reason (without its "in JSON at position" tail) and where. */
export type ParsedJson =
  | { ok: true; value: unknown }
  | { ok: false; reason: string; line?: number; column?: number };

/** Line and column of a JSON parse error, from the parser's message (best-effort). */
function jsonErrorPosition(reason: string, text: string): { line?: number; column?: number } {
  const lineColumn = /line (\d+) column (\d+)/.exec(reason);
  if (lineColumn) return { line: Number(lineColumn[1]), column: Number(lineColumn[2]) };
  const position = /position (\d+)/.exec(reason);
  // No position: the text ended early ("Unexpected end of JSON input"), so where it ends.
  const at = position ? Number(position[1]) : /end of JSON/i.test(reason) ? text.length : undefined;
  if (at === undefined) return {};
  const lines = text.slice(0, at).split("\n");
  return { line: lines.length, column: lines[lines.length - 1]!.length + 1 };
}

export function parseJson(text: string): ParsedJson {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const reason = message.replace(/\s+in JSON at position \d+.*$/s, "").replace(/\s*\(line \d+ column \d+\)\s*$/, "");
    return { ok: false, reason, ...jsonErrorPosition(message, text) };
  }
}
