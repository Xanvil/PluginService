/**
 * 精简 NuGet SemVer 2.0 版本比较，用于挑选 latest_version 与排序。
 */

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  revision: number;
  releaseLabels: string[];
  isLegacy: boolean;
}

/**
 * 比较两个 NuGet 版本字符串。
 * @returns 负数表示 a&lt;b，0 相等，正数表示 a&gt;b
 */
export function compareNuGetVersions(a: string, b: string): number {
  const pa = parseNuGetVersion(a);
  const pb = parseNuGetVersion(b);

  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (pa.revision !== pb.revision) return pa.revision - pb.revision;

  const aPre = pa.releaseLabels.length > 0;
  const bPre = pb.releaseLabels.length > 0;
  if (aPre !== bPre) return aPre ? -1 : 1;
  if (!aPre && !bPre) return 0;

  const max = Math.max(pa.releaseLabels.length, pb.releaseLabels.length);
  for (let i = 0; i < max; i++) {
    const al = pa.releaseLabels[i];
    const bl = pb.releaseLabels[i];
    if (al === undefined) return -1;
    if (bl === undefined) return 1;
    const cmp = compareLabel(al, bl);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

/** 在版本列表中选出最高版本（原始大小写保留） */
export function pickLatestVersion(versions: string[]): string | null {
  if (versions.length === 0) return null;
  let latest = versions[0]!;
  for (let i = 1; i < versions.length; i++) {
    const v = versions[i]!;
    if (compareNuGetVersions(v, latest) > 0) latest = v;
  }
  return latest;
}

/** 是否为预发布版本（含 - 标签） */
export function isPrerelease(version: string): boolean {
  const withoutMeta = version.split("+", 1)[0] ?? version;
  return withoutMeta.includes("-");
}

/**
 * 是否仅 SemVer 2.0 兼容（对仅支持 SemVer1 的客户端应排除）。
 * 判定：含 build metadata（+），或预发布标签含点分多段（如 1.0.0-alpha.1）。
 */
export function isSemVer2Only(version: string): boolean {
  if (version.includes("+")) return true;
  const dash = version.indexOf("-");
  if (dash < 0) return false;
  const pre = version.slice(dash + 1).split("+", 1)[0] ?? "";
  return pre.includes(".");
}

function parseNuGetVersion(raw: string): ParsedVersion {
  const withoutMeta = raw.split("+", 1)[0] ?? raw;
  const dash = withoutMeta.indexOf("-");
  const core = dash >= 0 ? withoutMeta.slice(0, dash) : withoutMeta;
  const pre = dash >= 0 ? withoutMeta.slice(dash + 1) : "";

  const parts = core.split(".");
  const major = toInt(parts[0]);
  const minor = toInt(parts[1]);
  const patch = toInt(parts[2]);
  const revision = toInt(parts[3]);

  return {
    major,
    minor,
    patch,
    revision,
    releaseLabels: pre ? pre.split(".") : [],
    isLegacy: parts.length > 3,
  };
}

function toInt(s: string | undefined): number {
  if (s === undefined || s === "") return 0;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function compareLabel(a: string, b: string): number {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) {
    const diff = Number.parseInt(a, 10) - Number.parseInt(b, 10);
    if (diff !== 0) return diff;
    return 0;
  }
  if (aNum !== bNum) return aNum ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
