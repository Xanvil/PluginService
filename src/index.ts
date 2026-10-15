/**
 * PluginService — Cloudflare Workers 入口。
 * `/v3/*` 走 NuGet V3 API；`/admin/api/*` 走管理 API；其余走静态资源。
 *
 * 注意：不要把 `/` 再改写成 `/index.html` 再交给 ASSETS——
 * Assets 默认 html_handling 会把 `/index.html` 307 回 `/`，造成重定向死循环。
 */

import { AdminRouter } from "./admin/router";
import { NuGetRouter } from "./nuget/router";
import type { Env } from "./nuget/types";

const router = new NuGetRouter();
const adminRouter = new AdminRouter();

export default {
  /**
   * Worker fetch 入口：
   * - `/v3/*`：NuGet API
   * - `/admin/api/*`：管理 API（需 X-NuGet-ApiKey，与 CLI 同一密钥）
   * - `/admin`：管理页
   * - `/upload`：301 → `/admin`
   * - `/packages/*`：商店 SPA
   * - 其它：原样交给 ASSETS
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

    if (path === "/admin/api" || path.startsWith("/admin/api/")) {
      const response = await adminRouter.handle(request, env);
      return withCors(response);
    }

    // 旧上传页入口 → 管理页
    if (path === "/upload" || path === "/upload/") {
      return Response.redirect(new URL("/admin", url.origin).href, 301);
    }

    // 管理页
    if (path === "/admin" || path === "/admin/") {
      return serveStaticFile(env, url.origin, "/admin.html");
    }

    // 商店首页 / 详情：直接返回 index.html 正文
    if (path === "/" || path.startsWith("/packages/")) {
      return serveStaticFile(env, url.origin, "/index.html");
    }

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
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, X-NuGet-ApiKey, Authorization",
  };
}

export type { Env };
