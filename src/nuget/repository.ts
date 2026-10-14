/**
 * 包仓储：D1 元数据 + R2 二进制，对外提供查询与发布。
 */

import { assertPushAuthorized } from "./auth";
import {
  extractNupkgFromRequest,
  readPackage,
  tagsToStorage,
} from "./nupkg";
import {
  matchesNuGetSearch,
  parseNuGetSearchQuery,
  type SearchablePackage,
} from "./searchQuery";
import {
  compareNuGetVersions,
  isPrerelease,
  isSemVer2Only,
  pickLatestVersion,
} from "./semver";
import type {
  Env,
  PackageMetadata,
  PackageRow,
  VersionRow,
} from "./types";
import { PublishError } from "./types";

/** SearchQueryService 查询选项（对齐 nuget.org） */
export interface SearchOptions {
  prerelease?: boolean;
  /** 如 "2.0.0"；低于 2 时排除仅 SemVer2 的版本 */
  semVerLevel?: string;
  packageType?: string;
}

/** R2 对象键：packages/{id_lower}/{version_lower}/{id_lower}.{version_lower}.nupkg */
export function contentKey(idLower: string, versionLower: string): string {
  return `packages/${idLower}/${versionLower}/${idLower}.${versionLower}.nupkg`;
}

/** R2 图标键：packages/{id}/{ver}/icon.{ext} */
export function iconContentKey(
  idLower: string,
  versionLower: string,
  extension: string,
): string {
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  return `packages/${idLower}/${versionLower}/icon${ext}`;
}

/**
 * 解析对外可访问的图标 URL（嵌入 R2 优先，否则外部 iconUrl）。
 */
export function resolveIconUrl(
  meta: PackageMetadata,
  baseUrl: string,
  idLower: string,
  versionLower: string,
): string {
  if (meta.iconKey) {
    return `${baseUrl}/v3/flatcontainer/${idLower}/${versionLower}/icon`;
  }
  if (meta.externalIconUrl) {
    return meta.externalIconUrl;
  }
  return "";
}

/**
 * NuGet 包数据访问层。
 * 核心方法：listVersions / getPackageObject / getRegistration / search / publish。
 */
export class PackageRepository {
  constructor(private readonly env: Env) {}

  /**
   * Flat Container：返回某包已发布版本（小写排序用 SemVer 比较后的原始 version 列表）。
   */
  async listVersions(id: string): Promise<string[] | null> {
    const idLower = id.toLowerCase();
    const rows = await this.env.DB.prepare(
      `SELECT version FROM package_versions
       WHERE id_lower = ? AND listed = 1`,
    )
      .bind(idLower)
      .all<{ version: string }>();

    if (!rows.results || rows.results.length === 0) {
      const pkg = await this.env.DB.prepare(
        `SELECT id_lower FROM packages WHERE id_lower = ?`,
      )
        .bind(idLower)
        .first();
      if (!pkg) return null;
      return [];
    }

    const versions = rows.results.map((r) => r.version);
    versions.sort((a, b) => compareNuGetVersions(a, b));
    return versions;
  }

  /**
   * 从 R2 取包对象（流式 body，由调用方直接 pipe 到 Response）。
   */
  async getPackageObject(
    id: string,
    version: string,
  ): Promise<R2ObjectBody | null> {
    const key = contentKey(id.toLowerCase(), version.toLowerCase());
    return this.env.PACKAGES.get(key);
  }

  /**
   * 取版本嵌入图标（按 nuspec_json.iconKey 定位 R2）。
   */
  async getIconObject(
    id: string,
    version: string,
  ): Promise<R2ObjectBody | null> {
    const idLower = id.toLowerCase();
    const versionLower = version.toLowerCase();
    const row = await this.env.DB.prepare(
      `SELECT nuspec_json FROM package_versions
       WHERE id_lower = ? AND version_lower = ? AND listed = 1`,
    )
      .bind(idLower, versionLower)
      .first<{ nuspec_json: string }>();
    if (!row) return null;
    let meta: PackageMetadata;
    try {
      meta = JSON.parse(row.nuspec_json) as PackageMetadata;
    } catch {
      return null;
    }
    if (!meta.iconKey) return null;
    return this.env.PACKAGES.get(meta.iconKey);
  }

  /**
   * 组装 Registration index JSON（小源：全部版本内联在单页）。
   */
  async getRegistration(
    id: string,
    baseUrl: string,
  ): Promise<Record<string, unknown> | null> {
    const idLower = id.toLowerCase();
    const pkg = await this.env.DB.prepare(
      `SELECT * FROM packages WHERE id_lower = ? AND listed = 1`,
    )
      .bind(idLower)
      .first<PackageRow>();
    if (!pkg) return null;

    const versionRows = await this.env.DB.prepare(
      `SELECT * FROM package_versions
       WHERE id_lower = ? AND listed = 1`,
    )
      .bind(idLower)
      .all<VersionRow>();

    const versions = (versionRows.results ?? []).slice();
    versions.sort((a, b) => compareNuGetVersions(a.version, b.version));
    if (versions.length === 0) return null;

    const lower = versions[0]!.version_lower;
    const upper = versions[versions.length - 1]!.version_lower;
    const registrationBase = `${baseUrl}/v3/registration/${idLower}`;
    const commitTimeStamp = pkg.updated_at;
    const commitId = pkg.updated_at;

    const items = versions.map((v) => {
      const meta = JSON.parse(v.nuspec_json) as PackageMetadata;
      const packageContent = `${baseUrl}/v3/flatcontainer/${idLower}/${v.version_lower}/${idLower}.${v.version_lower}.nupkg`;
      const leafId = `${registrationBase}/${v.version_lower}.json`;

      return {
        "@id": leafId,
        "@type": "Package",
        commitId: v.created_at,
        commitTimeStamp: v.created_at,
        catalogEntry: {
          "@id": leafId,
          "@type": "PackageDetails",
          authors: meta.authors ?? pkg.authors ?? "",
          description: meta.description ?? pkg.description ?? "",
          iconUrl: resolveIconUrl(meta, baseUrl, idLower, v.version_lower),
          id: pkg.id,
          language: "",
          licenseUrl: "",
          listed: v.listed === 1,
          packageContent,
          projectUrl: meta.projectUrl ?? "",
          requireLicenseAcceptance: false,
          summary: meta.description ?? pkg.description ?? "",
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          title: meta.title ?? pkg.title ?? pkg.id,
          version: v.version,
          // 商店页使用：发布说明与 README（非 nuget.org 标准字段，客户端忽略即可）
          releaseNotes: meta.releaseNotes ?? "",
          readme: meta.readme ?? "",
          readmeFile: meta.readmeFile ?? "",
          dependencyGroups: (meta.dependencyGroups ?? []).map((g) => ({
            "@id": `${leafId}#dependencyGroup/${g.targetFramework ?? ""}`,
            "@type": "PackageDependencyGroup",
            targetFramework: g.targetFramework ?? "",
            dependencies: (g.dependencies ?? []).map((d) => ({
              "@id": `${leafId}#dependency/${d.id}`,
              "@type": "PackageDependency",
              id: d.id,
              range: d.range ?? "",
            })),
          })),
        },
        packageContent,
        registration: registrationBase + "/index.json",
      };
    });

    const pageId = `${registrationBase}/page/${lower}/${upper}.json`;

    return {
      "@id": `${registrationBase}/index.json`,
      "@type": [
        "catalog:CatalogRoot",
        "PackageRegistration",
        "catalog:Permalink",
      ],
      commitId,
      commitTimeStamp,
      count: 1,
      items: [
        {
          "@id": pageId,
          "@type": "catalog:CatalogPage",
          commitId,
          commitTimeStamp,
          count: items.length,
          items,
          parent: `${registrationBase}/index.json`,
          lower,
          upper,
        },
      ],
    };
  }

  /**
   * 单版本 Registration leaf（可选，供客户端直链）。
   */
  async getRegistrationLeaf(
    id: string,
    version: string,
    baseUrl: string,
  ): Promise<Record<string, unknown> | null> {
    const reg = await this.getRegistration(id, baseUrl);
    if (!reg) return null;
    const pages = reg.items as Array<{ items?: unknown[] }>;
    const page = pages?.[0];
    const leaves = (page?.items ?? []) as Array<{
      catalogEntry?: { version?: string };
    }>;
    const versionLower = version.toLowerCase();
    const leaf = leaves.find(
      (l) => (l.catalogEntry?.version ?? "").toLowerCase() === versionLower,
    );
    return (leaf as Record<string, unknown>) ?? null;
  }

  /**
   * 列出源中出现过的全部标签（来自 packages.tags）。
   */
  async listTags(): Promise<string[]> {
    const rows = await this.env.DB.prepare(
      `SELECT tags FROM packages WHERE listed = 1 AND coalesce(tags, '') != ''`,
    ).all<{ tags: string }>();
    const set = new Set<string>();
    for (const row of rows.results ?? []) {
      for (const t of (row.tags ?? "").split(/\s+/)) {
        if (t) set.add(t);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  /**
   * SearchQueryService：对齐 nuget.org 的 q 语法与 prerelease / semVerLevel。
   * 小源在内存中过滤，保证 property:term 语义准确。
   */
  async search(
    q: string,
    skip: number,
    take: number,
    baseUrl: string,
    options: SearchOptions = {},
  ): Promise<{ totalHits: number; data: unknown[] }> {
    const includePrerelease = options.prerelease === true;
    const allowSemVer2 =
      (options.semVerLevel ?? "").trim().startsWith("2");
    const packageTypeFilter = (options.packageType ?? "").trim().toLowerCase();
    const clauses = parseNuGetSearchQuery(q);
    const limit = Math.min(Math.max(take || 20, 1), 100);
    const offset = Math.max(skip || 0, 0);

    const packages =
      (
        await this.env.DB.prepare(
          `SELECT * FROM packages WHERE listed = 1 ORDER BY updated_at DESC`,
        ).all<PackageRow>()
      ).results ?? [];

    const matched: unknown[] = [];

    for (const pkg of packages) {
      const versionRows = await this.env.DB.prepare(
        `SELECT version, version_lower, nuspec_json FROM package_versions
         WHERE id_lower = ? AND listed = 1`,
      )
        .bind(pkg.id_lower)
        .all<{ version: string; version_lower: string; nuspec_json: string }>();

      let versions = (versionRows.results ?? []).slice();
      versions = versions.filter((v) => {
        if (!includePrerelease && isPrerelease(v.version)) return false;
        if (!allowSemVer2 && isSemVer2Only(v.version)) return false;
        return true;
      });
      versions.sort((a, b) => compareNuGetVersions(a.version, b.version));
      if (versions.length === 0) continue;

      const latest = versions[versions.length - 1]!;
      let meta: PackageMetadata = {
        id: pkg.id,
        version: latest.version,
        tags: splitStoredTags(pkg.tags),
        dependencyGroups: [],
      };
      try {
        meta = JSON.parse(latest.nuspec_json) as PackageMetadata;
        if (!Array.isArray(meta.tags)) meta.tags = splitStoredTags(pkg.tags);
      } catch {
        // keep defaults
      }

      const packageTypes = extractPackageTypes(meta);
      if (packageTypeFilter) {
        const hit = packageTypes.some(
          (t) => t.toLowerCase() === packageTypeFilter,
        );
        if (!hit) continue;
      }

      const searchable: SearchablePackage = {
        id: pkg.id,
        version: latest.version,
        title: meta.title ?? pkg.title ?? pkg.id,
        description: meta.description ?? pkg.description ?? "",
        summary: meta.description ?? pkg.description ?? "",
        authors: splitAuthors(meta.authors ?? pkg.authors),
        tags: meta.tags ?? [],
        owners: [],
      };

      if (!matchesNuGetSearch(searchable, clauses)) continue;

      const iconUrl = resolveIconUrl(
        meta,
        baseUrl,
        pkg.id_lower,
        latest.version_lower,
      );

      matched.push({
        "@id": `${baseUrl}/v3/registration/${pkg.id_lower}/index.json`,
        "@type": "Package",
        registration: `${baseUrl}/v3/registration/${pkg.id_lower}/index.json`,
        id: pkg.id,
        version: latest.version,
        description: searchable.description,
        summary: searchable.summary,
        title: searchable.title,
        authors: searchable.authors,
        totalDownloads: pkg.downloads,
        verified: false,
        iconUrl,
        tags: searchable.tags,
        projectUrl: meta.projectUrl ?? "",
        packageTypes: packageTypes.map((name) => ({ name })),
        versions: versions.map((v) => ({
          version: v.version,
          downloads: 0,
          "@id": `${baseUrl}/v3/registration/${pkg.id_lower}/${v.version_lower}.json`,
        })),
      });
    }

    const totalHits = matched.length;
    const data = matched.slice(offset, offset + limit);
    return { totalHits, data };
  }

  /**
   * 发布包：校验 API Key → 解析 nupkg → 写 R2 → upsert D1。
   * 同 id+version 已存在时抛出 PublishError 409。
   */
  async publish(request: Request): Promise<{ id: string; version: string }> {
    assertPushAuthorized(request, this.env);

    let bytes: Uint8Array;
    try {
      bytes = await extractNupkgFromRequest(request);
    } catch (e) {
      throw new PublishError(
        400,
        e instanceof Error ? e.message : "Invalid package body",
      );
    }

    let meta: PackageMetadata;
    let iconBytes: Uint8Array | undefined;
    let iconContentType: string | undefined;
    let iconExt: string | undefined;
    try {
      const read = readPackage(bytes);
      meta = read.meta;
      if (read.icon) {
        iconBytes = read.icon.bytes;
        iconContentType = read.icon.contentType;
        iconExt = read.icon.extension;
      }
    } catch (e) {
      throw new PublishError(
        400,
        e instanceof Error ? e.message : "Invalid nupkg",
      );
    }

    const idLower = meta.id.toLowerCase();
    const versionLower = meta.version.toLowerCase();
    const key = contentKey(idLower, versionLower);
    let iconKey: string | undefined;
    if (iconBytes && iconExt) {
      iconKey = iconContentKey(idLower, versionLower, iconExt);
      meta.iconKey = iconKey;
      meta.iconContentType = iconContentType;
    }
    // 不把二进制写入 JSON
    const now = new Date().toISOString();

    const existing = await this.env.DB.prepare(
      `SELECT version FROM package_versions
       WHERE id_lower = ? AND version_lower = ?`,
    )
      .bind(idLower, versionLower)
      .first();
    if (existing) {
      throw new PublishError(
        409,
        `Package ${meta.id} ${meta.version} already exists`,
      );
    }

    // 先写 R2（包 + 可选图标），再写 D1；失败时回滚 R2
    await this.env.PACKAGES.put(key, bytes, {
      httpMetadata: {
        contentType: "application/octet-stream",
      },
      customMetadata: {
        id: meta.id,
        version: meta.version,
      },
    });

    if (iconKey && iconBytes) {
      await this.env.PACKAGES.put(iconKey, iconBytes, {
        httpMetadata: {
          contentType: iconContentType ?? "image/png",
        },
        customMetadata: {
          id: meta.id,
          version: meta.version,
          kind: "icon",
        },
      });
    }

    const nuspecJson = JSON.stringify(meta);

    try {
      const pkg = await this.env.DB.prepare(
        `SELECT * FROM packages WHERE id_lower = ?`,
      )
        .bind(idLower)
        .first<PackageRow>();

      if (!Array.isArray(meta.tags)) meta.tags = [];
      const tagsStored = tagsToStorage(meta.tags);

      if (!pkg) {
        await this.env.DB.prepare(
          `INSERT INTO packages
           (id, id_lower, title, description, authors, latest_version, listed, downloads, updated_at, tags)
           VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
        )
          .bind(
            meta.id,
            idLower,
            meta.title ?? meta.id,
            meta.description ?? "",
            meta.authors ?? "",
            meta.version,
            now,
            tagsStored,
          )
          .run();
      } else {
        const latest =
          pickLatestVersion([pkg.latest_version, meta.version]) ?? meta.version;
        // 包级 tags 取各版本并集，保证历史上出现过的标签都能筛到该包
        const mergedTags = tagsToStorage(
          mergeTagLists(splitStoredTags(pkg.tags), meta.tags),
        );
        await this.env.DB.prepare(
          `UPDATE packages
           SET title = ?, description = ?, authors = ?, latest_version = ?, updated_at = ?, tags = ?
           WHERE id_lower = ?`,
        )
          .bind(
            meta.title ?? pkg.title ?? meta.id,
            meta.description ?? pkg.description ?? "",
            meta.authors ?? pkg.authors ?? "",
            latest,
            now,
            mergedTags,
            idLower,
          )
          .run();
      }

      await this.env.DB.prepare(
        `INSERT INTO package_versions
         (id_lower, version, version_lower, nuspec_json, content_key, listed, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
      )
        .bind(idLower, meta.version, versionLower, nuspecJson, key, now)
        .run();
    } catch (e) {
      try {
        await this.env.PACKAGES.delete(key);
        if (iconKey) await this.env.PACKAGES.delete(iconKey);
      } catch {
        console.error("Failed to rollback R2 object after D1 error", key);
      }
      throw e;
    }

    return { id: meta.id, version: meta.version };
  }

  /** 下载成功后增加下载计数（best-effort） */
  async incrementDownload(id: string): Promise<void> {
    try {
      await this.env.DB.prepare(
        `UPDATE packages SET downloads = downloads + 1 WHERE id_lower = ?`,
      )
        .bind(id.toLowerCase())
        .run();
    } catch {
      // ignore
    }
  }
}

function splitAuthors(authors: string | null | undefined): string[] {
  if (!authors) return [];
  return authors
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}

function splitStoredTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  return tags.split(/\s+/).filter(Boolean);
}

function mergeTagLists(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...a, ...b]) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** nuspec 未声明 packageTypes 时视为 Dependency（nuget.org 默认） */
function extractPackageTypes(meta: PackageMetadata): string[] {
  const anyMeta = meta as PackageMetadata & { packageTypes?: string[] };
  if (Array.isArray(anyMeta.packageTypes) && anyMeta.packageTypes.length > 0) {
    return anyMeta.packageTypes;
  }
  return ["Dependency"];
}
