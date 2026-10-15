/**
 * 管理页：API Key 门禁 + 上传预览 + 发布 + 列表硬删除。
 * 与 CLI 共用 NUGET_API_KEY；请求头为 X-NuGet-ApiKey。
 */

import { renderMarkdown } from "./markdown.js";

const KEY_STORAGE = "pluginService.nugetApiKey";

const gatePanel = document.getElementById("gate-panel");
const gateForm = document.getElementById("gate-form");
const accessKeyInput = document.getElementById("access-key");
const gateBtn = document.getElementById("gate-btn");
const logoutBtn = document.getElementById("logout-btn");
const gateStatus = document.getElementById("gate-status");
const adminBody = document.getElementById("admin-body");

const uploadForm = document.getElementById("upload-form");
const fileInput = document.getElementById("package-file");
const fileNameEl = document.getElementById("file-name");
const submitBtn = document.getElementById("submit-btn");
const uploadStatus = document.getElementById("upload-status");
const previewStatus = document.getElementById("preview-status");
const previewPanel = document.getElementById("preview-panel");

const previewIcon = document.getElementById("preview-icon");
const previewIdver = document.getElementById("preview-idver");
const previewTitle = document.getElementById("preview-title");
const previewConflict = document.getElementById("preview-conflict");
const previewAuthors = document.getElementById("preview-authors");
const previewSize = document.getElementById("preview-size");
const previewProject = document.getElementById("preview-project");
const previewTags = document.getElementById("preview-tags");
const previewDescription = document.getElementById("preview-description");
const previewDepsWrap = document.getElementById("preview-deps-wrap");
const previewDeps = document.getElementById("preview-deps");
const previewNotesWrap = document.getElementById("preview-notes-wrap");
const previewNotes = document.getElementById("preview-notes");
const previewReadmeWrap = document.getElementById("preview-readme-wrap");
const previewReadme = document.getElementById("preview-readme");

const listSearchForm = document.getElementById("list-search-form");
const listQ = document.getElementById("list-q");
const listStatus = document.getElementById("list-status");
const packageList = document.getElementById("package-list");

const serviceIndexUrl = document.getElementById("service-index-url");
const serviceIndexLink = document.getElementById("service-index-link");

const indexHref = new URL("/v3/index.json", location.origin).href;
serviceIndexUrl.textContent = indexHref;
serviceIndexLink.href = indexHref;

/** 预览成功后才允许发布 */
let previewOk = false;
/** 用于取消过期的预览请求 */
let previewSeq = 0;

/** @returns {string} */
function getAccessKey() {
  return (accessKeyInput.value || "").trim();
}

/** @param {HTMLElement} el @param {string} text @param {"ok"|"err"|undefined} kind */
function setStatusEl(el, text, kind) {
  el.textContent = text;
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

function setGateStatus(text, kind) {
  setStatusEl(gateStatus, text, kind);
}
function setUploadStatus(text, kind) {
  setStatusEl(uploadStatus, text, kind);
}
function setPreviewStatus(text, kind) {
  setStatusEl(previewStatus, text, kind);
}
function setListStatus(text, kind) {
  setStatusEl(listStatus, text, kind);
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function adminFetch(path, init = {}) {
  const key = getAccessKey();
  if (!key) {
    throw new Error("请先填写 API Key");
  }
  const headers = new Headers(init.headers || {});
  headers.set("X-NuGet-ApiKey", key);
  return fetch(path, { ...init, headers });
}

function showUnlocked(unlocked) {
  adminBody.hidden = !unlocked;
  logoutBtn.hidden = !unlocked;
  gateBtn.textContent = unlocked ? "重新验证" : "进入管理";
  if (unlocked) {
    gatePanel.classList.add("gate-unlocked");
  } else {
    gatePanel.classList.remove("gate-unlocked");
  }
}

function clearPreview() {
  previewOk = false;
  submitBtn.disabled = true;
  previewPanel.hidden = true;
  setPreviewStatus("");
  previewIcon.hidden = true;
  previewIcon.removeAttribute("src");
  previewConflict.hidden = true;
  previewDepsWrap.hidden = true;
  previewNotesWrap.hidden = true;
  previewReadmeWrap.hidden = true;
  previewDeps.innerHTML = "";
  previewNotes.innerHTML = "";
  previewReadme.innerHTML = "";
}

/** @param {number} n */
function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 将预览 API 结果渲染到面板。
 * @param {Record<string, unknown>} data
 */
function renderPreview(data) {
  previewPanel.hidden = false;
  previewIdver.textContent = `${data.id} ${data.version}`;
  previewTitle.textContent = data.title && data.title !== data.id ? String(data.title) : "";
  previewAuthors.textContent = data.authors ? String(data.authors) : "—";
  previewSize.textContent = formatBytes(Number(data.sizeBytes));
  previewDescription.textContent = data.description
    ? String(data.description)
    : "—";

  if (data.projectUrl) {
    previewProject.innerHTML = "";
    const a = document.createElement("a");
    a.href = String(data.projectUrl);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = String(data.projectUrl);
    previewProject.appendChild(a);
  } else {
    previewProject.textContent = "—";
  }

  const tags = Array.isArray(data.tags) ? data.tags : [];
  previewTags.textContent = tags.length ? tags.join(", ") : "—";

  if (data.iconDataUrl) {
    previewIcon.src = String(data.iconDataUrl);
    previewIcon.hidden = false;
  } else {
    previewIcon.hidden = true;
    previewIcon.removeAttribute("src");
  }

  if (data.alreadyExists) {
    previewConflict.hidden = false;
    previewConflict.textContent = `源中已存在 ${data.id} ${data.version}，发布将失败（409）。`;
    previewOk = false;
    submitBtn.disabled = true;
  } else {
    previewConflict.hidden = true;
    previewOk = true;
    submitBtn.disabled = false;
  }

  const groups = Array.isArray(data.dependencyGroups)
    ? data.dependencyGroups
    : [];
  previewDeps.innerHTML = "";
  let hasDep = false;
  for (const g of groups) {
    const deps = Array.isArray(g.dependencies) ? g.dependencies : [];
    if (deps.length === 0 && !g.targetFramework) continue;
    hasDep = true;
    const li = document.createElement("li");
    if (g.targetFramework) {
      const tfm = document.createElement("div");
      tfm.className = "tfm";
      tfm.textContent = g.targetFramework;
      li.appendChild(tfm);
    }
    for (const d of deps) {
      const row = document.createElement("div");
      const code = document.createElement("code");
      code.textContent = d.range ? `${d.id} ${d.range}` : d.id;
      row.appendChild(code);
      li.appendChild(row);
    }
    if (deps.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "（无依赖）";
      li.appendChild(empty);
    }
    previewDeps.appendChild(li);
  }
  previewDepsWrap.hidden = !hasDep;

  // Release Notes：始终展示区块，便于确认是否解析到
  previewNotesWrap.hidden = false;
  if (data.releaseNotes && String(data.releaseNotes).trim()) {
    previewNotes.innerHTML = renderMarkdown(String(data.releaseNotes));
  } else {
    previewNotes.innerHTML = `<p class="muted">无</p>`;
  }

  if (data.readme) {
    previewReadmeWrap.hidden = false;
    previewReadme.innerHTML = renderMarkdown(String(data.readme));
  } else {
    previewReadmeWrap.hidden = true;
    previewReadme.innerHTML = "";
  }
}

/** @param {File} file */
async function previewFile(file) {
  const seq = ++previewSeq;
  clearPreview();
  setPreviewStatus("正在解析包…");

  const body = new FormData();
  body.append("package", file, file.name);

  try {
    const res = await adminFetch("/admin/api/preview", {
      method: "POST",
      body,
    });
    if (seq !== previewSeq) return;
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPreviewStatus(payload.error || `解析失败（${res.status}）`, "err");
      return;
    }
    renderPreview(payload);
    setPreviewStatus(
      payload.alreadyExists
        ? "预览完成（版本冲突，无法发布）"
        : "预览完成，可发布",
      payload.alreadyExists ? "err" : "ok",
    );
  } catch (e) {
    if (seq !== previewSeq) return;
    setPreviewStatus(e instanceof Error ? e.message : "网络错误", "err");
  }
}

async function unlock() {
  const key = getAccessKey();
  if (!key) {
    setGateStatus("请填写 API Key", "err");
    showUnlocked(false);
    return false;
  }

  setGateStatus("正在验证…");
  try {
    const res = await adminFetch("/admin/api/packages?take=1");
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setGateStatus(payload.error || `验证失败（${res.status}）`, "err");
      showUnlocked(false);
      return false;
    }
    try {
      sessionStorage.setItem(KEY_STORAGE, key);
    } catch {
      // ignore
    }
    setGateStatus("已解锁管理功能", "ok");
    showUnlocked(true);
    await refreshList();
    return true;
  } catch (e) {
    setGateStatus(e instanceof Error ? e.message : "网络错误", "err");
    showUnlocked(false);
    return false;
  }
}

async function refreshList() {
  const q = listQ.value.trim();
  setListStatus("加载中…");
  packageList.innerHTML = "";

  try {
    const url = new URL("/admin/api/packages", location.origin);
    if (q) url.searchParams.set("q", q);
    url.searchParams.set("take", "100");
    const res = await adminFetch(url.pathname + url.search);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setListStatus(payload.error || `加载失败（${res.status}）`, "err");
      return;
    }

    const packages = payload.packages || [];
    if (packages.length === 0) {
      setListStatus("暂无包", "ok");
      return;
    }

    setListStatus(`共 ${packages.length} 个包`);
    for (const pkg of packages) {
      packageList.appendChild(renderPackageCard(pkg));
    }
  } catch (e) {
    setListStatus(e instanceof Error ? e.message : "网络错误", "err");
  }
}

/**
 * @param {{ id: string, latestVersion: string, versions: string[], updatedAt: string }} pkg
 */
function renderPackageCard(pkg) {
  const card = document.createElement("article");
  card.className = "admin-pkg";
  card.dataset.id = pkg.id;

  const head = document.createElement("div");
  head.className = "admin-pkg-head";

  const title = document.createElement("div");
  title.className = "admin-pkg-title";
  const link = document.createElement("a");
  link.href = `/packages/${encodeURIComponent(pkg.id)}`;
  link.textContent = pkg.id;
  title.appendChild(link);
  const meta = document.createElement("span");
  meta.className = "admin-pkg-meta";
  meta.textContent = `最新 ${pkg.latestVersion}`;
  title.appendChild(meta);

  const delPkgBtn = document.createElement("button");
  delPkgBtn.type = "button";
  delPkgBtn.className = "btn-danger";
  delPkgBtn.textContent = "删除整包";
  delPkgBtn.addEventListener("click", () => deletePackage(pkg.id));

  head.appendChild(title);
  head.appendChild(delPkgBtn);
  card.appendChild(head);

  const verList = document.createElement("ul");
  verList.className = "admin-ver-list";
  for (const ver of pkg.versions || []) {
    const li = document.createElement("li");
    const label = document.createElement("code");
    label.textContent = ver;
    const delVerBtn = document.createElement("button");
    delVerBtn.type = "button";
    delVerBtn.className = "btn-ghost btn-sm";
    delVerBtn.textContent = "删除";
    delVerBtn.addEventListener("click", () => deleteVersion(pkg.id, ver));
    li.appendChild(label);
    li.appendChild(delVerBtn);
    verList.appendChild(li);
  }
  card.appendChild(verList);
  return card;
}

/**
 * @param {string} id
 * @param {string} version
 */
async function deleteVersion(id, version) {
  if (!confirm(`硬删除 ${id} ${version}？此操作不可恢复。`)) return;
  setListStatus(`正在删除 ${id} ${version}…`);
  try {
    const path = `/admin/api/packages/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}`;
    const res = await adminFetch(path, { method: "DELETE" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setListStatus(payload.error || `删除失败（${res.status}）`, "err");
      return;
    }
    setListStatus(`已删除 ${id} ${version}`, "ok");
    await refreshList();
  } catch (e) {
    setListStatus(e instanceof Error ? e.message : "网络错误", "err");
  }
}

/** @param {string} id */
async function deletePackage(id) {
  if (!confirm(`硬删除整包 ${id}（全部版本）？此操作不可恢复。`)) return;
  setListStatus(`正在删除整包 ${id}…`);
  try {
    const path = `/admin/api/packages/${encodeURIComponent(id)}`;
    const res = await adminFetch(path, { method: "DELETE" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setListStatus(payload.error || `删除失败（${res.status}）`, "err");
      return;
    }
    setListStatus(`已删除整包 ${id}`, "ok");
    await refreshList();
  } catch (e) {
    setListStatus(e instanceof Error ? e.message : "网络错误", "err");
  }
}

gateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await unlock();
});

logoutBtn.addEventListener("click", () => {
  try {
    sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // ignore
  }
  accessKeyInput.value = "";
  setGateStatus("");
  setUploadStatus("");
  setListStatus("");
  packageList.innerHTML = "";
  fileInput.value = "";
  fileNameEl.textContent = "未选择文件";
  clearPreview();
  showUnlocked(false);
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileNameEl.textContent = file ? file.name : "未选择文件";
  setUploadStatus("");
  clearPreview();

  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".nupkg")) {
    setPreviewStatus("文件扩展名必须是 .nupkg", "err");
    return;
  }
  if (!getAccessKey()) {
    setPreviewStatus("请先解锁管理功能后再预览", "err");
    return;
  }
  await previewFile(file);
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setUploadStatus("");

  const file = fileInput.files?.[0];
  if (!getAccessKey()) {
    setUploadStatus("请先解锁管理功能", "err");
    return;
  }
  if (!file) {
    setUploadStatus("请选择 .nupkg 文件", "err");
    return;
  }
  if (!previewOk) {
    setUploadStatus("请先成功预览包（且无版本冲突）", "err");
    return;
  }

  const body = new FormData();
  body.append("package", file, file.name);

  submitBtn.disabled = true;
  setUploadStatus("正在上传…");

  try {
    const res = await adminFetch("/admin/api/publish", {
      method: "POST",
      body,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setUploadStatus(
        payload.error || payload.message || `上传失败（${res.status}）`,
        "err",
      );
      submitBtn.disabled = !previewOk;
      return;
    }
    const id = payload.id ?? "?";
    const version = payload.version ?? "?";
    setUploadStatus(`已发布 ${id} ${version}`, "ok");
    fileInput.value = "";
    fileNameEl.textContent = "未选择文件";
    clearPreview();
    await refreshList();
  } catch (e) {
    setUploadStatus(e instanceof Error ? e.message : "网络错误", "err");
    submitBtn.disabled = !previewOk;
  }
});

listSearchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await refreshList();
});

clearPreview();

try {
  const saved = sessionStorage.getItem(KEY_STORAGE);
  if (saved) {
    accessKeyInput.value = saved;
    unlock();
  }
} catch {
  // ignore
}
