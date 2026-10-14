import { describe, expect, it } from "vitest";
import { assertPushAuthorized, timingSafeEqualString } from "../src/nuget/auth";
import type { Env } from "../src/nuget/types";

describe("timingSafeEqualString", () => {
  it("匹配相同字符串", () => {
    expect(timingSafeEqualString("abc", "abc")).toBe(true);
  });

  it("拒绝不同字符串", () => {
    expect(timingSafeEqualString("abc", "abd")).toBe(false);
    expect(timingSafeEqualString("abc", "ab")).toBe(false);
  });
});

describe("assertPushAuthorized", () => {
  const env = { NUGET_API_KEY: "secret-key" } as Env;

  it("正确 ApiKey 通过", () => {
    const req = new Request("https://example.com/v3/package", {
      method: "PUT",
      headers: { "X-NuGet-ApiKey": "secret-key" },
    });
    expect(() => assertPushAuthorized(req, env)).not.toThrow();
  });

  it("错误 ApiKey 返回 401", () => {
    const req = new Request("https://example.com/v3/package", {
      method: "PUT",
      headers: { "X-NuGet-ApiKey": "wrong" },
    });
    try {
      assertPushAuthorized(req, env);
      expect.fail("should throw");
    } catch (e) {
      expect((e as { status: number }).status).toBe(401);
    }
  });

  it("缺少 ApiKey 返回 401", () => {
    const req = new Request("https://example.com/v3/package", {
      method: "PUT",
    });
    try {
      assertPushAuthorized(req, env);
      expect.fail("should throw");
    } catch (e) {
      expect((e as { status: number }).status).toBe(401);
    }
  });
});
