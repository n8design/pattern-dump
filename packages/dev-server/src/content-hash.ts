// The content hash a URL is stamped with (`?v=<hash>`): the first 10 hex digits of the SHA-256 of the bytes as
// served. A URL changes exactly when what it serves changes, the same on every machine and checkout, unlike a
// file's mtime. Ten hex digits keep URLs short; a collision would only let a browser keep a cached copy.
import { createHash } from "node:crypto";

export function contentHash(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 10);
}
