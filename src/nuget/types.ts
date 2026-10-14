/**
 * Worker 绑定与 NuGet 领域类型定义。
 */

/** Wrangler 注入的环境绑定与密钥 */
export interface Env {
  /** D1：包与版本元数据 */
  DB: D1Database;
  /** R2：.nupkg 二进制内容 */
  PACKAGES: R2Bucket;
  /** 推送用 API Key（wrangler secret） */
  NUGET_API_KEY: string;
  /** Workers Static Assets（上传页等） */
  ASSETS: Fetcher;
}

/** 从 .nuspec / nupkg 解析出的包元数据 */
export interface PackageMetadata {
  id: string;
  version: string;
  title?: string;
  description?: string;
  authors?: string;
  /** nuspec &lt;releaseNotes&gt; */
  releaseNotes?: string;
  /** nuspec &lt;readme&gt; 指向的文件路径 */
  readmeFile?: string;
  /** 从包内提取的 README 正文（Markdown 等） */
  readme?: string;
  /** nuspec &lt;icon&gt; 包内相对路径 */
  iconFile?: string;
  /** 外部图标 URL（nuspec iconUrl）；无嵌入图标时使用 */
  externalIconUrl?: string;
  /** 发布后写入 R2 的图标对象键 */
  iconKey?: string;
  /** 图标 Content-Type */
  iconContentType?: string;
  projectUrl?: string;
  /** nuspec &lt;tags&gt; 解析后的标签列表 */
  tags: string[];
  dependencyGroups: DependencyGroup[];
}

/** 从 nupkg 解出的嵌入图标 */
export interface ExtractedIcon {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
}

/** 一组依赖（按目标框架） */
export interface DependencyGroup {
  targetFramework?: string;
  dependencies: PackageDependency[];
}

/** 单个包依赖 */
export interface PackageDependency {
  id: string;
  range?: string;
}

/** D1 packages 表行 */
export interface PackageRow {
  id: string;
  id_lower: string;
  title: string | null;
  description: string | null;
  authors: string | null;
  latest_version: string;
  listed: number;
  downloads: number;
  updated_at: string;
  /** 空格分隔小写标签 */
  tags: string | null;
}

/** D1 package_versions 表行 */
export interface VersionRow {
  id_lower: string;
  version: string;
  version_lower: string;
  nuspec_json: string;
  content_key: string;
  listed: number;
  created_at: string;
}

/** publish 失败时的结构化错误 */
export class PublishError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PublishError";
  }
}
