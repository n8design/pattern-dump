import { afterEach, describe, expect, it } from "vitest";
import { defineConfig } from "@pattern-dump/config";
import { resolveServerConfig } from "../src/server-config.js";
import { DEFAULT_DATES, dateFormatter } from "../src/storefront/date-text.js";

describe("site.dates", () => {
  const config = (dates?: Intl.DateTimeFormatOptions) => defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist", styles: { strategy: "parallel", dir: "./src/styles" },
    storefront: { pagesDir: "./pages", outDir: "./www", ...(dates ? { dates } : {}) },
  });

  it("is the long style unless the config sets it, and the config's when it does", () => {
    expect(resolveServerConfig(config(), "/project").storefront?.dates).toEqual({ dateStyle: "long" });
    expect(resolveServerConfig(config({ day: "numeric", month: "short" }), "/project").storefront?.dates)
      .toEqual({ day: "numeric", month: "short" });
  });
});

describe("dateFormatter", () => {
  it("writes the day in the style of the language, long by default", () => {
    expect(DEFAULT_DATES).toEqual({ dateStyle: "long" });
    const cases: Array<[string, string, string]> = [
      ["en-GB", "1 November 2026", "1 Nov 2026"],
      ["en-US", "November 1, 2026", "Nov 1, 2026"],
      ["en", "November 1, 2026", "Nov 1, 2026"],
      ["de-AT", "1. November 2026", "1. Nov. 2026"],
      ["sv-SE", "1 november 2026", "1 nov. 2026"],
    ];
    for (const [lang, long, parts] of cases) {
      expect(dateFormatter(lang)("2026-11-01"), lang).toBe(long);
      expect(dateFormatter(lang, { day: "numeric", month: "short", year: "numeric" })("2026-11-01"), lang).toBe(parts);
    }
  });

  it("writes a git date-time as the author's day, the first ten characters", () => {
    const en = dateFormatter("en-GB");
    expect(en("2026-11-13T23:30:00-08:00")).toBe("13 November 2026");
    expect(en("2026-11-14T00:30:00+13:00")).toBe("14 November 2026");
  });

  it("returns a value that is no day as it is", () => {
    expect(dateFormatter("en")("soon")).toBe("soon");
  });

  it("writes a year before 100 as that year", () => {
    expect(dateFormatter("en-GB", { day: "numeric", month: "long", year: "numeric" })("0050-03-01")).toBe("1 March 50");
  });

  describe("wherever the site is built", () => {
    const tz = process.env.TZ;
    afterEach(() => {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    });

    for (const zone of ["America/Los_Angeles", "Pacific/Kiritimati", "UTC"]) {
      it(`writes the same day in ${zone}`, () => {
        process.env.TZ = zone;
        // The machine's zone really is in force (an assignment to TZ reaches Date and Intl at once in Node).
        expect(new Date(Date.UTC(2026, 10, 1)).getTimezoneOffset() !== 0, zone).toBe(zone !== "UTC");
        expect(dateFormatter("en-GB")("2026-11-01")).toBe("1 November 2026");
        expect(dateFormatter("en-US", { weekday: "long", day: "numeric", month: "long" })("2026-11-01")).toBe("Sunday, November 1");
        expect(dateFormatter("en-GB")("2026-12-31")).toBe("31 December 2026");
        expect(dateFormatter("en-GB")("2027-01-01")).toBe("1 January 2027");
      });
    }
  });
});
