/**
 * NuGet V3 路由：将 HTTP 请求分发到 Service Index / Flat / Registration / Search / Publish。
 */

import { PackageRepository } from "./repository";
import type { Env } from "./types";
import { PublishError } from "./types";

/**
 * NuGet 协议路由器。
 * 对外方法：`handle(request, env)` — 处理全部 NuGet 相关路径。
 */
export class NuGetRouter {
  /**
   * 处理请求并返回 Response。
   * 未知路径返回 404；Publish 鉴权失败返回 401。
   */
  async handle(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);
    const baseUrl = `${url.protocol}//${url.host}`;
    const repo = new PackageRepository(env);
    const method = request.method.toUpperCase();

    try {
      // 仅处理 /v3/*；其余路径由入口回退到静态资源（上传页）
      if (!path.startsWith("/v3")) {
        return notFound();
      }

      // Service Index
      if (path === "/v3/index.json" && method === "GET") {
        return json(buildServiceIndex(baseUrl));
      }

      // Publish：PUT|POST /v3/package
      if (path === "/v3/package" && (method === "PUT" || method === "POST")) {
        const result = await repo.publish(request);
        return json(
          { message: "Package published", ...result },
          201,
        );
      }

      // 标签目录：GET /v3/tags
      if (path === "/v3/tags" && method === "GET") {
        const tags = await repo.listTags();
        return json({ tags });
      }

      // Search：GET /v3/query?q=&prerelease=&semVerLevel=&packageType=
      // q 语法对齐 nuget.org：id: / packageid: / tags: / author: 等
      if (path === "/v3/query" && method === "GET") {
        const q = url.searchParams.get("q") ?? "";
        const skip = Number.parseInt(url.searchParams.get("skip") ?? "0", 10);
        const take = Number.parseInt(url.searchParams.get("take") ?? "20", 10);
        const prerelease =
          (url.searchParams.get("prerelease") ?? "").toLowerCase() === "true";
        const semVerLevel = url.searchParams.get("semVerLevel") ?? undefined;
        const packageType = url.searchParams.get("packageType") ?? undefined;
        const result = await repo.search(q, skip, take, baseUrl, {
          prerelease,
          semVerLevel,
          packageType,
        });
        return json(result);
      }

      // Flat container versions：/v3/flatcontainer/{id}/index.json
      {
        const m = /^\/v3\/flatcontainer\/([^/]+)\/index\.json$/i.exec(path);
        if (m && method === "GET") {
          const versions = await repo.listVersions(decodeURIComponent(m[1]!));
          if (versions === null) return notFound();
          return json({ versions });
        }
      }

      // 包图标：/v3/flatcontainer/{id}/{version}/icon
      {
        const m = /^\/v3\/flatcontainer\/([^/]+)\/([^/]+)\/icon$/i.exec(path);
        if (m && method === "GET") {
          const id = decodeURIComponent(m[1]!);
          const version = decodeURIComponent(m[2]!);
          const obj = await repo.getIconObject(id, version);
          if (!obj) return notFound();
          const ct =
            obj.httpMetadata?.contentType ||
            obj.customMetadata?.contentType ||
            "image/png";
          return new Response(obj.body, {
            status: 200,
            headers: {
              "Content-Type": ct,
              "Cache-Control": "public, max-age=86400",
            },
          });
        }
      }

      // Flat container nupkg：/v3/flatcontainer/{id}/{version}/{file}.nupkg
      {
        const m =
          /^\/v3\/flatcontainer\/([^/]+)\/([^/]+)\/([^/]+)\.nupkg$/i.exec(
            path,
          );
        if (m && method === "GET") {
          const id = decodeURIComponent(m[1]!);
          const version = decodeURIComponent(m[2]!);
          const obj = await repo.getPackageObject(id, version);
          if (!obj) return notFound();

          await repo.incrementDownload(id);

          return new Response(obj.body, {
            status: 200,
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Disposition": `attachment; filename="${id.toLowerCase()}.${version.toLowerCase()}.nupkg"`,
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          });
        }
      }

      // Registration index：/v3/registration/{id}/index.json
      {
        const m = /^\/v3\/registration\/([^/]+)\/index\.json$/i.exec(path);
        if (m && method === "GET") {
          const reg = await repo.getRegistration(
            decodeURIComponent(m[1]!),
            baseUrl,
          );
          if (!reg) return notFound();
          return json(reg);
        }
      }

      // Registration leaf：/v3/registration/{id}/{version}.json
      {
        const m = /^\/v3\/registration\/([^/]+)\/([^/]+)\.json$/i.exec(path);
        if (m && method === "GET") {
          // 排除 index.json（已由上一分支处理）与 page/...
          const ver = m[2]!;
          if (ver.toLowerCase() === "index") {
            // unreachable due to previous pattern
          } else if (!ver.toLowerCase().startsWith("page")) {
            const leaf = await repo.getRegistrationLeaf(
              decodeURIComponent(m[1]!),
              decodeURIComponent(ver),
              baseUrl,
            );
            if (!leaf) return notFound();
            return json(leaf);
          }
        }
      }

      return notFound();
    } catch (e) {
      if (e instanceof PublishError) {
        return json({ error: e.message }, e.status);
      }
      const status =
        typeof e === "object" &&
        e !== null &&
        "status" in e &&
        typeof (e as { status: unknown }).status === "number"
          ? (e as { status: number }).status
          : 500;
      const message = e instanceof Error ? e.message : "Internal error";
      if (status >= 500) {
        console.error("NuGetRouter error", e);
      }
      return json({ error: message }, status);
    }
  }
}

/** 构建 Service Index，所有资源挂在同一 origin 下以满足 PreAuthenticate 子路径规则 */
export function buildServiceIndex(baseUrl: string): Record<string, unknown> {
  return {
    version: "3.0.0",
    resources: [
      {
        "@id": `${baseUrl}/v3/flatcontainer/`,
        "@type": "PackageBaseAddress/3.0.0",
        comment: "Flat container for nupkg download",
      },
      {
        "@id": `${baseUrl}/v3/registration/`,
        "@type": "RegistrationsBaseUrl/3.6.0",
        comment: "Package registration (inlined pages)",
      },
      {
        "@id": `${baseUrl}/v3/registration/`,
        "@type": "RegistrationsBaseUrl/3.0.0-rc",
      },
      {
        "@id": `${baseUrl}/v3/registration/`,
        "@type": "RegistrationsBaseUrl/3.0.0-beta",
      },
      {
        "@id": `${baseUrl}/v3/query`,
        "@type": "SearchQueryService/3.5.0",
        comment: "nuget.org-compatible q syntax; prerelease/semVerLevel/packageType",
      },
      {
        "@id": `${baseUrl}/v3/query`,
        "@type": "SearchQueryService/3.0.0-rc",
      },
      {
        "@id": `${baseUrl}/v3/query`,
        "@type": "SearchQueryService/3.0.0-beta",
      },
      {
        "@id": `${baseUrl}/v3/query`,
        "@type": "SearchQueryService",
      },
      {
        "@id": `${baseUrl}/v3/package`,
        "@type": "PackagePublish/2.0.0",
        comment: "dotnet nuget push endpoint (X-NuGet-ApiKey required)",
      },
    ],
  };
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? "public, max-age=60" : "no-store",
    },
  });
}

function notFound(): Response {
  return json({ error: "Not found" }, 404);
}
