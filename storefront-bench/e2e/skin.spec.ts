// The skin as a browser paints it — from pd dev, and from the built root on a static host: its fonts,
// its colour schemes, its one brand token, its cards, and no accessibility violations in light or dark.
import { expect, test, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

const ROUTES = ["/", "/about/", "/guides/", "/guides/setup/"];

/** Wait until every live example's frame has been fitted and every font face in use has loaded. */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLIFrameElement>("figure.doc-example iframe")]
    .every(f => f.style.height !== "" && f.style.height !== "1px"));
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
    // Every face this page uses: the mono's two weights for its labels. Nothing on it is set in italic.
    expect(fonts.loaded).toEqual(["IBM Plex Mono normal", "IBM Plex Mono normal", "Montserrat normal", "Source Serif 4 normal"]);
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
    await settle(page);
    const label = (el: Element) => {
      const cs = getComputedStyle(el);
      return [cs.fontFamily.split(",")[0], cs.textTransform, parseFloat(cs.letterSpacing) / parseFloat(cs.fontSize) > 0.15];
    };
    const mono = ['"IBM Plex Mono"', "uppercase", true];
    expect(await page.locator(".site-tagline").evaluate(label)).toEqual(mono);
    expect(await page.locator(".site-footer").evaluate(label)).toEqual(mono);
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
    test(`sets titles at poster scale at ${width}px: the home title at 15vw, a page title filling its column`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const title = () => page.locator("h1").evaluate(h => {
        const range = document.createRange();
        range.selectNodeContents(h);
        const text = range.getBoundingClientRect(), cs = getComputedStyle(h), size = parseFloat(cs.fontSize);
        const next = h.nextElementSibling?.getBoundingClientRect();
        return { size, fill: text.width / h.getBoundingClientRect().width, overflow: h.scrollWidth > h.clientWidth + 1,
          clearsNext: !next || text.bottom <= next.top + 1,
          lines: Math.round(text.height / parseFloat(cs.lineHeight)),
          tracking: parseFloat(cs.letterSpacing) / size, leading: parseFloat(cs.lineHeight) / size };
      });
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      const home = await title();
      expect(home.size).toBeCloseTo(width * 0.15, 0);
      expect(home.overflow).toBe(false);
      for (const route of ["/about/", "/guides/", "/guides/setup/"]) {
        await page.goto(route);
        await page.evaluate(() => document.fonts.ready);
        const t = await title();
        // Solid leading, but the descenders still clear what follows the title.
        expect(t, route).toMatchObject({ overflow: false, lines: 1, clearsNext: true });
        expect(t.fill, route).toBeGreaterThan(0.85);
        expect(t.tracking, route).toBeLessThanOrEqual(-0.03);
        expect(t.leading, route).toBeLessThanOrEqual(0.9);
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

  for (const [scheme, paper] of [["light", "oklch(0.985 0.006 85)"], ["dark", "oklch(0.18 0.015 260)"]] as const) {
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

  test("puts each section on a field of the illustration's palette, edge to edge, and each card on a field of its own", async ({ page }) => {
    /** Each element's background next to the token it should be, both resolved on the page; and whether it spans the viewport. */
    const field = (selector: string, token: string) => page.locator(selector).first().evaluate((el, t) => {
      const probe = document.createElement("i");
      probe.style.backgroundColor = `var(${t})`;
      document.body.append(probe);
      const want = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const r = el.getBoundingClientRect();
      return { got: getComputedStyle(el).backgroundColor, want, edgeToEdge: r.left === 0 && Math.abs(r.width - document.documentElement.clientWidth) < 1 };
    }, token);
    const expectField = async (selector: string, token: string, edgeToEdge = true) => {
      const f = await field(selector, token);
      expect(f.got, `${selector} on ${token}`).toBe(f.want);
      if (edgeToEdge) expect(f.edgeToEdge, `${selector} edge to edge`).toBe(true);
    };
    await page.goto("/");
    await expectField(".home-cover", "--sk-accent");
    await expectField(".site-footer", "--sk-deep");
    await expectField(".card:nth-child(1)", "--sk-accent", false);
    await expectField(".card:nth-child(2)", "--sk-ochre", false);
    await page.goto("/about/");
    await expectField(".page-header", "--sk-ochre");
    await page.goto("/guides/setup/");
    await expectField(".article-header", "--sk-slate");
  });

  test("takes its brand colour from --sk-accent alone", async ({ page }) => {
    await page.goto("/");
    const read = () => page.evaluate(() => ({
      mark: getComputedStyle(document.querySelector(".site-title")!, "::before").backgroundColor,
      cover: getComputedStyle(document.querySelector(".home-cover")!).backgroundColor,
      onCover: getComputedStyle(document.querySelector(".home-cover")!).color,
      current: getComputedStyle(document.querySelector('.site-nav a[aria-current="page"]')!).textDecorationColor,
    }));
    const before = await read();
    await page.addStyleTag({ content: ":root { --sk-accent: rgb(0, 110, 70); }" });
    const after = await read();
    expect(after.mark).toBe("rgb(0, 110, 70)");
    expect(after.current).toBe("rgb(0, 110, 70)");
    // The cover is the accent's field, and the text on it follows the accent's lightness.
    expect(after.cover).toBe("rgb(0, 110, 70)");
    expect(after.cover).not.toBe(before.cover);
    await page.addStyleTag({ content: ":root { --sk-accent: rgb(250, 220, 120); }" });
    const light = await read();
    expect(light.cover).toBe("rgb(250, 220, 120)");
    expect(light.onCover).not.toBe(after.onCover);
  });

  for (const [name, width, beside] of [["a wide card", 1440, true], ["a narrow card", 390, false]] as const) {
    test(`${name} sets a folder's pages ${beside ? "beside" : "beneath"} its title`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const card = page.locator(".card", { has: page.locator('.card-title[href="/guides/"]') });
      const box = await card.evaluate(c => {
        const body = c.querySelector(".card-body")!, cs = getComputedStyle(body);
        const t = c.querySelector(".card-title")!.getBoundingClientRect(), p = c.querySelector(".card-pages")!.getBoundingClientRect();
        const content = Math.max(t.bottom, p.bottom) - Math.min(t.top, p.top);
        return { titleTop: t.top, titleRight: t.right, titleBottom: t.bottom, pagesLeft: p.left, pagesTop: p.top, pagesBottom: p.bottom,
          slack: body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - content };
      });
      if (beside) {
        expect(box.pagesLeft).toBeGreaterThan(box.titleRight);
        // Low beside the title: the list's middle in the title's lower half, not up at the card's top.
        expect((box.pagesTop + box.pagesBottom) / 2).toBeGreaterThan((box.titleTop + box.titleBottom) / 2);
        expect(box.pagesBottom).toBeLessThanOrEqual(box.titleBottom + 2);
      } else {
        expect(box.pagesTop).toBeGreaterThanOrEqual(box.titleBottom);
      }
      // No empty space: the card is as tall as what it holds.
      expect(box.slack).toBeLessThan(1);
    });
  }
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

  test("prints in the light scheme, without the site navigation or cards, with other sites' addresses written out", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark", media: "print" });
    await page.goto("/");
    await settle(page);
    const printed = await page.evaluate(() => {
      const link = document.querySelector<HTMLAnchorElement>("figure.doc-example figcaption a")!;
      return {
        paper: getComputedStyle(document.body).backgroundColor,
        nav: getComputedStyle(document.querySelector(".site-nav")!).display,
        cards: getComputedStyle(document.querySelector(".site-cards")!).display,
        after: getComputedStyle(link, "::after").content,
        href: link.href,
      };
    });
    expect(printed.paper).toBe("oklch(0.985 0.006 85)");
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
        await settle(page);
        const { violations } = await new AxeBuilder({ page }).analyze();
        const summary = violations.map(v => `[${v.impact}] ${v.id}: ${v.nodes.map(n => n.target.join(" ")).join(", ")}`).join("\n");
        expect(violations, `axe violations:\n${summary}`).toEqual([]);
      });
    }
  }
});
