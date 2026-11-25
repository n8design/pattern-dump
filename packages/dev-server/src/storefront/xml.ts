// Text for an XML document Pattern Dump writes (sitemap.xml, the feeds): escaped, so it is character data and never
// markup; and without the characters XML 1.0 doesn't allow at all (most control characters, U+FFFE, U+FFFF, a
// surrogate on its own), which no escape can carry and which would make the whole document not well formed.

// eslint-disable-next-line no-control-regex
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** `s` as XML character data, or as an attribute's value in double or single quotes. */
export function escapeXml(s: string): string {
  return s.replace(NOT_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
