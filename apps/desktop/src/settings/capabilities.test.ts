import { test, expect } from "vitest";
import { networkPermissions, permissionIdentifiers } from "./capabilities";

test("keeps bare string identifiers", () => {
  expect(permissionIdentifiers(["core:default", "dialog:allow-open"])).toEqual([
    "core:default",
    "dialog:allow-open",
  ]);
});

test("unwraps scoped object entries to their identifier", () => {
  expect(
    permissionIdentifiers([
      "core:default",
      { identifier: "opener:allow-open-url", allow: [{ url: "https://*" }] },
    ]),
  ).toEqual(["core:default", "opener:allow-open-url"]);
});

test("skips objects with no string identifier", () => {
  expect(permissionIdentifiers([{ allow: [] }, "store:default"])).toEqual([
    "store:default",
  ]);
});

test("flags http/network identifiers", () => {
  expect(
    networkPermissions(["core:default", "http:default", "dialog:allow-open"]),
  ).toEqual(["http:default"]);
});

test("reports no network for a purely local capability set", () => {
  expect(
    networkPermissions(["core:default", "clipboard-manager:allow-write-image"]),
  ).toEqual([]);
});
