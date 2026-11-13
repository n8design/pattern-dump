// Two checks on a site page that need no axe: exactly one main landmark (a <main>, or an element with role="main")
// and exactly one <h1>. axe's own rules for them (landmark-one-main, page-has-heading-one) can't decide in jsdom, so
// `pd build` checks these instead; `pd build --browser` runs axe's as well. Read as tags (html-tags.ts): a code
// example's text is not an element.
import { attributesOf, startTags } from "./html-tags.js";

/** What is wrong with the page's main landmark and its <h1>, one line each; empty when the page is sound. */
export function checkPageBasics(html: string): string[] {
  let main = 0, h1 = 0;
  for (const tag of startTags(html)) {
    const name = tag.name.toLowerCase();
    if (name === "main" || attributesOf(tag).some(a => a.name === "role" && a.value?.trim() === "main")) main++;
    if (name === "h1") h1++;
  }
  const problems: string[] = [];
  if (main === 0) problems.push("the page has no <main>: the page's own content goes in one, so assistive technology can go straight to it");
  else if (main > 1) problems.push(`the page has ${main} main landmarks (<main> or role="main"): it has exactly one, holding the page's own content`);
  if (h1 === 0) problems.push("the page has no <h1>: one heading names the page");
  else if (h1 > 1) problems.push(`the page has ${h1} <h1> headings: one names the page, the others are <h2> or lower`);
  return problems;
}
