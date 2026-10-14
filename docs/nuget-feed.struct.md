# PluginService NuGet V3 源结构

## 组件关系

```mermaid
classDiagram
  class WorkerEntry {
    +fetch(request, env, ctx) Response
  }
  class Assets {
    +fetch(request) Response
  }
  class StorePage {
    +list_search_/
    +detail_/packages_id
  }
  class UploadPage {
    +PUT_/v3/package multipart
  }
  class NuGetRouter {
    +handle(request, env) Response
  }
  class PackageRepository {
    +listVersions(id) string[]
    +getPackageObject(id, version) R2ObjectBody
    +getRegistration(id, baseUrl) object
    +search(q, skip, take, baseUrl) object
    +publish(request) object
  }
  class NupkgReader {
    +readMetadata(bytes) PackageMetadata
    +extractNupkgFromRequest(request) Uint8Array
  }
  class ApiKeyAuth {
    +assertPushAuthorized(request, env) void
  }
  class Env {
    +DB D1Database
    +PACKAGES R2Bucket
    +NUGET_API_KEY string
  }

  WorkerEntry --> NuGetRouter : path_/v3
  WorkerEntry --> Assets : other_paths
  Assets --> StorePage : serves_/_packages
  Assets --> UploadPage : serves_/upload
  StorePage --> NuGetRouter : GET_query_registration
  UploadPage --> NuGetRouter : PUT_package
  NuGetRouter --> PackageRepository : uses
  PackageRepository --> NupkgReader : publish
  PackageRepository --> ApiKeyAuth : publish
  PackageRepository --> Env : bindings
```

## 请求流程

```mermaid
flowchart TD
  req[HTTP_Request] --> entry[src/index.ts_fetch]
  entry -->|path_/v3| router[NuGetRouter.handle]
  entry -->|else| assets[ASSETS_public]
  assets --> page[upload_page]
  page -->|PUT_/v3/package| router
  router -->|GET_/v3/index.json| index[ServiceIndex]
  router -->|GET_flatcontainer| flat[listVersions_or_R2_stream]
  router -->|GET_registration| reg[getRegistration]
  router -->|GET_/v3/query| search[search]
  router -->|PUT_/v3/package| pub[publish]
  pub --> auth[assertPushAuthorized]
  auth --> parse[readMetadata]
  parse --> r2[R2_put]
  r2 --> d1[D1_upsert]
```

## 存储布局

```mermaid
flowchart LR
  subgraph d1 [D1]
    packages[packages]
    versions[package_versions]
    packages --> versions
  end
  subgraph r2 [R2]
    obj["packages/id/ver/id.ver.nupkg"]
  end
  versions -->|content_key| obj
```
