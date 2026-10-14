import { describe, expect, it } from "vitest";
import {
  matchesNuGetSearch,
  parseNuGetSearchQuery,
  type SearchablePackage,
} from "../src/nuget/searchQuery";
import { isPrerelease, isSemVer2Only } from "../src/nuget/semver";

const sample: SearchablePackage = {
  id: "Corel.Plugin.Demo",
  version: "1.2.0",
  title: "Demo Plugin",
  description: "A sample plugin for CorelDRAW",
  summary: "sample",
  authors: ["Alice", "Bob"],
  tags: ["plugin", "CorelDraw", "extension"],
  owners: [],
};

describe("parseNuGetSearchQuery", () => {
  it("解析字段过滤器与全文词", () => {
    const clauses = parseNuGetSearchQuery(
      "demo id:Corel tags:plugin PackageId:Corel.Plugin.Demo",
    );
    expect(clauses).toEqual([
      { kind: "text", term: "demo" },
      { kind: "field", field: "id", term: "Corel" },
      { kind: "field", field: "tags", term: "plugin" },
      { kind: "field", field: "packageid", term: "Corel.Plugin.Demo" },
    ]);
  });

  it("忽略未知属性", () => {
    const clauses = parseNuGetSearchQuery("invalid:jquery ui");
    expect(clauses).toEqual([{ kind: "text", term: "ui" }]);
  });
});

describe("matchesNuGetSearch", () => {
  it("tags: 与 id: 子串 / packageid 精确", () => {
    expect(
      matchesNuGetSearch(sample, parseNuGetSearchQuery("tags:plugin")),
    ).toBe(true);
    expect(
      matchesNuGetSearch(sample, parseNuGetSearchQuery("id:Plugin")),
    ).toBe(true);
    expect(
      matchesNuGetSearch(
        sample,
        parseNuGetSearchQuery("packageid:Corel.Plugin.Demo"),
      ),
    ).toBe(true);
    expect(
      matchesNuGetSearch(sample, parseNuGetSearchQuery("packageid:Corel")),
    ).toBe(false);
  });

  it("多条件 AND", () => {
    expect(
      matchesNuGetSearch(
        sample,
        parseNuGetSearchQuery("tags:plugin tags:missing"),
      ),
    ).toBe(false);
    expect(
      matchesNuGetSearch(
        sample,
        parseNuGetSearchQuery("tags:plugin author:Alice"),
      ),
    ).toBe(true);
  });
});

describe("semver search helpers", () => {
  it("识别预发布与 SemVer2-only", () => {
    expect(isPrerelease("1.0.0-beta")).toBe(true);
    expect(isPrerelease("1.0.0")).toBe(false);
    expect(isSemVer2Only("1.0.0-alpha.1")).toBe(true);
    expect(isSemVer2Only("1.0.0+build")).toBe(true);
    expect(isSemVer2Only("1.0.0-beta")).toBe(false);
  });
});
