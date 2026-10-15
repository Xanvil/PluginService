/**
 * 管理 API 路由：访问密钥保护下的列表 / 发布 / 硬删除。
 */

import { assertAdminAuthorized } from "../nuget/auth";
import { extractNupkgFromRequest, readPackage } from "../nuget/nupkg";
import { PackageRepository } from "../nuget/repository";
import type { Env } from "../nuget/types";
import { PublishError } from "../nuget/types";

/**
 * 管理 API 路由器。
 * 对外方法：`handle(request, env)` — 仅处理 `/admin/api/*`。
 */
export class AdminRouter {
  /**
   * 分发管理 API。调用前应已确认 path 以 `/admin/api` 开头。
   */
  async handle(request: Request, env: Env): Promise<Response> {
    try {
      assertAdminAuthorized(request, env);
    } catch (e) {
      const status = (e as { status?: number }).status ?? 401;
      const message = e instanceof Error ? e.message : "Unauthorized";
      return json({ error: message }, status);
    }

    const url = new URL(request.url);
    const path = normalizePath(url.pathname);
    const repo = new PackageRepository(env);

    try {
      // GET /admin/api/packages?q=&take=
      if (request.method === "GET" && path === "/admin/api/packages") {
        const q = url.searchParams.get("q") ?? "";
        const take = Number(url.searchParams.get("take") ?? "50");
        const packages = await repo.listForAdmin(q, Number.isFinite(take) ? take : 50);
        return json({ packages });
      }

      // POST /admin/api/preview — 解析 nupkg 详情，不写入存储
      if (request.method === "POST" && path === "/admin/api/preview") {
        let bytes: Uint8Array;
        try {
          bytes = await extractNupkgFromRequest(request);
        } catch (e) {
          return json(
            {
              error: e instanceof Error ? e.message : "Invalid package body",
            },
            400,
          );
        }
        try {
          // 预览响应刻意裁剪：避免大 README/图标令 JSON 与前端 Markdown 渲染卡死
          const PREVIEW_TEXT_MAX = 48_000;
          const PREVIEW_ICON_MAX = 64_000;

          const { meta, icon } = readPackage(bytes);
          const alreadyExists = await repo.versionExists(meta.id, meta.version);

          const { text: releaseNotes, truncated: releaseNotesTruncated } =
            truncateText(meta.releaseNotes, PREVIEW_TEXT_MAX);
          const { text: readme, truncated: readmeTruncated } = truncateText(
            meta.readme,
            PREVIEW_TEXT_MAX,
          );

          let iconDataUrl: string | null = null;
          if (icon && icon.bytes.byteLength <= PREVIEW_ICON_MAX) {
            iconDataUrl = `data:${icon.contentType};base64,${uint8ToBase64(icon.bytes)}`;
          }

          return json({
            id: meta.id,
            version: meta.version,
            title: meta.title ?? null,
            description: meta.description ?? null,
            authors: meta.authors ?? null,
            tags: meta.tags ?? [],
            releaseNotes,
            releaseNotesTruncated,
            readme,
            readmeTruncated,
            projectUrl: meta.projectUrl ?? null,
            dependencyGroups: meta.dependencyGroups ?? [],
            iconDataUrl,
            alreadyExists,
            sizeBytes: bytes.byteLength,
          });
        } catch (e) {
          return json(
            {
              error: e instanceof Error ? e.message : "Invalid nupkg",
            },
            400,
          );
        }
      }

      // POST /admin/api/publish
      if (request.method === "POST" && path === "/admin/api/publish") {
        let bytes: Uint8Array;
        try {
          bytes = await extractNupkgFromRequest(request);
        } catch (e) {
          return json(
            {
              error: e instanceof Error ? e.message : "Invalid package body",
            },
            400,
          );
        }
        const result = await repo.publishBytes(bytes);
        return json(
          { message: "Package published", id: result.id, version: result.version },
          201,
        );
      }

      // DELETE /admin/api/packages/{id}/versions/{version}
      const verMatch = /^\/admin\/api\/packages\/([^/]+)\/versions\/([^/]+)$/.exec(
        path,
      );
      if (request.method === "DELETE" && verMatch) {
        const id = decodeURIComponent(verMatch[1]!);
        const version = decodeURIComponent(verMatch[2]!);
        const ok = await repo.deleteVersion(id, version);
        if (!ok) return json({ error: "Version not found" }, 404);
        return json({ message: "Version deleted", id, version });
      }

      // DELETE /admin/api/packages/{id}
      const pkgMatch = /^\/admin\/api\/packages\/([^/]+)$/.exec(path);
      if (request.method === "DELETE" && pkgMatch) {
        const id = decodeURIComponent(pkgMatch[1]!);
        const ok = await repo.deletePackage(id);
        if (!ok) return json({ error: "Package not found" }, 404);
        return json({ message: "Package deleted", id });
      }

      return json({ error: "Not found" }, 404);
    } catch (e) {
      if (e instanceof PublishError) {
        return json({ error: e.message }, e.status);
      }
      const status = (e as { status?: number }).status;
      if (typeof status === "number") {
        return json(
          { error: e instanceof Error ? e.message : "Error" },
          status,
        );
      }
      console.error("AdminRouter error", e);
      return json({ error: "Internal server error" }, 500);
    }
  }
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** 截断预览用长文本，避免超大响应。 */
function truncateText(
  raw: string | null | undefined,
  maxChars: number,
): { text: string | null; truncated: boolean } {
  if (!raw) return { text: null, truncated: false };
  if (raw.length <= maxChars) return { text: raw, truncated: false };
  return { text: raw.slice(0, maxChars), truncated: true };
}

/** Uint8Array → base64（用于预览图标 data URL） */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}
