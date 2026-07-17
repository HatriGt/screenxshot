import { test } from "node:test";
import assert from "node:assert/strict";
import { getEntitlements, isPro } from "./entitlements.js";

test("getEntitlements returns the pro tier by default (free app, seam only)", () => {
  assert.equal(getEntitlements().tier, "pro");
});

test("isPro is true while there is no paywall", () => {
  assert.equal(isPro(), true);
});
