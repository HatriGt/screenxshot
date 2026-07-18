import { test, expect } from "vitest";
import { joinSavePath } from "./savePath";

test("joins a posix folder and filename", () => {
  expect(joinSavePath("/Users/ak/shots", "a.png")).toBe("/Users/ak/shots/a.png");
});

test("trims a trailing slash", () => {
  expect(joinSavePath("/Users/ak/shots/", "a.png")).toBe("/Users/ak/shots/a.png");
});

test("uses backslash separator on windows paths", () => {
  expect(joinSavePath("C:\\Users\\ak\\shots", "a.png")).toBe("C:\\Users\\ak\\shots\\a.png");
});

test("trims a trailing backslash", () => {
  expect(joinSavePath("C:\\Users\\ak\\shots\\", "a.png")).toBe("C:\\Users\\ak\\shots\\a.png");
});
