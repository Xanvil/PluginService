/**
 * 对齐 nuget.org 的搜索查询语法（property:term）与匹配规则。
 * 文档：https://learn.microsoft.com/nuget/consume-packages/finding-and-choosing-packages
 */

/** 支持的字段过滤器（大小写不敏感） */
const FIELD_ALIASES: Record<string, NuGetSearchField> = {
  id: "id",
  packageid: "packageid",
  version: "version",
  title: "title",
  tags: "tags",
  tag: "tags",
  author: "author",
  authors: "author",
  description: "description",
  summary: "summary",
  owner: "owner",
  owners: "owner",
};

export type NuGetSearchField =
  | "id"
  | "packageid"
  | "version"
  | "title"
  | "tags"
  | "author"
  | "description"
  | "summary"
  | "owner";

export type NuGetSearchClause =
  | { kind: "field"; field: NuGetSearchField; term: string }
  | { kind: "text"; term: string };

/** 供匹配使用的包快照（一般为 latest 元数据） */
export interface SearchablePackage {
  id: string;
  version: string;
  title: string;
  description: string;
  summary: string;
  authors: string[];
  tags: string[];
  /** 本源暂无 owners，owner: 过滤器永不命中（与忽略空结果不同：该子句为 false） */
  owners: string[];
}

/**
 * 解析 nuget.org 风格查询串。
 * - `id:foo` / `packageid:bar` / `tags:x` 等为字段过滤
 * - 未知属性（如 `invalid:jquery`）整段忽略
 * - 普通词为全文词（匹配 id/title/description/summary/tags）
 */
export function parseNuGetSearchQuery(q: string): NuGetSearchClause[] {
  const clauses: NuGetSearchClause[] = [];
  for (const raw of (q ?? "").trim().split(/\s+/)) {
    if (!raw) continue;
    const m = /^([A-Za-z]+):(.*)$/.exec(raw);
    if (m) {
      const prop = (m[1] ?? "").toLowerCase();
      const term = (m[2] ?? "").trim();
      const field = FIELD_ALIASES[prop];
      if (!field) {
        // 不支持的属性：整 token 忽略（与 nuget.org 一致）
        continue;
      }
      if (!term) continue;
      clauses.push({ kind: "field", field, term });
      continue;
    }
    clauses.push({ kind: "text", term: raw });
  }
  return clauses;
}

/**
 * 判断包是否满足全部子句（AND）。
 * 无子句时匹配全部（Browse）。
 */
export function matchesNuGetSearch(
  pkg: SearchablePackage,
  clauses: NuGetSearchClause[],
): boolean {
  if (clauses.length === 0) return true;
  return clauses.every((c) => matchClause(pkg, c));
}

function matchClause(pkg: SearchablePackage, clause: NuGetSearchClause): boolean {
  const term = clause.term.toLowerCase();
  if (clause.kind === "text") {
    return (
      contains(pkg.id, term) ||
      contains(pkg.title, term) ||
      contains(pkg.description, term) ||
      contains(pkg.summary, term) ||
      pkg.tags.some((t) => contains(t, term))
    );
  }

  switch (clause.field) {
    case "id":
      // 子串匹配
      return contains(pkg.id, term);
    case "packageid":
      // 精确匹配（忽略大小写）
      return pkg.id.toLowerCase() === term;
    case "version":
      return contains(pkg.version, term);
    case "title":
      return contains(pkg.title, term);
    case "description":
      return contains(pkg.description, term);
    case "summary":
      return contains(pkg.summary, term);
    case "author":
      return pkg.authors.some((a) => contains(a, term));
    case "owner":
      return pkg.owners.some((o) => o.toLowerCase() === term);
    case "tags":
      // 标签：整词相等，或标签字符串含子串（贴近 nuget.org 行为）
      return (
        pkg.tags.some((t) => t.toLowerCase() === term) ||
        pkg.tags.some((t) => contains(t, term))
      );
    default:
      return true;
  }
}

function contains(haystack: string, needleLower: string): boolean {
  return (haystack ?? "").toLowerCase().includes(needleLower);
}
