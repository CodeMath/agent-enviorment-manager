import { describe, expect, test } from "bun:test";
import {
  compareVersions,
  currentVersion,
  normalizeTag,
} from "../src/core/version.js";

describe("version", () => {
  test("currentVersion reads package.json", () => {
    expect(currentVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("normalizeTag strips v prefix", () => {
    expect(normalizeTag("v0.1.0")).toBe("0.1.0");
    expect(normalizeTag("V1.2.3")).toBe("1.2.3");
    expect(normalizeTag("0.1.0")).toBe("0.1.0");
  });

  test("compareVersions orders numerically", () => {
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("0.1.0", "v0.1.0")).toBe(0);
    expect(compareVersions("0.1.0", "0.1.1")).toBeLessThan(0);
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0); // not lexicographic
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
  });

  test("prerelease sorts below release", () => {
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
  });
});
