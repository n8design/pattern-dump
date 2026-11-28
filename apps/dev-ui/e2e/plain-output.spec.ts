// A Playwright worker writes plain text: Playwright gives every worker FORCE_COLOR=1, and playwright.config.ts sets
// it back to 0, which each worker reads as it loads the config. A spec that spies on console.* then sees no escapes.
import { test, expect } from "@playwright/test";
import { styleText } from "node:util";

test("a worker's console takes no colour", () => {
  expect(process.env["FORCE_COLOR"]).toBe("0");
  expect(styleText("bold", "x", { stream: process.stdout })).toBe("x");
});
