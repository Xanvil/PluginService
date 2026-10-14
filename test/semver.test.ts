import { describe, expect, it } from "vitest";
import { compareNuGetVersions, pickLatestVersion } from "../src/nuget/semver";

describe("compareNuGetVersions", () => {
  it("比较主版本号", () => {
    expect(compareNuGetVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareNuGetVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("预发布低于正式版", () => {
    expect(compareNuGetVersions("1.0.0-beta", "1.0.0")).toBeLessThan(0);
    expect(compareNuGetVersions("1.0.0", "1.0.0-beta")).toBeGreaterThan(0);
  });

  it("挑选最高版本", () => {
    expect(
      pickLatestVersion(["1.0.0-beta", "1.0.0", "0.9.0", "1.0.1"]),
    ).toBe("1.0.1");
  });
});
