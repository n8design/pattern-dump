// The skin as a browser paints it — from pd dev, and from the built root on a static host: its fonts,
// its colour schemes, its one brand token, its cards, and no accessibility violations in light or dark.
import { expect, test, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { openChapters } from "./helpers.js";

const ROUTES = ["/", "/about/", "/guides/", "/guides/setup/"];

/** Wait until every live example on screen has been fitted (one in a closed chapter is not loaded) and
 *  every font face in use has loaded. */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLIFrameElement>("figure.doc-example iframe")]
    .filter(f => f.checkVisibility()).every(f => f.style.height !== "" && f.style.height !== "1px"));
  await page.evaluate(() => document.fonts.ready);
}

test.describe("the skin", () => {
  test("loads its own fonts: Montserrat for display, Source Serif 4 for text, IBM Plex Mono for labels", async ({ page }) => {
    await page.goto("/guides/setup/");
    await settle(page);
    const fonts = await page.evaluate(() => ({
      loaded: [...document.fonts].filter(f => f.status === "loaded").map(f => `${f.family} ${f.style}`).sort(),
      title: getComputedStyle(document.querySelector("h1")!).fontFamily,
      text: getComputedStyle(document.querySelector(".article-body p")!).fontFamily,
    }));
    // Every face this page uses: the mono's two weights for its labels, Montserrat's italic for its
    // marquee, its static Black for the footer's outlined title.
    expect(fonts.loaded).toEqual(["IBM Plex Mono normal", "IBM Plex Mono normal", "Montserrat italic", "Montserrat normal", "Montserrat Black normal", "Source Serif 4 normal"].sort());
    expect(fonts.title).toMatch(/^"?Montserrat"?,/);
    expect(fonts.text).toMatch(/^"Source Serif 4",/);
  });

  test("declares both colour schemes on the page and inside its live example, so light-dark() can follow the reader", async ({ page }) => {
    // Without color-scheme: light dark, light-dark() always picks the light value, whatever the reader's
    // setting: emulating a dark scheme alone would not catch that.
    await page.goto("/");
    await settle(page);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light dark");
    expect(await page.locator("figure.doc-example iframe").evaluate((f: HTMLIFrameElement) =>
      f.contentWindow!.getComputedStyle(f.contentDocument!.documentElement).colorScheme)).toBe("light dark");
  });

  test("sets its micro labels (section numbers, metadata, captions) in the mono, uppercase and widely tracked", async ({ page }) => {
    await page.goto("/guides/setup/");
    await openChapters(page);
    await settle(page);
    const label = (el: Element) => {
      const cs = getComputedStyle(el);
      return [cs.fontFamily.split(",")[0], cs.textTransform, parseFloat(cs.letterSpacing) / parseFloat(cs.fontSize) > 0.15];
    };
    const mono = ['"IBM Plex Mono"', "uppercase", true];
    expect(await page.locator(".site-tagline").evaluate(label)).toEqual(mono);
    expect(await page.locator(".site-footer-line").evaluate(label)).toEqual(mono);
    expect(await page.locator(".next-label").evaluate(label)).toEqual(mono);
    expect(await page.locator(".site-nav-list > li > a").nth(1).evaluate(el => {
      const cs = getComputedStyle(el, "::before");
      return [cs.fontFamily.split(",")[0], cs.textTransform, parseFloat(cs.letterSpacing) / parseFloat(cs.fontSize) > 0.15];
    })).toEqual(mono);
    expect(await page.locator("figure.doc-example figcaption").evaluate(label)).toEqual(mono);
    expect(await page.locator("figure.doc-example iframe").evaluate((f: HTMLIFrameElement) => {
      const cs = f.contentWindow!.getComputedStyle(f.contentDocument!.querySelector(".callout-title")!);
      return [cs.fontFamily.split(",")[0], cs.textTransform, parseFloat(cs.letterSpacing) / parseFloat(cs.fontSize) > 0.15];
    })).toEqual(mono);
  });

  for (const width of [1440, 390]) {
    test(`sets titles at poster scale at ${width}px: every hero title's longest word filling its column, up to 25vw`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const title = () => page.locator("h1").evaluate(h => {
        const range = document.createRange();
        range.selectNodeContents(h);
        const text = range.getBoundingClientRect(), cs = getComputedStyle(h), size = parseFloat(cs.fontSize);
        // What follows the title: in a hero, the meta row after it; elsewhere the next element.
        const next = (h.closest(".hero")?.nextElementSibling ?? h.nextElementSibling)?.getBoundingClientRect();
        // The widest line: for a title of several words, its longest word's.
        const widest = Math.max(...[...range.getClientRects()].map(r => r.width));
        return { size, fill: widest / h.getBoundingClientRect().width, overflow: h.scrollWidth > h.clientWidth + 1,
          clearsNext: !next || text.bottom <= next.top + 1,
          // Lines by the text's line boxes: at solid leading its content area is taller than a line height.
          lines: new Set([...range.getClientRects()].map(r => Math.round(r.top))).size,
          tracking: parseFloat(cs.letterSpacing) / size, leading: parseFloat(cs.lineHeight) / size };
      });
      for (const route of ["/", "/about/", "/guides/", "/guides/setup/"]) {
        await page.goto(route);
        await page.evaluate(() => document.fonts.ready);
        const t = await title();
        // Solid leading, but the descenders still clear what follows the title.
        // "Storefront bench" breaks between its words; the others are one word.
        expect(t, route).toMatchObject({ overflow: false, lines: route === "/" ? 2 : 1, clearsNext: true });
        // Up to 25vw: a title at the cap is as large as the hero allows; any other fills its column.
        expect(t.size, route).toBeLessThanOrEqual(width * 0.25 + 0.5);
        if (Math.abs(t.size - width * 0.25) > 0.5) expect(t.fill, route).toBeGreaterThan(0.85);
        expect(t.tracking, route).toBeCloseTo(-0.06, 3);
        expect(t.leading, route).toBeCloseTo(0.78, 2);
      }
    });
  }

  for (const width of [1440, 390]) {
    test(`keeps every nav link clickable above a poster title at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ["/", "/about/", "/guides/", "/guides/setup/"]) {
        await page.goto(route);
        await page.evaluate(() => document.fonts.ready);
        const covered = await page.locator(".site-nav a").evaluateAll(as => as.filter(a => a.checkVisibility()).flatMap(a => {
          const r = a.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return hit === a || a.contains(hit) ? [] : [`${a.textContent} → ${hit?.tagName}.${hit?.className}`];
        }));
        expect(covered, route).toEqual([]);
      }
    });
  }

  for (const [scheme, paper] of [["light", "rgb(237, 232, 223)"], ["dark", "rgb(11, 11, 12)"]] as const) {
    test(`follows the ${scheme} colour scheme, on the page and inside its live example`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      await settle(page);
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(paper);
      expect(await page.locator("figure.doc-example iframe").evaluate((f: HTMLIFrameElement) =>
        f.contentWindow!.getComputedStyle(f.contentDocument!.body).backgroundColor)).toBe(paper);
    });
  }

  for (const [route, tone] of [["/", "callout"], ["/guides/setup/", "warning callout"]] as const) {
    test(`keeps a ${tone}'s wash on the accent's hue in the dark scheme, not a purple-grey`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(route);
      await openChapters(page);
      await settle(page);
      const hues = await page.locator("figure.doc-example iframe").evaluate((f: HTMLIFrameElement) => {
        const w = f.contentWindow!, d = f.contentDocument!;
        const hue = (c: string) => { const m = /^oklch\(\S+ \S+ (\S+)\)$/.exec(c); return m ? parseFloat(m[1]) : NaN; };
        const probe = d.createElement("i");
        probe.style.color = "oklch(from var(--sk-accent) l c h)";
        d.body.append(probe);
        const accent = w.getComputedStyle(probe).color;
        probe.remove();
        const wash = w.getComputedStyle(d.querySelector(".callout")!).backgroundColor;
        return { accent, wash, accentHue: hue(accent), washHue: hue(wash) };
      });
      expect(Number.isNaN(hues.washHue), JSON.stringify(hues)).toBe(false);
      expect(Math.abs(hues.washHue - hues.accentHue), JSON.stringify(hues)).toBeLessThan(5);
    });
  }

  test("puts the footer straight after the main column, and at the bottom of a short page", async ({ page }) => {
    for (const route of ["/", "/about/", "/guides/", "/guides/setup/"]) {
      await page.goto(route);
      const gap = await page.evaluate(() => {
        const main = document.querySelector(".site-main")!.getBoundingClientRect(), footer = document.querySelector(".site-footer")!.getBoundingClientRect();
        const rowGap = parseFloat(getComputedStyle(document.querySelector(".site")!).rowGap);
        return { between: Math.round(footer.top - main.bottom - rowGap), atBottom: Math.abs(footer.bottom - Math.max(innerHeight, document.documentElement.scrollHeight)) < 1 };
      });
      expect(gap, route).toEqual({ between: 0, atBottom: true });
    }
  });

  test("puts the sections' rows edge to edge", async ({ page }) => {
    await page.goto("/");
    const rows = await page.locator(".site-rows .row").evaluateAll(rs => rs.map(r => {
      const b = r.getBoundingClientRect();
      return b.left === 0 && Math.abs(b.width - document.documentElement.clientWidth) < 1;
    }));
    expect(rows).toEqual([true, true]);
  });

  for (const route of ["/", "/guides/setup/"]) {
    test(`${route}: shows its live example as a specimen plate: the frame on a bone mat, the caption plate with the workbench link inside it`, async ({ page }) => {
      await page.goto(route);
      await openChapters(page);
      await settle(page);
      const plate = await page.locator("figure.doc-example").evaluate(fig => {
        const probe = document.createElement("i");
        probe.style.backgroundColor = "var(--sk-bone)";
        document.body.append(probe);
        const bone = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const f = fig.getBoundingClientRect(), frame = fig.querySelector("iframe")!.getBoundingClientRect();
        const caption = fig.querySelector("figcaption")!, c = caption.getBoundingClientRect(), link = caption.querySelector("a");
        return {
          mat: getComputedStyle(fig).backgroundColor === bone,
          matAround: Math.min(frame.left - f.left, f.right - frame.right, frame.top - f.top, f.bottom - c.bottom) >= 12,
          captionInPlate: c.top >= frame.bottom && c.left >= f.left && c.right <= f.right && c.bottom <= f.bottom,
          link: link?.getAttribute("href") ?? null,
          linkNames: link?.textContent ?? "",
          title: fig.querySelector("iframe")!.title,
        };
      });
      expect(plate).toMatchObject({ mat: true, matAround: true, captionInPlate: true });
      expect(plate.link).toMatch(/\/components\/callout(#warning)?$/);
      expect(plate.linkNames).toContain(plate.title);
    });
  }

  test("lays a film grain over the page that takes no clicks, and none on paper", async ({ page }) => {
    await page.goto("/");
    const grain = () => page.evaluate(() => {
      const cs = getComputedStyle(document.body, "::after");
      return { display: cs.display, position: cs.position, inset: [cs.top, cs.right, cs.bottom, cs.left].join(" "),
        opacity: cs.opacity, pointerEvents: cs.pointerEvents, image: cs.backgroundImage.includes("/assets/skin-experimental/images/grain.svg") };
    });
    expect(await grain()).toEqual({ display: "block", position: "fixed", inset: "0px 0px 0px 0px", opacity: "0.07", pointerEvents: "none", image: true });
    await page.emulateMedia({ media: "print" });
    expect((await grain()).display).toBe("none");
    expect((await page.request.get("/assets/skin-experimental/images/grain.svg")).status()).toBe(200);
  });

  for (const route of ["/about/", "/guides/", "/guides/setup/"]) {
    test(`${route}: cuts its hero title through an accent block with the skin's corner, blended by difference`, async ({ page }) => {
      await page.goto(route);
      await page.evaluate(() => document.fonts.ready);
      const hero = await page.locator(".hero").evaluate(h => {
        const block = getComputedStyle(h, "::before"), title = h.querySelector(".hero-title")!, t = getComputedStyle(title);
        const probe = document.createElement("i");
        probe.style.cssText = "color: var(--sk-accent); background: var(--sk-paper)";
        document.body.append(probe);
        const accent = getComputedStyle(probe).color, paper = getComputedStyle(probe).backgroundColor;
        probe.remove();
        // The block's box, from its insets within the hero; the title's text box.
        const hr = h.getBoundingClientRect(), range = document.createRange();
        range.selectNodeContents(title);
        const tr = range.getBoundingClientRect();
        const left = hr.left + parseFloat(block.left), top = hr.top + parseFloat(block.top);
        return {
          block: block.backgroundColor === accent,
          corners: [block.borderStartStartRadius, block.borderStartEndRadius, block.borderEndEndRadius].every(r => r === "0px") && parseFloat(block.borderEndStartRadius) > 40,
          blend: t.mixBlendMode, isolated: getComputedStyle(h).isolation, ground: getComputedStyle(h).backgroundColor === paper,
          crosses: tr.right > left && tr.bottom > top,
        };
      });
      expect(hero).toEqual({ block: true, corners: true, blend: "difference", isolated: "isolate", ground: true, crosses: true });
    });
  }

  for (const [route, index, layout, sections] of [["/about/", "02", "page", "0"], ["/guides/", "01", "page", "0"], ["/guides/setup/", "01.1", "article", "2"]] as const) {
    test(`${route}: shows its derived meta row under the hero: index ${index}, layout ${layout}, ${sections} sections`, async ({ page }) => {
      await page.goto(route);
      const meta = await page.locator(".hero-meta").evaluate(dl => [...dl.querySelectorAll("div")].map(d => [d.querySelector("dt")!.textContent, d.querySelector("dd")!.textContent]));
      expect(meta).toEqual([["Index", index], ["Layout", layout], ["Sections", sections]]);
      const label = await page.locator(".hero-meta").evaluate(el => [getComputedStyle(el).fontFamily.split(",")[0], getComputedStyle(el).textTransform]);
      expect(label).toEqual(['"IBM Plex Mono"', "uppercase"]);
    });
  }

  test("takes its brand colour from --sk-accent alone", async ({ page }) => {
    await page.goto("/");
    const read = () => page.evaluate(() => {
      // What the accent's text token resolves to now, read off a probe.
      const probe = document.createElement("i");
      probe.style.color = "var(--sk-accent-text)";
      document.body.append(probe);
      const accentText = getComputedStyle(probe).color;
      probe.remove();
      // The hero's block is the accent; the marquee's text sits on the accent.
      return { accentText, cover: getComputedStyle(document.querySelector(".hero")!, "::before").backgroundColor,
        onCover: getComputedStyle(document.querySelector(".marquee-track")!).color,
        current: getComputedStyle(document.querySelector('.site-header [aria-current="page"]')!).color };
    });
    const before = await read();
    await page.addStyleTag({ content: ":root { --sk-accent: rgb(0, 110, 70); }" });
    const after = await read();
    // The current page's label is the accent as text, which follows the accent.
    expect(after.current).toBe(after.accentText);
    expect(after.current).not.toBe(before.current);
    // The hero's block is the accent, and the text on the accent follows the accent's lightness.
    expect(after.cover).toBe("rgb(0, 110, 70)");
    expect(after.cover).not.toBe(before.cover);
    await page.addStyleTag({ content: ":root { --sk-accent: rgb(250, 220, 120); }" });
    const light = await read();
    expect(light.cover).toBe("rgb(250, 220, 120)");
    expect(light.onCover).not.toBe(after.onCover);
  });


  for (const [name, width, beside] of [["a wide row", 1440, true], ["a narrow row", 390, false]] as const) {
    test(`${name} sets a section's title, description and pages ${beside ? "side by side" : "one beneath the other"}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const row = page.locator(".row", { has: page.locator('.row-title[href="/guides/"]') });
      const box = await row.evaluate(r => {
        const b = (s: string) => r.querySelector(s)!.getBoundingClientRect();
        const t = b(".row-title"), d = b(".row-description"), p = b(".row-pages");
        return { side: d.left >= t.right && p.left >= d.right, stacked: d.top >= t.bottom - 1 && p.top >= d.bottom - 1 };
      });
      expect(beside ? box.side : box.stacked).toBe(true);
    });
  }

});

test.describe("a live example's variants", () => {
  test("with scripting, switch the frame in place: one button each, pressed for the one shown", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const plate = page.locator("figure.doc-example");
    const state = () => plate.evaluate(fig => ({
      buttons: [...fig.querySelectorAll(".doc-example-variants button")].map(b => [b.textContent, b.getAttribute("aria-pressed")]),
      links: fig.querySelectorAll(".doc-example-variants a").length,
      src: fig.querySelector("iframe")!.getAttribute("src"),
      id: fig.querySelector(".doc-example-id")!.textContent,
      workbench: fig.querySelector<HTMLAnchorElement>("figcaption a")!.href,
    }));
    const before = await state();
    expect(before).toMatchObject({ buttons: [["default", "true"], ["warning", "false"]], links: 0, src: "/preview/components/callout", id: "components/callout" });
    const url = page.url();
    await plate.getByRole("button", { name: "warning" }).click();
    const after = await state();
    expect(after).toMatchObject({ buttons: [["default", "false"], ["warning", "true"]], src: "/preview/components/callout~warning", id: "components/callout~warning" });
    expect(after.workbench).toBe(`${before.workbench}#warning`);
    expect(page.url()).toBe(url);
    await expect(page.frameLocator("figure.doc-example iframe").locator(".callout-title")).toHaveText("Careful");
  });

  test("label the plate: (LIVE) and the component's id, in the mono", async ({ page }) => {
    await page.goto("/");
    expect(await page.locator(".doc-example-id").evaluate(el => [getComputedStyle(el, "::before").content, el.textContent])).toEqual(['"(LIVE) "', "components/callout"]);
  });
});

test.describe("the footer", () => {
  for (const [route, next, title] of [["/", "/guides/", "Guides"], ["/guides/", "/guides/setup/", "Setup"], ["/guides/setup/", "/about/", "About"], ["/about/", "/", "Storefront bench"]] as const) {
    test(`${route}: leads to the next chapter, ${title}, the last page wrapping to the first`, async ({ page }) => {
      await page.goto(route);
      const link = page.locator(".site-footer .next-chapter");
      await expect(link).toHaveAttribute("href", next);
      await expect(link.locator(".next-label")).toHaveText("Next chapter");
      await expect(link.locator(".next-title")).toHaveText(title);
    });
  }

  test("sets the next chapter as a giant outlined title, filled with the accent on hover", async ({ page }) => {
    await page.goto("/about/");
    await page.evaluate(() => document.fonts.ready);
    const title = page.locator(".next-title");
    const look = () => title.evaluate(t => {
      const cs = getComputedStyle(t);
      const probe = document.createElement("i");
      probe.style.color = "var(--sk-accent)";
      document.body.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return { family: cs.fontFamily.split(",")[0], size: parseFloat(cs.fontSize) / innerWidth, stroke: parseFloat(cs.webkitTextStrokeWidth) > 0,
        fill: cs.color === "rgba(0, 0, 0, 0)" ? "none" : cs.color === accent ? "accent" : cs.color };
    });
    expect(await look()).toMatchObject({ family: '"Montserrat Black"', stroke: true, fill: "none" });
    expect((await look()).size).toBeCloseTo(0.15, 2);
    await page.locator(".next-chapter").hover();
    await expect.poll(async () => (await look()).fill).toBe("accent");
  });
});

test.describe("chapters", () => {
  test("turns each section into a full-width row, numbered, that inverts on hover", async ({ page }) => {
    await page.goto("/guides/setup/");
    const rows = await page.locator("details.chapter").evaluateAll(ds => ds.map(d => {
      const r = d.getBoundingClientRect();
      return { full: r.left === 0 && Math.abs(r.width - document.documentElement.clientWidth) < 1, title: d.querySelector("summary h2")!.textContent };
    }));
    expect(rows).toEqual([{ full: true, title: "(01) Pages" }, { full: true, title: "(02) Layouts" }]);
    const summary = page.locator("details.chapter").nth(1).locator("summary");
    const colours = () => summary.evaluate(s => {
      const probe = document.createElement("i");
      probe.style.cssText = "color: var(--sk-ink); background: var(--sk-paper)";
      document.body.append(probe);
      const ink = getComputedStyle(probe).color, paper = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const cs = getComputedStyle(s);
      return { inverted: cs.backgroundColor === ink && cs.color === paper };
    });
    expect(await colours()).toEqual({ inverted: false });
    await summary.hover();
    expect(await colours()).toEqual({ inverted: true });
  });

  for (const [route, selector] of [["/guides/setup/", ".article-lede"], ["/about/", ".page-description"]] as const) {
    test(`${route}: sets its lede as a large serif statement, two-thirds to the right`, async ({ page }) => {
      await page.goto(route);
      const lede = await page.locator(selector).evaluate(el => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const text = r.getBoundingClientRect(), box = el.getBoundingClientRect(), cs = getComputedStyle(el);
        return { offset: (text.left - box.left) / box.width, family: cs.fontFamily.split(",")[0], size: parseFloat(cs.fontSize) };
      });
      expect(lede.offset).toBeCloseTo(1 / 3, 2);
      expect(lede.family).toBe('"Source Serif 4"');
      expect(lede.size).toBeGreaterThan(28);
    });
  }
});

test.describe("the marquee", () => {
  /** The marquee as a reader and a screen reader meet it. */
  const marquee = (page: Page) => page.locator(".marquee").evaluate(m => {
    const band = getComputedStyle(m.querySelector(".marquee-band")!), track = getComputedStyle(m.querySelector(".marquee-track")!);
    const run = getComputedStyle(m.querySelector(".marquee-run")!);
    const probe = document.createElement("i");
    probe.style.color = "var(--sk-accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const exposed = [...m.querySelectorAll(".marquee-item")].filter(i => !i.closest("[aria-hidden='true']")).map(i => i.textContent);
    return {
      accent: track.backgroundColor === accent, rotate: band.rotate,
      font: [run.fontFamily.split(",")[0], run.fontStyle, run.fontWeight],
      animation: [track.animationName, track.animationIterationCount, track.animationPlayState],
      exposed,
      copiesHidden: [...m.querySelectorAll(".marquee-run")].slice(1).every(r => r.getAttribute("aria-hidden") === "true"),
      separatorsHidden: [...m.querySelectorAll(".marquee-sep")].every(s => s.getAttribute("aria-hidden") === "true"),
      shownRuns: [...m.querySelectorAll(".marquee-run")].filter(r => getComputedStyle(r).display !== "none").length,
    };
  });

  test("scrolls a page's section headings on a tilted accent band, read out once", async ({ page }) => {
    await page.goto("/guides/setup/");
    expect(await marquee(page)).toEqual({
      accent: true, rotate: "-2deg", font: ["Montserrat", "italic", "900"],
      animation: ["sk-marquee", "infinite", "running"],
      exposed: ["Pages", "Layouts"], copiesHidden: true, separatorsHidden: true, shownRuns: 4,
    });
  });

  test("has no band on a page without sections", async ({ page }) => {
    for (const route of ["/about/", "/guides/"]) {
      await page.goto(route);
      await expect(page.locator(".marquee"), route).toHaveCount(0);
    }
  });

  test("stands still for a reader who prefers less motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/guides/setup/");
    expect((await marquee(page)).animation[0]).toBe("none");
  });

  test("stands still on paper, its sections once", async ({ page }) => {
    await page.emulateMedia({ media: "print" });
    await page.goto("/guides/setup/");
    const printed = await marquee(page);
    expect([printed.animation[0], printed.shownRuns]).toEqual(["none", 1]);
  });
});

test.describe("motion and print", () => {
  for (const [motion, transitions] of [["no-preference", true], ["reduce", false]] as const) {
    test(`moving to another page ${transitions ? "runs" : "skips"} a view transition when the reader's motion preference is ${motion}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: motion });
      await page.addInitScript(() => {
        addEventListener("pagereveal", e => { (window as unknown as { revealed: boolean | null }).revealed = !!(e as Event & { viewTransition: unknown }).viewTransition; });
      });
      await page.goto("/");
      await page.locator('.site-nav a[href="/about/"]').click();
      await expect(page.locator("h1")).toHaveText("About");
      await expect.poll(() => page.evaluate(() => (window as unknown as { revealed?: boolean }).revealed)).toBe(transitions);
    });
  }

  test("prints its colour fields as ink on paper, since printers drop background colours", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark", media: "print" });
    for (const [route, selector] of [["/", ".hero"], ["/about/", ".hero"], ["/guides/setup/", ".hero"], ["/", ".site-footer"], ["/", "figure.doc-example"]] as const) {
      await page.goto(route);
      const printed = await page.locator(selector).evaluate(el => {
        const cs = getComputedStyle(el);
        return { background: cs.backgroundColor, color: cs.color, body: getComputedStyle(document.body).color };
      });
      expect(printed, `${route} ${selector}`).toEqual({ background: "rgba(0, 0, 0, 0)", color: printed.body, body: printed.body });
    }
    // The hero's title prints as plain ink, unblended, without the accent block it would blend against.
    await page.goto("/guides/setup/");
    expect(await page.locator(".hero").evaluate(h => {
      const t = getComputedStyle(h.querySelector(".hero-title")!);
      return [t.color === getComputedStyle(document.body).color, t.mixBlendMode, getComputedStyle(h, "::before").display];
    })).toEqual([true, "normal", "none"]);
  });

  test("prints every chapter, the hero at a sheet's size, and the footer kept with what comes before it", async ({ page }) => {
    await page.emulateMedia({ media: "print" });
    await page.goto("/guides/setup/");
    await page.evaluate(() => document.fonts.ready);
    const printed = await page.evaluate(() => {
      const cs = (s: string) => getComputedStyle(document.querySelector(s)!);
      const closed = document.querySelector("details.chapter:not([open]) .chapter-body")!;
      return {
        closedChapterShows: closed.checkVisibility(),
        hero: parseFloat(cs(".hero-title").fontSize),
        flow: [cs(".site").display, cs(".site-main").display, cs(".site-footer").display],
        keep: [cs(".site-main").breakAfter, cs(".site-footer").breakBefore, cs(".site-footer").breakInside],
        hidden: [cs(".next-chapter").display, cs(".doc-example-variants").display],
      };
    });
    expect(printed).toEqual({
      closedChapterShows: true, hero: 72,
      flow: ["block", "block", "block"], keep: ["avoid", "avoid", "avoid"], hidden: ["none", "none"],
    });
  });

  test("prints in the light scheme, without the site navigation or cards, with other sites' addresses written out", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark", media: "print" });
    await page.goto("/");
    await settle(page);
    const printed = await page.evaluate(() => {
      const link = document.querySelector<HTMLAnchorElement>("figure.doc-example figcaption a")!;
      return {
        paper: getComputedStyle(document.body).backgroundColor,
        nav: getComputedStyle(document.querySelector(".site-nav")!).display,
        cards: getComputedStyle(document.querySelector(".site-rows")!).display,
        after: getComputedStyle(link, "::after").content,
        href: link.href,
      };
    });
    expect(printed.paper).toBe("rgb(237, 232, 223)");
    expect(printed.nav).toBe("none");
    expect(printed.cards).toBe("none");
    expect(printed.after).toBe(`" (${printed.href})"`);
  });
});

test.describe("accessibility (axe)", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const route of ROUTES) {
      test(`${route} in ${scheme}: no violations, live examples included`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(route);
        await openChapters(page);
        await settle(page);
        const { violations } = await new AxeBuilder({ page }).analyze();
        const summary = violations.map(v => `[${v.impact}] ${v.id}: ${v.nodes.map(n => n.target.join(" ")).join(", ")}`).join("\n");
        expect(violations, `axe violations:\n${summary}`).toEqual([]);
      });
    }
  }
});
