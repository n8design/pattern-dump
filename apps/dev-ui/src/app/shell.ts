// The shell's static markup, loaded from shell.html.
//
// The 184-line template literal that used to sit inside mount() is now a real .html file, so it gets
// editor highlighting, formatting and review as markup rather than as a string. Every interpolation
// in the original was a static svgIcon() call — no data, no user content — so the file carries
// `<!--pd-icon:name-->` placeholders that are expanded here.
//
// renderShellHtml() reproduces the ORIGINAL STRING byte-for-byte, which was verified by bundling both
// and comparing hashes. Two details exist only to keep that true:
//   - The template literal began with a newline, which the parser turns into a whitespace text node
//     ahead of <div class="app">. The .html file does not start with a blank line, so it is re-added.
//   - Trailing newlines are stripped, because editors add one on save; without this, a harmless save
//     would silently append a text node to the mounted shell.
// Nothing currently reads those text nodes. They are preserved so the move is provably a no-op
// rather than probably one.

import shellHtml from "./shell.html";
import { svgIcon, type IconName } from "../icons/index.js";

export function renderShellHtml(): string {
  const expanded = shellHtml.replace(
    /<!--pd-icon:([a-z0-9-]+)-->/g,
    (_match, name: string) => svgIcon(name as IconName),
  );
  return "\n" + expanded.replace(/\n+$/, "");
}
