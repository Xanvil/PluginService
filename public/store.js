/**
 * 包商店：网格浏览 + 包详情（可选版本切换 README / Release Notes / 安装命令）。
 */

import { renderMarkdown } from "./markdown.js";

const viewList = document.getElementById("view-list");
const viewDetail = document.getElementById("view-detail");
const searchForm = document.getElementById("search-form");
const searchQ = document.getElementById("search-q");
const packageList = document.getElementById("package-list");
const listMeta = document.getElementById("list-meta");
const tagFiltersEl = document.getElementById("tag-filters");
const detailEl = document.getElementById("detail");
const backBtn = document.getElementById("back-btn");
const serviceIndexUrl = document.getElementById("service-index-url");
const serviceIndexLink = document.getElementById("service-index-link");

const indexHref = new URL("/v3/index.json", location.origin).href;
serviceIndexUrl.textContent = indexHref;
serviceIndexLink.href = indexHref;

let debounceTimer = 0;
/** @type {{ q: string, tagsKey: string }} */
let lastListKey = { q: "", tagsKey: "" };
/** @type {string[]} */
let selectedTags = [];
/** @type {string[]} */
let allTags = [];

/** @type {{ pkgId: string, idLower: string, entries: object[], selected: number } | null} */
let detailState = null;

function tagsKeyOf(tags) {
  return [...tags].map((t) => t.toLowerCase()).sort().join("|");
}

/** 商店输入框文本 + 芯片标签 → nuget.org 风格 q */
function buildNuGetQ(text, tags) {
  const parts = [];
  if ((text ?? "").trim()) parts.push(text.trim());
  for (const t of tags) {
    if (t) parts.push(`tags:${t}`);
  }
  return parts.join(" ");
}

/** 从 nuget.org 风格 q 拆出全文词与 tags: */
function splitNuGetQ(q) {
  const tags = [];
  const text = [];
  for (const part of (q ?? "").trim().split(/\s+/)) {
    if (!part) continue;
    const m = /^(?:tags?):(.*)$/i.exec(part);
    if (m && m[1]) tags.push(m[1].toLowerCase());
    else text.push(part);
  }
  return { text: text.join(" "), tags };
}

function listUrl(text, tags) {
  const q = buildNuGetQ(text, tags);
  return q ? `/?q=${encodeURIComponent(q)}` : "/";
}

function parseRoute() {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const m = /^\/packages\/([^/]+)$/i.exec(path);
  if (m) {
    return { view: "detail", id: decodeURIComponent(m[1]) };
  }
  return { view: "list", id: null };
}

function showView(name) {
  viewList.hidden = name !== "list";
  viewDetail.hidden = name !== "detail";
}

async function route() {
  const r = parseRoute();
  if (r.view === "detail" && r.id) {
    showView("detail");
    await renderDetail(r.id);
  } else {
    showView("list");
    detailState = null;
    const params = new URLSearchParams(location.search);
    const parsed = splitNuGetQ(params.get("q") ?? "");
    selectedTags = parsed.tags;
    searchQ.value = parsed.text;
    await ensureTagFilters();
    paintTagFilters();
    await loadList(parsed.text, selectedTags);
  }
}

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = searchQ.value.trim();
  history.pushState({}, "", listUrl(q, selectedTags));
  void loadList(q, selectedTags);
});

searchQ.addEventListener("input", () => {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    const q = searchQ.value.trim();
    history.replaceState({}, "", listUrl(q, selectedTags));
    void loadList(q, selectedTags);
  }, 280);
});

backBtn.addEventListener("click", () => {
  if (history.length > 1) {
    history.back();
  } else {
    history.pushState({}, "", "/");
    void route();
  }
});

window.addEventListener("popstate", () => {
  void route();
});

/**
 * 拉取标签目录并渲染筛选条。
 */
async function ensureTagFilters() {
  if (allTags.length > 0) return;
  try {
    const res = await fetch("/v3/tags");
    if (!res.ok) return;
    const data = await res.json();
    allTags = Array.isArray(data.tags) ? data.tags : [];
  } catch {
    allTags = [];
  }
}

function paintTagFilters() {
  if (!tagFiltersEl) return;
  if (allTags.length === 0) {
    tagFiltersEl.innerHTML = "";
    return;
  }
  tagFiltersEl.innerHTML = allTags
    .map((t) => {
      const active = selectedTags.includes(t.toLowerCase()) ? " is-active" : "";
      return `<button type="button" class="tag-chip${active}" data-tag="${escapeHtml(
        t,
      )}">${escapeHtml(t)}</button>`;
    })
    .join("");

  tagFiltersEl.querySelectorAll(".tag-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tag = (btn.getAttribute("data-tag") || "").toLowerCase();
      if (!tag) return;
      if (selectedTags.includes(tag)) {
        selectedTags = selectedTags.filter((x) => x !== tag);
      } else {
        selectedTags = [...selectedTags, tag];
      }
      const q = searchQ.value.trim();
      history.pushState({}, "", listUrl(q, selectedTags));
      paintTagFilters();
      void loadList(q, selectedTags);
    });
  });
}

/**
 * 网格加载：走 /v3/query，q 为 nuget.org 语法；商店默认含预发布与 SemVer2。
 */
async function loadList(q, tags = selectedTags) {
  const key = { q, tagsKey: tagsKeyOf(tags) };
  lastListKey = key;
  packageList.className = "store-grid";
  packageList.innerHTML = `<li class="muted pad grid-span">加载中…</li>`;
  listMeta.textContent = "";
  try {
    const nugetQ = buildNuGetQ(q, tags);
    const params = new URLSearchParams();
    params.set("q", nugetQ);
    params.set("take", "50");
    params.set("prerelease", "true");
    params.set("semVerLevel", "2.0.0");
    const res = await fetch(`/v3/query?${params}`);
    if (!res.ok) {
      packageList.innerHTML = `<li class="muted pad grid-span">无法加载（${res.status}）</li>`;
      return;
    }
    const data = await res.json();
    if (
      key.q !== lastListKey.q ||
      key.tagsKey !== lastListKey.tagsKey
    ) {
      return;
    }

    const items = Array.isArray(data.data) ? data.data : [];
    const total = data.totalHits ?? items.length;
    const tagHint =
      tags.length > 0 ? ` · 标签 ${tags.map((t) => `「${t}」`).join("")}` : "";
    listMeta.textContent =
      items.length === 0
        ? q || tags.length
          ? `未找到匹配的包${tagHint}`
          : "暂无已发布的包"
        : `共 ${total} 个包${q ? ` · 关键词「${q}」` : ""}${tagHint}`;

    if (items.length === 0) {
      packageList.innerHTML = `<li class="muted pad grid-span">没有可显示的包</li>`;
      return;
    }

    packageList.innerHTML = items
      .map((p) => {
        const id = p.id ?? "";
        const href = `/packages/${encodeURIComponent(id)}`;
        const title = escapeHtml(p.title || id);
        const ver = escapeHtml(p.version ?? "");
        const desc = escapeHtml(p.description || p.summary || "");
        const authors = Array.isArray(p.authors)
          ? p.authors.join(", ")
          : p.authors || "";
        const downloads = Number(p.totalDownloads ?? 0);
        const showTitle = title && title !== escapeHtml(id);
        const iconUrl = p.iconUrl || "";
        const pkgTags = Array.isArray(p.tags) ? p.tags : [];
        const tagsHtml =
          pkgTags.length > 0
            ? `<span class="tile-tags">${pkgTags
                .map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`)
                .join("")}</span>`
            : "";
        const iconHtml = iconUrl
          ? `<img class="tile-icon" src="${escapeHtml(iconUrl)}" alt="" loading="lazy" />`
          : `<span class="tile-icon tile-icon-placeholder" aria-hidden="true">${escapeHtml(
              (id || "?").slice(0, 1).toUpperCase(),
            )}</span>`;
        return `<li>
          <a class="store-tile" href="${href}">
            ${iconHtml}
            <span class="tile-id">${escapeHtml(id)}</span>
            ${showTitle ? `<span class="tile-title">${title}</span>` : ""}
            ${desc ? `<span class="tile-desc">${desc}</span>` : ""}
            ${tagsHtml}
            <span class="tile-foot">
              <span class="store-ver">${ver}</span>
              <span class="store-dl">${downloads} 次</span>
            </span>
            ${
              authors
                ? `<span class="store-meta">${escapeHtml(authors)}</span>`
                : ""
            }
          </a>
        </li>`;
      })
      .join("");

    packageList.querySelectorAll("a.store-tile").forEach((a) => {
      a.addEventListener("click", (ev) => {
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        ev.preventDefault();
        history.pushState({}, "", a.getAttribute("href"));
        void route();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  } catch {
    packageList.innerHTML = `<li class="muted pad grid-span">加载失败</li>`;
  }
}

/**
 * 渲染包详情；默认选中最新版本，可切换。
 */
async function renderDetail(id) {
  detailEl.classList.remove("detail-ready");
  detailEl.innerHTML = `<p class="muted">加载中…</p>`;
  document.title = `${id} — PluginService`;
  detailState = null;

  try {
    const idLower = id.toLowerCase();
    const res = await fetch(
      `/v3/registration/${encodeURIComponent(idLower)}/index.json`,
    );
    if (!res.ok) {
      detailEl.innerHTML = `<p class="status err">未找到包「${escapeHtml(id)}」</p>`;
      return;
    }
    const reg = await res.json();
    const page = reg.items?.[0];
    const leaves = Array.isArray(page?.items) ? page.items : [];
    if (leaves.length === 0) {
      detailEl.innerHTML = `<p class="muted">该包没有可显示的版本</p>`;
      return;
    }

    const entries = leaves.map((leaf) => leaf.catalogEntry ?? {});
    const pkgId = entries[entries.length - 1]?.id || id;

    detailState = {
      pkgId,
      idLower,
      entries,
      selected: entries.length - 1,
    };

    paintDetail();
    detailEl.classList.add("detail-ready");
    bindDetailEvents();
  } catch {
    detailEl.innerHTML = `<p class="status err">加载详情失败</p>`;
  }
}

/** 按 detailState.selected 绘制详情 DOM */
function paintDetail() {
  if (!detailState) return;
  const { pkgId, idLower, entries, selected } = detailState;
  const entry = entries[selected] ?? {};
  const version = entry.version ?? "";
  const authors = entry.authors ?? "";
  const description = entry.description || entry.summary || "";
  const title = entry.title || pkgId;
  const projectUrl = entry.projectUrl || "";
  const releaseNotes = entry.releaseNotes || "";
  const readme = entry.readme || "";
  const iconUrl = entry.iconUrl || "";
  const entryTags = Array.isArray(entry.tags) ? entry.tags : [];
  const vLower = version.toLowerCase();

  const installCmd = `dotnet add package ${pkgId} --version ${version} --source PluginService`;
  const nupkgUrl = `/v3/flatcontainer/${encodeURIComponent(idLower)}/${encodeURIComponent(
    vLower,
  )}/${encodeURIComponent(idLower)}.${encodeURIComponent(vLower)}.nupkg`;

  const versionButtons = entries
    .map((e, i) => {
      const v = e.version ?? "";
      const active = i === selected ? " is-active" : "";
      return `<button type="button" class="ver-btn${active}" data-ver-index="${i}">${escapeHtml(
        v,
      )}</button>`;
    })
    .reverse()
    .join("");

  const depsHtml = formatDepsHtml(entry.dependencyGroups);

  const installSection = `
    <section class="doc-section install-section" aria-labelledby="install-heading">
      <h2 id="install-heading" class="detail-h2">安装（${escapeHtml(version)}）</h2>
      <div class="install-panel">
        <div class="install-block">
          <pre class="install-cmd"><code id="install-cmd">${escapeHtml(
            installCmd,
          )}</code></pre>
          <button type="button" id="copy-btn" class="ghost">复制命令</button>
        </div>
        <p class="aside-hint">
          需先添加源：
          <code>dotnet nuget add source ${escapeHtml(
            indexHref,
          )} -n PluginService</code>
        </p>
      </div>
    </section>`;

  const readmeSection = readme
    ? `<section class="doc-section" aria-labelledby="readme-heading">
        <h2 id="readme-heading" class="detail-h2">README</h2>
        <div class="md-body doc-panel">${renderMarkdown(readme)}</div>
      </section>`
    : `<section class="doc-section">
        <h2 class="detail-h2">README</h2>
        <p class="muted">无</p>
      </section>`;

  const releaseSection = releaseNotes
    ? `<section class="doc-section" aria-labelledby="rn-heading">
        <h2 id="rn-heading" class="detail-h2">Release Notes（${escapeHtml(
          version,
        )}）</h2>
        <div class="md-body doc-panel">${renderMarkdown(releaseNotes)}</div>
      </section>`
    : `<section class="doc-section">
        <h2 class="detail-h2">Release Notes</h2>
        <p class="muted">无</p>
      </section>`;

  const showTitle = title && title !== pkgId;
  const iconHtml = iconUrl
    ? `<img class="detail-icon" src="${escapeHtml(iconUrl)}" alt="" />`
    : `<span class="detail-icon detail-icon-placeholder" aria-hidden="true">${escapeHtml(
        (pkgId || "?").slice(0, 1).toUpperCase(),
      )}</span>`;

  detailEl.innerHTML = `
    <header class="detail-head detail-head-row">
      ${iconHtml}
      <div class="detail-head-text">
        <h1 class="detail-id">${escapeHtml(pkgId)}</h1>
        ${showTitle ? `<p class="detail-title">${escapeHtml(title)}</p>` : ""}
        <p class="store-meta">${escapeHtml(authors)}${
          authors ? " · " : ""
        }选中 ${escapeHtml(version)}</p>
        ${
          entryTags.length
            ? `<p class="detail-tags">${entryTags
                .map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`)
                .join("")}</p>`
            : ""
        }
        ${
          description
            ? `<p class="detail-desc">${escapeHtml(description)}</p>`
            : ""
        }
      </div>
    </header>
    <div class="detail-layout">
      <div class="detail-main">
        ${installSection}
        ${readmeSection}
        ${releaseSection}
      </div>
      <aside class="detail-aside" aria-label="版本与依赖">
        <div class="aside-panel aside-meta-panel">
          ${
            projectUrl
              ? `<p class="aside-meta"><a href="${escapeHtml(
                  projectUrl,
                )}" target="_blank" rel="noopener noreferrer">项目主页</a></p>`
              : ""
          }
          <p class="detail-actions">
            <a class="btn-link" id="download-nupkg" href="${nupkgUrl}">下载此版本 .nupkg</a>
          </p>
        </div>
        <div class="aside-panel aside-versions">
          <h2 class="detail-h2">选择版本</h2>
          <div class="ver-picker" role="listbox" aria-label="版本列表">${versionButtons}</div>
        </div>
        ${
          depsHtml
            ? `<div class="aside-panel aside-deps">
                <h2 class="detail-h2">依赖</h2>
                <div class="deps-panel">${depsHtml}</div>
              </div>`
            : ""
        }
      </aside>
    </div>
  `;
}

function bindDetailEvents() {
  const copyBtn = document.getElementById("copy-btn");
  copyBtn?.addEventListener("click", async () => {
    if (!detailState) return;
    const entry = detailState.entries[detailState.selected] ?? {};
    const version = entry.version ?? "";
    const cmd = `dotnet add package ${detailState.pkgId} --version ${version} --source PluginService`;
    try {
      await navigator.clipboard.writeText(cmd);
      copyBtn.textContent = "已复制";
      setTimeout(() => {
        copyBtn.textContent = "复制命令";
      }, 1500);
    } catch {
      copyBtn.textContent = "复制失败";
    }
  });

  detailEl.querySelectorAll(".ver-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!detailState) return;
      const idx = Number(btn.getAttribute("data-ver-index"));
      if (!Number.isFinite(idx) || idx === detailState.selected) return;
      detailState.selected = idx;
      paintDetail();
      bindDetailEvents();
    });
  });
}

/**
 * 依赖按目标框架分组，每条依赖单独一行。
 */
function formatDepsHtml(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return "";
  const blocks = [];
  for (const g of groups) {
    const deps = Array.isArray(g.dependencies) ? g.dependencies : [];
    if (deps.length === 0) continue;
    const tfm = g.targetFramework
      ? `<div class="deps-tfm">${escapeHtml(g.targetFramework)}</div>`
      : "";
    const items = deps
      .map((d) => {
        const range = d.range ? ` ${escapeHtml(d.range)}` : "";
        return `<li><code>${escapeHtml(d.id)}</code>${range}</li>`;
      })
      .join("");
    blocks.push(`${tfm}<ul class="deps-list">${items}</ul>`);
  }
  return blocks.join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

void route();
