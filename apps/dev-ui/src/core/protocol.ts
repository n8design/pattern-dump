// Wire-protocol compatibility between this bundled shell and the server it is talking to.
//
// The shell is compiled against one PD_PROTOCOL_VERSION; the server announces its own on the socket.
// They can disagree in practice — the dev-ui bundle is re-read per request while the server process
// caches its packages at startup — and when they do, fields silently go missing. Saying so up front
// turns a confusing half-working shell into one legible Console line.

import { PD_PROTOCOL_VERSION } from "@pattern-dump/contracts";

/** A human-readable mismatch message, or null when the server speaks this shell's protocol. */
export function protocolMismatch(serverProtocol: unknown, shellProtocol: number = PD_PROTOCOL_VERSION): string | null {
  if (serverProtocol === shellProtocol) return null;
  const server = typeof serverProtocol === "number" ? `v${serverProtocol}` : "an unknown version";
  return `Protocol mismatch — the server speaks ${server}, this shell expects v${shellProtocol}. ` +
    "Rebuild and restart the dev server, then reload.";
}
