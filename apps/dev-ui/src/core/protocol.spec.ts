import { describe, expect, it } from "vitest";
import { PD_PROTOCOL_VERSION } from "@pattern-dump/contracts";
import { protocolMismatch } from "./protocol.js";

describe("protocolMismatch", () => {
  it("is null when the server speaks the bundled protocol", () => {
    expect(protocolMismatch(PD_PROTOCOL_VERSION)).toBeNull();
  });

  it("names both versions when they differ", () => {
    const msg = protocolMismatch(2, 1);
    expect(msg).toContain("v2");
    expect(msg).toContain("v1");
    expect(msg).toMatch(/restart/i);
  });

  it("treats a missing or non-numeric version as a mismatch, not a match", () => {
    expect(protocolMismatch(undefined, 1)).toContain("unknown version");
    expect(protocolMismatch("1", 1)).not.toBeNull();
  });
});
