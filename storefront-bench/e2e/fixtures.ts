// The storefront specs' `test`: Playwright's, with one automatic fixture. Every spec runs against one
// pd dev (playwright.config.ts), so a change a spec makes, its cleanup included, reloads the pages of
// whatever runs next. Before each test against pd dev, this asks the server to settle (POST
// /_pd/__test/settle, served with PD_TEST_HOOKS=1; watch.ts settle): it answers once every change made so
// far is handled and its reload messages are sent, so a test opens its pages after them, never during.
// Against the built root (storefront-static) there is no watcher, and nothing to wait for.
import { test as base, expect } from "@playwright/test";
import { isDev } from "./helpers.js";

export const test = base.extend<{ settled: void }>({
  settled: [async ({ request }, use, info) => {
    if (isDev(info)) {
      const res = await request.post("/_pd/__test/settle");
      if (res.status() !== 204) throw new Error(`settle answered ${res.status()}: ${await res.text()}`);
    }
    await use();
  }, { auto: true }],
});
export { expect };
