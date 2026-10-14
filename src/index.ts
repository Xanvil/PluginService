/**
 * PluginService — Cloudflare Workers 入口。
 * `/v3/*` 走 NuGet V3 API；其余走静态资源（商店 / 上传页）。
 *
 * 注意：不要把 `/` 再改写成 `/index.html` 再交给 ASSETS——
 * Assets 默认 html_handling 会把 `/index.html` 307 回 `/`，造成重定向死循环。
 */

import { NuGetRouter } from "./nuget/router";
import type { Env } from "./nuget/types";

const router = new NuGetRouter();

export default {
  /**
   * Worker fetch 入口：
   * - `/v3/*`：NuGet API
   * - `/packages/*`：商店 SPA（直接返回 index.html 正文，禁止跟随 307）
   * - `/upload`：上传页（同上，映射 upload.html）
   * - 其它：原样交给 ASSETS（`/` 由 Assets 提供 index）
   */
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/v3" || path.startsWith("/v3/")) {
      const response = await router.handle(request, env);
      return withCors(response);
    }

    // 商店首页 / 详情：直接返回 index.html 正文（html_handling=none 时 `/` 不会自动映射）
    if (path === "/" || path.startsWith("/packages/")) {
      return serveStaticFile(env, url.origin, "/index.html");
    }

    // /upload → upload.html
    if (path === "/upload" || path === "/upload/") {
      return serveStaticFile(env, url.origin, "/upload.html");
    }

    // css、js 等静态文件
    return env.ASSETS.fetch(request);
  },
};

/**
 * 拉取指定静态文件，使用 redirect:manual，避免 ASSETS 307 被自动跟随回 Worker。
 */
async function serveStaticFile(
  env: Env,
  origin: string,
  assetPath: string,
): Promise<Response> {
  const assetUrl = new URL(assetPath, origin);
  const res = await env.ASSETS.fetch(
    new Request(assetUrl.toString(), {
      method: "GET",
      redirect: "manual",
    }),
  );

  // 若仍收到重定向，直接读目标正文一次（不再进入 Worker 路由）
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("Location");
    if (loc) {
      const next = new URL(loc, origin);
      const again = await env.ASSETS.fetch(
        new Request(next.toString(), {
          method: "GET",
          redirect: "manual",
        }),
      );
      if (again.status >= 300 && again.status < 400) {
        // 最后手段：对 `/` 取 Assets（通常能直接出 index）
        return env.ASSETS.fetch(new Request(new URL("/", origin)));
      }
      return again;
    }
  }

  return res;
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders())) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, X-NuGet-ApiKey, Authorization",
  };
}

export type { Env };
