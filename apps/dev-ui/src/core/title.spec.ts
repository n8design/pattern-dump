import { describe, expect, it } from "vitest";
import { brandTitle, documentTitle } from "./title.js";

describe("the browser tab's title", () => {
  it("is the brand's title, else Pattern Dump", () => {
    expect(brandTitle("Acme DS")).toBe("Acme DS");
    expect(brandTitle(undefined)).toBe("Pattern Dump");
  });

  it("puts the component in front on a component route, and is the brand alone elsewhere", () => {
    expect(documentTitle("Acme DS", "Button")).toBe("Button · Acme DS");
    expect(documentTitle(brandTitle(undefined), "Button")).toBe("Button · Pattern Dump");
    expect(documentTitle("Acme DS")).toBe("Acme DS");
  });
});
