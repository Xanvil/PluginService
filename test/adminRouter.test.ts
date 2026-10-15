import { describe, expect, it } from "vitest";
import { AdminRouter } from "../src/admin/router";
import type { Env } from "../src/nuget/types";

describe("AdminRouter 鉴权", () => {
  it("缺少 ApiKey 返回 401", async () => {
    const env = {
      NUGET_API_KEY: "secret-key",
    } as Env;
    const router = new AdminRouter();
    const res = await router.handle(
      new Request("https://example.com/admin/api/packages"),
      env,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/api key/i);
  });

  it("错误 ApiKey 返回 401", async () => {
    const env = {
      NUGET_API_KEY: "secret-key",
    } as Env;
    const router = new AdminRouter();
    const res = await router.handle(
      new Request("https://example.com/admin/api/packages", {
        headers: { "X-NuGet-ApiKey": "wrong" },
      }),
      env,
    );
    expect(res.status).toBe(401);
  });
});
