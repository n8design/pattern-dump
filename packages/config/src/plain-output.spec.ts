import { describe, it, expect } from "vitest";
import { styleText } from "node:util";

// Nx gives every task FORCE_COLOR=true (and Playwright FORCE_COLOR=1), and with it set Node colours a pipe as well:
// every spied or spawned console line in the tests would carry escape codes. The vitest configs set FORCE_COLOR=0
// (not NO_COLOR, which FORCE_COLOR beats, with a warning on stderr).
describe("test output is plain", () => {
  it("FORCE_COLOR is 0, and styleText adds nothing to the console's stream", () => {
    expect(process.env["FORCE_COLOR"]).toBe("0");
    expect(styleText("bold", "x", { stream: process.stdout })).toBe("x");
  });
});
