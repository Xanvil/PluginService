# PluginService — Cloudflare 私有 NuGet V3 源

基于 **Cloudflare Workers + R2 + D1** 的个人/小团队 NuGet 源：

- 拉取（restore / `dotnet add package`）公开
- 推送（`dotnet nuget push` 或网页上传）需要 `X-NuGet-ApiKey`
- 协议：NuGet V3（Service Index、Flat Container、Registration、Search、PackagePublish）
- 根路径 `/`：包商店（搜索 / 浏览 / 详情）
- `/upload`：手动上传管理页

## 快速使用

部署成功后（将 `<host>` 换成 Worker 域名）：

```bash
# 浏览器打开包商店
# https://<host>/
# 包详情：https://<host>/packages/{PackageId}
# 上传页：https://<host>/upload

# 添加源
dotnet nuget add source https://<host>/v3/index.json -n PluginService

# 推送（CLI）
dotnet nuget push My.Lib.1.0.0.nupkg --source PluginService --api-key <你的密钥>

# 引用
dotnet add package My.Lib --source PluginService
dotnet restore
```

`nuget.config` 示例：

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="PluginService" value="https://<host>/v3/index.json" />
  </packageSources>
</configuration>
```

## 本地开发

```bash
npm install

# 本地 D1 迁移
npm run db:migrate:local

# 本地密钥（.dev.vars，勿提交）
# 文件内容示例：
# NUGET_API_KEY=dev-secret-key

npx wrangler dev
```

本地验证：

```bash
# 商店：http://127.0.0.1:8787/  上传：http://127.0.0.1:8787/upload
curl http://127.0.0.1:8787/v3/index.json

dotnet nuget push .\My.Lib.1.0.0.nupkg \
  --source http://127.0.0.1:8787/v3/index.json \
  --api-key dev-secret-key
```

网页商店：打开 `/` 搜索与浏览包，进入详情可复制 `dotnet add package` 命令、查看 **README / Release Notes**、下载 `.nupkg`。  
网页上传：打开 `/upload` → 填写 API Key → 选择 `.nupkg` → 上传（`PUT /v3/package`）。

打包时若希望详情页显示文档与图标，请在工程中配置：

```xml
<!-- 示例：Directory.Build.props / csproj -->
<PropertyGroup>
  <PackageReadmeFile>README.md</PackageReadmeFile>
  <PackageReleaseNotes>修复若干问题</PackageReleaseNotes>
  <PackageIcon>images/icon.png</PackageIcon>
</PropertyGroup>
<ItemGroup>
  <None Include="README.md" Pack="true" PackagePath="\" />
  <None Include="images\icon.png" Pack="true" PackagePath="\" />
</ItemGroup>
```

图标在 **发布时** 提取并写入 R2，商店网格与详情页通过 `/v3/flatcontainer/{id}/{ver}/icon` 访问；旧包需重新 push 后才有图标。

### 搜索（对齐 nuget.org）

`GET /v3/query` 支持 nuget.org 相同的查询语法与参数：

| 参数 | 说明 |
|------|------|
| `q` | 搜索串；支持 `id:` / `packageid:` / `tags:` / `author:` / `title:` / `description:` / `summary:` / `version:` |
| `prerelease` | 默认排除预发布；`true` 包含 |
| `semVerLevel` | 默认仅 SemVer1；`2.0.0` 包含 SemVer2 |
| `packageType` | 按包类型过滤（未声明类型视为 `Dependency`） |

示例：

```
/v3/query?q=tags:plugin%20id:Corel&prerelease=true&semVerLevel=2.0.0
/v3/query?q=packageid:My.Lib
```

多条件为 **AND**。未知属性（如 `invalid:foo`）会被忽略。  
商店标签芯片会转换为 `tags:` 写入 `q`。标签目录：`GET /v3/tags`。

打包标签：

```xml
<PropertyGroup>
  <PackageTags>plugin;coreldraw;extension</PackageTags>
</PropertyGroup>
```

## 首次远程部署

1. 创建 D1，并把返回的 `database_id` 写入 [`wrangler.toml`](wrangler.toml)：

   ```bash
   npx wrangler d1 create plugin-nuget
   ```

2. 创建 R2 bucket（若尚未存在）：

   ```bash
   npx wrangler r2 bucket create plugin-nuget-packages
   ```

3. 应用远程迁移并设置密钥：

   ```bash
   npm run db:migrate:remote
   npx wrangler secret put NUGET_API_KEY
   npm run deploy
   ```

## API 一览

| 资源 | 方法 / 路径 |
|------|-------------|
| Service Index | `GET /v3/index.json` |
| 版本列表 | `GET /v3/flatcontainer/{id}/index.json` |
| 下载包 | `GET /v3/flatcontainer/{id}/{ver}/{id}.{ver}.nupkg` |
| Registration | `GET /v3/registration/{id}/index.json` |
| Search | `GET /v3/query?q=&skip=&take=` |
| Publish | `PUT /v3/package`（Header: `X-NuGet-ApiKey`） |

## 核心类型

| 类型 | 对外方法 | 用途 |
|------|----------|------|
| Worker `fetch` | `src/index.ts` | `/v3/*` → API；其它 → `ASSETS` 静态页 |
| `NuGetRouter` | `handle` | 协议路由 |
| `PackageRepository` | `listVersions` / `getPackageObject` / `getRegistration` / `search` / `publish` | D1+R2 数据访问 |
| `readMetadata` 等 | `nupkg.ts` | 解析 `.nupkg` / multipart |
| `assertPushAuthorized` | `auth.ts` | 推送鉴权 |
| 包商店 | `public/index.html` + `store.js` | 搜索、列表、详情、安装命令 |
| 上传页 | `public/upload.html` + `upload.js` | 浏览器手动发布 |

结构图见 [docs/nuget-feed.struct.md](docs/nuget-feed.struct.md)。

## 测试

```bash
npm test
```

## 范围说明

当前不包含：符号包 `.snupkg`、删除/unlist、网页管理台。自定义域名可在 Cloudflare Dashboard 为 Worker 绑定。
