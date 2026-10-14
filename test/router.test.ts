import { describe, expect, it } from "vitest";
import { buildServiceIndex, NuGetRouter } from "../src/nuget/router";
import type { Env } from "../src/nuget/types";

describe("buildServiceIndex", () => {
  it("包含必要资源且使用同一 origin", () => {
    const index = buildServiceIndex("https://feed.example.com");
    const resources = index.resources as Array<{
      "@id": string;
      "@type": string;
    }>;
    const types = resources.map((r) => r["@type"]);
    expect(types).toContain("PackageBaseAddress/3.0.0");
    expect(types).toContain("PackagePublish/2.0.0");
    expect(types).toContain("SearchQueryService");
    for (const r of resources) {
      expect(r["@id"].startsWith("https://feed.example.com/")).toBe(true);
    }
  });
});

describe("NuGetRouter 鉴权拒绝", () => {
  it("错误 ApiKey 推送返回 401", async () => {
    const env = {
      NUGET_API_KEY: "correct",
      DB: {} as D1Database,
      PACKAGES: {} as R2Bucket,
      ASSETS: {} as Fetcher,
    } satisfies Env;

    const router = new NuGetRouter();
    const req = new Request("https://feed.example.com/v3/package", {
      method: "PUT",
      headers: { "X-NuGet-ApiKey": "wrong" },
      body: new Uint8Array([1, 2, 3]),
    });
    const res = await router.handle(req, env);
    expect(res.status).toBe(401);
  });

  it("Service Index 可匿名访问", async () => {
    const env = {
      NUGET_API_KEY: "correct",
      DB: {} as D1Database,
      PACKAGES: {} as R2Bucket,
      ASSETS: {} as Fetcher,
    } satisfies Env;

    const router = new NuGetRouter();
    const req = new Request("https://feed.example.com/v3/index.json");
    const res = await router.handle(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string };
    expect(body.version).toBe("3.0.0");
  });
});
