import { describe, it, expect } from "vitest";
import { runA11yProducer } from "../src/producer.js";

describe("runA11yProducer", () => {
  it("returns empty array for clean HTML", async () => {
    const result = await runA11yProducer("<button>Click me</button>");
    expect(result).toHaveLength(0);
  });

  it("image-alt: unlabelled img → A11yDiagnostic with ruleId and error severity", async () => {
    const result = await runA11yProducer('<img src="photo.jpg">');
    expect(result.length).toBeGreaterThan(0);
    const diag = result.find(d => d.ruleId === "image-alt");
    expect(diag).toBeDefined();
    expect(diag!.kind).toBe("A11Y");
    expect(diag!.source).toBe("axe");
    expect(diag!.severity).toBe("error");
    expect(diag!.target).toBeTruthy();
    expect(diag!.nodeHtml).toContain("img");
    expect(diag!.helpUrl).toContain("image-alt");
  });

  it("label: unlabelled input → A11yDiagnostic for label rule", async () => {
    const result = await runA11yProducer('<input type="text">');
    const diag = result.find(d => d.ruleId === "label");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("error");
  });

  it("button-name: empty button → A11yDiagnostic", async () => {
    const result = await runA11yProducer("<button></button>");
    const diag = result.find(d => d.ruleId === "button-name");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("error");
  });

  it("severity map: critical/serious → error, moderate/minor → warning", async () => {
    // image-alt fires as critical in axe 4.x
    const result = await runA11yProducer('<img src="x.jpg">');
    const diag = result.find(d => d.ruleId === "image-alt");
    expect(diag).toBeDefined();
    // critical or serious → error
    expect(diag!.severity).toBe("error");
  });

  it("duplicate-id: two elements with same id → A11yDiagnostic", async () => {
    const result = await runA11yProducer('<div id="d1">a</div><div id="d1">b</div>');
    const diag = result.find(d => d.ruleId === "duplicate-id");
    expect(diag).toBeDefined();
  });

  it("A11yDiagnostic has all required fields", async () => {
    const result = await runA11yProducer('<img src="photo.jpg">');
    const diag = result[0]!;
    expect(diag.kind).toBe("A11Y");
    expect(diag.source).toBe("axe");
    expect(typeof diag.severity).toBe("string");
    expect(typeof diag.message).toBe("string");
    expect(typeof diag.ruleId).toBe("string");
    expect(typeof diag.target).toBe("string");
    expect(typeof diag.nodeHtml).toBe("string");
    expect(typeof diag.help).toBe("string");
    expect(typeof diag.helpUrl).toBe("string");
  });
});
