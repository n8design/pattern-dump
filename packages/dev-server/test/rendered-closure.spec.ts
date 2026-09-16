// Components included at RENDER time (by a helper, e.g. hTWOo's dynamicPartial) are invisible to the
// template-based closure; their CSS is linked from the classes in the rendered markup instead.

import { describe, expect, it } from "vitest";
import { withRenderedClassOwners } from "../src/css-closure.js";

const owners = new Map<string, string>([
  ["hoo-label", "atoms/input/label"],
  ["hoo-fieldset", "molecules/forms/fieldset"],
  ["hoo-reset", "__base__"],
  ["hoo-button", "atoms/button"],
]);

describe("withRenderedClassOwners", () => {
  it("adds the owner of a rendered class the static closure missed, before the component itself", () => {
    const html = '<fieldset class="hoo-fieldset"><label class="hoo-label hoo-reset">Name</label></fieldset>';
    expect(withRenderedClassOwners(["molecules/forms/fieldset"], html, owners))
      .toEqual(["atoms/input/label", "molecules/forms/fieldset"]);
  });

  it("ignores base-layer and unknown classes, and owners already in the closure", () => {
    const html = '<div class="hoo-reset unknown hoo-button"></div>';
    expect(withRenderedClassOwners(["atoms/button", "molecules/x"], html, owners)).toEqual(["atoms/button", "molecules/x"]);
  });

  it("is deterministic when several owners are added", () => {
    const html = '<p class="hoo-label"></p><button class="hoo-button"></button>';
    expect(withRenderedClassOwners(["molecules/x"], html, owners)).toEqual(["atoms/button", "atoms/input/label", "molecules/x"]);
  });
});
