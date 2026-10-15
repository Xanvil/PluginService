/**
 * 管理页：API Key 门禁 + 上传预览 + 发布 + 列表硬删除。
 * 请求带超时与可取消；预览 Markdown 异步渲染，避免主线程长时间卡住。
 */

import { renderMarkdown } from "./markdown.js";

const KEY_STORAGE = "pluginService.nugetApiKey";
/** 预览 / 发布超时（大包解压可能较慢） */
const UPLOAD_TIMEOUT_MS = 90_000;
/** 列表等轻量请求超时 */
const LIGHT_TIMEOUT_MS = 20_000;

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
const cancelBusyBtn = document.getElementById("cancel-busy-btn");

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
/** 用于丢弃过期预览结果 */
let previewSeq = 0;
/** 当前可取消的请求 */
let activeAbort = null;
/** 忙态心跳定时器 */
let busyTimer = null;
let busyStartedAt = 0;
let busyLabel = "";

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
 * 进入/退出忙态：禁用交互、显示取消、心跳提示避免「假死」。
 * @param {boolean} busy
 * @param {string} [label]
 * @param {(s: string) => void} [statusSetter]
 */
function setBusy(busy, label = "", statusSetter = setPreviewStatus) {
  if (busyTimer) {
    clearInterval(busyTimer);
    busyTimer = null;
  }

  if (!busy) {
    document.body.classList.remove("is-admin-busy");
    cancelBusyBtn.hidden = true;
    fileInput.disabled = false;
    busyLabel = "";
    return;
  }

  document.body.classList.add("is-admin-busy");
  cancelBusyBtn.hidden = false;
  fileInput.disabled = true;
  busyLabel = label || "处理中";
  busyStartedAt = Date.now();
  statusSetter(`${busyLabel}…`);
  busyTimer = setInterval(() => {
    const sec = Math.round((Date.now() - busyStartedAt) / 1000);
    statusSetter(`${busyLabel}…（已等待 ${sec}s）`);
  }, 1000);
}

/** 仅中止进行中的 fetch，不改 previewSeq / 忙态 */
function abortInFlight() {
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }
}

/** 用户取消或切换文件：中止请求并作废未完成的预览序号 */
function cancelActive() {
  abortInFlight();
  previewSeq += 1;
  setBusy(false);
}

/**
 * 带超时与 AbortSignal 的管理 API 请求。
 * 新请求会中止上一个 in-flight fetch，但不会作废 previewSeq。
 * @param {string} path
 * @param {RequestInit & { timeoutMs?: number }} [init]
 */
async function adminFetch(path, init = {}) {
  const key = getAccessKey();
  if (!key) {
    throw new Error("请先填写 API Key");
  }

  const timeoutMs = init.timeoutMs ?? LIGHT_TIMEOUT_MS;
  const headers = new Headers(init.headers || {});
  headers.set("X-NuGet-ApiKey", key);

  abortInFlight();
  const controller = new AbortController();
  activeAbort = controller;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { timeoutMs: _t, signal: _s, ...rest } = init;
    const res = await fetch(path, {
      ...rest,
      headers,
      signal: controller.signal,
    });
    return res;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(`请求超时或已取消（>${Math.round(timeoutMs / 1000)}s）`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (activeAbort === controller) activeAbort = null;
  }
}

/** 让出主线程，避免大段 Markdown 渲染卡死 UI */
function yieldToUi() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * @param {HTMLElement} el
 * @param {string | null | undefined} md
 * @param {boolean} [truncated]
 */
async function renderMdDeferred(el, md, truncated) {
  await yieldToUi();
  if (!md || !String(md).trim()) {
    el.innerHTML = `<p class="muted">无</p>`;
    return;
  }
  el.innerHTML = renderMarkdown(String(md));
  if (truncated) {
    const tip = document.createElement("p");
    tip.className = "muted";
    tip.textContent = "（预览已截断，完整内容发布后可在商店查看）";
    el.appendChild(tip);
  }
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
 * @param {Record<string, unknown>} data
 */
async function renderPreview(data) {
  previewPanel.hidden = false;
  previewIdver.textContent = `${data.id} ${data.version}`;
  previewTitle.textContent =
    data.title && data.title !== data.id ? String(data.title) : "";
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

  previewNotesWrap.hidden = false;
  previewReadmeWrap.hidden = false;
  previewNotes.innerHTML = `<p class="muted">渲染中…</p>`;
  previewReadme.innerHTML = `<p class="muted">渲染中…</p>`;

  await renderMdDeferred(
    previewNotes,
    data.releaseNotes ? String(data.releaseNotes) : null,
    !!data.releaseNotesTruncated,
  );
  await renderMdDeferred(
    previewReadme,
    data.readme ? String(data.readme) : null,
    !!data.readmeTruncated,
  );
  if (!data.readme) {
    previewReadmeWrap.hidden = true;
  }
}

/** @param {File} file */
async function previewFile(file) {
  const seq = ++previewSeq;
  clearPreview();
  setBusy(true, "正在上传并解析", setPreviewStatus);

  const body = new FormData();
  body.append("package", file, file.name);

  try {
    const res = await adminFetch("/admin/api/preview", {
      method: "POST",
      body,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
    if (seq !== previewSeq) return;

    setPreviewStatus("正在解析响应…");
    const payload = await res.json().catch(() => ({}));
    if (seq !== previewSeq) return;

    if (!res.ok) {
      setBusy(false);
      setPreviewStatus(payload.error || `解析失败（${res.status}）`, "err");
      return;
    }

    setPreviewStatus("正在渲染预览…");
    await renderPreview(payload);
    if (seq !== previewSeq) return;

    setBusy(false);
    setPreviewStatus(
      payload.alreadyExists
        ? "预览完成（版本冲突，无法发布）"
        : "预览完成，可发布",
      payload.alreadyExists ? "err" : "ok",
    );
  } catch (e) {
    if (seq !== previewSeq) return;
    setBusy(false);
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

  setBusy(true, "正在验证", setGateStatus);
  try {
    const res = await adminFetch("/admin/api/packages?take=1", {
      timeoutMs: LIGHT_TIMEOUT_MS,
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(false);
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
    setBusy(false);
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
    const res = await adminFetch(url.pathname + url.search, {
      timeoutMs: LIGHT_TIMEOUT_MS,
    });
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
  setBusy(true, `正在删除 ${id} ${version}`, setListStatus);
  try {
    const path = `/admin/api/packages/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}`;
    const res = await adminFetch(path, {
      method: "DELETE",
      timeoutMs: LIGHT_TIMEOUT_MS,
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setListStatus(payload.error || `删除失败（${res.status}）`, "err");
      return;
    }
    setListStatus(`已删除 ${id} ${version}`, "ok");
    await refreshList();
  } catch (e) {
    setBusy(false);
    setListStatus(e instanceof Error ? e.message : "网络错误", "err");
  }
}

/** @param {string} id */
async function deletePackage(id) {
  if (!confirm(`硬删除整包 ${id}（全部版本）？此操作不可恢复。`)) return;
  setBusy(true, `正在删除整包 ${id}`, setListStatus);
  try {
    const path = `/admin/api/packages/${encodeURIComponent(id)}`;
    const res = await adminFetch(path, {
      method: "DELETE",
      timeoutMs: LIGHT_TIMEOUT_MS,
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setListStatus(payload.error || `删除失败（${res.status}）`, "err");
      return;
    }
    setListStatus(`已删除整包 ${id}`, "ok");
    await refreshList();
  } catch (e) {
    setBusy(false);
    setListStatus(e instanceof Error ? e.message : "网络错误", "err");
  }
}

gateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await unlock();
});

cancelBusyBtn.addEventListener("click", () => {
  cancelActive();
  setPreviewStatus("已取消", "err");
  setUploadStatus("");
  submitBtn.disabled = !previewOk;
});

logoutBtn.addEventListener("click", () => {
  cancelActive();
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
  cancelActive();
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
  setBusy(true, "正在发布", setUploadStatus);

  try {
    const res = await adminFetch("/admin/api/publish", {
      method: "POST",
      body,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(false);
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
    setBusy(false);
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
