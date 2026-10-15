/**
 * 从 .nupkg（ZIP）中读取 .nuspec、README、图标并解析包元数据。
 */

import { unzipSync } from "fflate";
import type {
  DependencyGroup,
  ExtractedIcon,
  PackageDependency,
  PackageMetadata,
} from "./types";

/** README 写入元数据的最大字节数，避免 D1/Registration 过大 */
const MAX_README_BYTES = 200_000;
/** 嵌入图标最大体积；超过则跳过，避免异常包拖垮 Worker */
const MAX_ICON_BYTES = 512_000;

/** 解析结果：元数据 + 可选嵌入图标字节 */
export interface PackageReadResult {
  meta: PackageMetadata;
  icon?: ExtractedIcon;
}

/**
 * 读取 nupkg：nuspec、README、嵌入图标。
 * @throws Error 当 ZIP 无效或缺少 nuspec / 必要字段时
 */
export function readPackage(bytes: Uint8Array): PackageReadResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("Invalid nupkg: not a valid ZIP archive");
  }

  const nuspecKey = Object.keys(files).find((k) =>
    k.toLowerCase().endsWith(".nuspec"),
  );
  if (!nuspecKey) {
    throw new Error("Invalid nupkg: .nuspec not found");
  }

  const xml = new TextDecoder().decode(files[nuspecKey]);
  const meta = parseNuspecXml(xml);
  const readme = extractReadme(files, meta.readmeFile);
  if (readme) {
    meta.readme = readme;
  }
  // nuspec 无 releaseNotes 时，回退包内常见变更说明文件
  if (!meta.releaseNotes?.trim()) {
    const fromFile = extractReleaseNotesFile(files);
    if (fromFile) meta.releaseNotes = fromFile;
  }
  const icon = extractIcon(files, meta.iconFile);
  return { meta, icon };
}

/**
 * 仅解析元数据（测试与兼容）；不返回图标字节。
 */
export function readMetadata(bytes: Uint8Array): PackageMetadata {
  return readPackage(bytes).meta;
}

/**
 * 解析 nuspec XML 文本（轻量字符串/正则，避免引入完整 XML 依赖）。
 * 支持 releaseNotes / readme / projectUrl，以及 CDATA。
 */
export function parseNuspecXml(xml: string): PackageMetadata {
  const metadataBlock = extractTagInner(xml, "metadata");
  if (!metadataBlock) {
    throw new Error("Invalid nuspec: missing metadata element");
  }

  const id = textOf(metadataBlock, "id");
  const version = textOf(metadataBlock, "version");
  if (!id || !version) {
    throw new Error("Invalid nuspec: id and version are required");
  }

  const releaseNotes = textOf(metadataBlock, "releaseNotes").trim() || undefined;
  const readmeFile = textOf(metadataBlock, "readme") || undefined;
  const iconFile = textOf(metadataBlock, "icon") || undefined;
  const externalIconUrl = textOf(metadataBlock, "iconUrl") || undefined;
  const projectUrl = textOf(metadataBlock, "projectUrl") || undefined;
  const tags = parseTags(textOf(metadataBlock, "tags"));

  return {
    id,
    version,
    title: textOf(metadataBlock, "title") || undefined,
    description: textOf(metadataBlock, "description") || undefined,
    authors: textOf(metadataBlock, "authors") || undefined,
    releaseNotes,
    readmeFile,
    iconFile,
    externalIconUrl,
    projectUrl,
    tags,
    dependencyGroups: parseDependencyGroups(metadataBlock),
  };
}

/**
 * 解析 nuspec tags：空格 / 逗号分隔，去重并保留原始大小写顺序（小写去重键）。
 */
export function parseTags(raw: string): string[] {
  if (!raw.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const t = part.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** 写入 packages.tags 的规范化字符串（小写、空格分隔） */
export function tagsToStorage(tags: string[]): string {
  return tags.map((t) => t.toLowerCase()).join(" ");
}

/**
 * 当 nuspec 未声明 releaseNotes 时，从包内常见变更说明文件提取。
 * 匹配根目录或浅层路径的 CHANGELOG / RELEASENOTES 等。
 */
export function extractReleaseNotesFile(
  files: Record<string, Uint8Array>,
): string | undefined {
  const keys = Object.keys(files);
  const candidates = keys
    .map((k) => ({ k, n: k.replace(/\\/g, "/").toLowerCase() }))
    .filter((x) => {
      const base = x.n.split("/").pop() ?? "";
      return (
        /^(changelog|changes|releasenotes|release-notes|release_notes)(\.(md|txt|markdown))?$/i.test(
          base,
        )
      );
    })
    .sort((a, b) => a.n.split("/").length - b.n.split("/").length);

  const key = candidates[0]?.k;
  if (!key) return undefined;
  const raw = files[key];
  if (!raw || raw.byteLength === 0) return undefined;
  const sliced =
    raw.byteLength > MAX_README_BYTES ? raw.subarray(0, MAX_README_BYTES) : raw;
  return new TextDecoder().decode(sliced).trim() || undefined;
}

/**
 * 按 nuspec 声明或常见文件名，从 ZIP 条目中提取 README 文本。
 */
export function extractReadme(
  files: Record<string, Uint8Array>,
  readmeFile?: string,
): string | undefined {
  const keys = Object.keys(files);
  let key: string | undefined;

  if (readmeFile) {
    const normalized = readmeFile.replace(/\\/g, "/").replace(/^\.\//, "");
    key =
      keys.find((k) => k.replace(/\\/g, "/") === normalized) ??
      keys.find(
        (k) => k.replace(/\\/g, "/").toLowerCase() === normalized.toLowerCase(),
      ) ??
      keys.find((k) =>
        k
          .replace(/\\/g, "/")
          .toLowerCase()
          .endsWith("/" + normalized.toLowerCase()),
      );
  }

  if (!key) {
    // 回退：包根或常见路径下的 README.md / readme.txt
    const candidates = keys
      .map((k) => ({ k, n: k.replace(/\\/g, "/").toLowerCase() }))
      .filter(
        (x) =>
          /(^|\/)readme\.md$/i.test(x.n) ||
          /(^|\/)readme\.txt$/i.test(x.n) ||
          /(^|\/)readme\.markdown$/i.test(x.n),
      )
      .sort((a, b) => a.n.split("/").length - b.n.split("/").length);
    key = candidates[0]?.k;
  }

  if (!key) return undefined;
  const raw = files[key];
  if (!raw || raw.byteLength === 0) return undefined;

  const sliced =
    raw.byteLength > MAX_README_BYTES ? raw.subarray(0, MAX_README_BYTES) : raw;
  return new TextDecoder().decode(sliced);
}

/**
 * 按 nuspec &lt;icon&gt; 或常见文件名提取嵌入图标（限体积）。
 */
export function extractIcon(
  files: Record<string, Uint8Array>,
  iconFile?: string,
): ExtractedIcon | undefined {
  const keys = Object.keys(files);
  let key: string | undefined;

  if (iconFile) {
    key = findZipEntry(keys, iconFile);
  }

  if (!key) {
    const candidates = keys
      .map((k) => ({ k, n: k.replace(/\\/g, "/").toLowerCase() }))
      .filter(
        (x) =>
          /(^|\/)icon\.(png|jpg|jpeg|gif|webp|svg)$/i.test(x.n) ||
          /(^|\/)packageicon\.(png|jpg|jpeg|gif|webp|svg)$/i.test(x.n),
      )
      .sort((a, b) => a.n.split("/").length - b.n.split("/").length);
    key = candidates[0]?.k;
  }

  if (!key) return undefined;
  const raw = files[key];
  if (!raw || raw.byteLength === 0 || raw.byteLength > MAX_ICON_BYTES) {
    return undefined;
  }

  const lower = key.replace(/\\/g, "/").toLowerCase();
  const extMatch = /\.([a-z0-9]+)$/i.exec(lower);
  const extension = (extMatch?.[1] ?? "png").toLowerCase();
  const contentType = contentTypeForExt(extension);
  return { bytes: raw, contentType, extension };
}

/** 在 ZIP 条目中按相对路径查找（忽略大小写与前导 ./） */
function findZipEntry(keys: string[], path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  return (
    keys.find((k) => k.replace(/\\/g, "/") === normalized) ??
    keys.find(
      (k) => k.replace(/\\/g, "/").toLowerCase() === normalized.toLowerCase(),
    ) ??
    keys.find((k) =>
      k
        .replace(/\\/g, "/")
        .toLowerCase()
        .endsWith("/" + normalized.toLowerCase()),
    )
  );
}

function contentTypeForExt(ext: string): string {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "png":
    default:
      return "image/png";
  }
}

function parseDependencyGroups(metadataBlock: string): DependencyGroup[] {
  const depsRoot = extractTagInner(metadataBlock, "dependencies");
  if (!depsRoot) return [];

  const groups: DependencyGroup[] = [];
  const groupRegex = /<group\b([^>]*)>([\s\S]*?)<\/group>/gi;
  let match: RegExpExecArray | null;
  let foundGroup = false;

  while ((match = groupRegex.exec(depsRoot)) !== null) {
    foundGroup = true;
    const attrs = match[1] ?? "";
    const inner = match[2] ?? "";
    const tfm = attrValue(attrs, "targetFramework");
    groups.push({
      targetFramework: tfm || undefined,
      dependencies: parseDependencyElements(inner),
    });
  }

  if (!foundGroup) {
    const flat = parseDependencyElements(depsRoot);
    if (flat.length > 0) {
      groups.push({ dependencies: flat });
    }
  }

  return groups;
}

function parseDependencyElements(xml: string): PackageDependency[] {
  const result: PackageDependency[] = [];
  const depRegex = /<dependency\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = depRegex.exec(xml)) !== null) {
    const attrs = match[1] ?? "";
    const id = attrValue(attrs, "id");
    if (!id) continue;
    const range = attrValue(attrs, "version") || undefined;
    result.push({ id, range });
  }
  return result;
}

function extractTagInner(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = re.exec(xml);
  return m ? (m[1] ?? null) : null;
}

/**
 * 取标签文本；优先匹配 CDATA（避免正文中的 `</tag>` 打断非贪婪正则），
 * 并做基础 / 数字 XML 实体解码。
 */
function textOf(xml: string, tag: string): string {
  // 1) 整段 CDATA：可含任意字符（含看起来像闭合标签的文本）
  const cdataBlock = new RegExp(
    `<${tag}\\b[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`,
    "i",
  );
  const cdataMatch = cdataBlock.exec(xml);
  if (cdataMatch) {
    return (cdataMatch[1] ?? "").trim();
  }

  // 2) 普通文本节点
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = re.exec(xml);
  if (!m) return "";
  let inner = (m[1] ?? "").trim();
  // 容错：正文里夹带 CDATA 包装
  const embedded = /<!\[CDATA\[([\s\S]*?)\]\]>/i.exec(inner);
  if (embedded) {
    return (embedded[1] ?? "").trim();
  }
  return decodeXml(inner);
}

function attrValue(attrs: string, name: string): string {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i");
  const m = re.exec(attrs);
  return m ? decodeXml(m[1] ?? "") : "";
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
      String.fromCodePoint(Number.parseInt(h, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, d: string) =>
      String.fromCodePoint(Number.parseInt(d, 10)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * 从请求体取出 nupkg 字节（NuGet Publish / 管理上传约定）。
 * multipart 优先走平台 `formData()`（更快），失败再回退手工解析。
 */
export async function extractNupkgFromRequest(
  request: Request,
): Promise<Uint8Array> {
  const contentType = request.headers.get("Content-Type") ?? "";

  if (contentType.toLowerCase().includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const fromForm = await bytesFromFormData(form);
      if (fromForm && fromForm.byteLength > 0) return fromForm;
      throw new Error("multipart body did not contain a package part");
    } catch (e) {
      // formData 已消费 body，无法再手工解析；直接抛出
      if (e instanceof Error && e.message.includes("package part")) throw e;
      throw new Error(
        e instanceof Error ? e.message : "Failed to parse multipart body",
      );
    }
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength === 0) {
    throw new Error("Empty request body");
  }
  return body;
}

/** 从 FormData 取名为 package / file 的文件，或第一个 Blob 字段 */
async function bytesFromFormData(form: FormData): Promise<Uint8Array | null> {
  const preferred =
    form.get("package") ?? form.get("file") ?? form.get("content");
  if (isBlobLike(preferred)) {
    return new Uint8Array(await preferred.arrayBuffer());
  }
  for (const value of form.values()) {
    if (isBlobLike(value) && value.size > 0) {
      return new Uint8Array(await value.arrayBuffer());
    }
  }
  return null;
}

function isBlobLike(value: unknown): value is Blob {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Blob).arrayBuffer === "function" &&
    typeof (value as Blob).size === "number"
  );
}
