/**
 * 管理页：API Key 门禁 + 上传 + 列表硬删除。
 * 与 CLI 共用 NUGET_API_KEY；请求头为 X-NuGet-ApiKey。
 */

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

const listSearchForm = document.getElementById("list-search-form");
const listQ = document.getElementById("list-q");
const listStatus = document.getElementById("list-status");
const packageList = document.getElementById("package-list");

const serviceIndexUrl = document.getElementById("service-index-url");
const serviceIndexLink = document.getElementById("service-index-link");

const indexHref = new URL("/v3/index.json", location.origin).href;
serviceIndexUrl.textContent = indexHref;
serviceIndexLink.href = indexHref;

/** @returns {string} */
function getAccessKey() {
  return (accessKeyInput.value || "").trim();
}

/** @param {string} text @param {"ok"|"err"|undefined} kind */
function setGateStatus(text, kind) {
  gateStatus.textContent = text;
  gateStatus.classList.remove("ok", "err");
  if (kind) gateStatus.classList.add(kind);
}

/** @param {string} text @param {"ok"|"err"|undefined} kind */
function setUploadStatus(text, kind) {
  uploadStatus.textContent = text;
  uploadStatus.classList.remove("ok", "err");
  if (kind) uploadStatus.classList.add(kind);
}

/** @param {string} text @param {"ok"|"err"|undefined} kind */
function setListStatus(text, kind) {
  listStatus.textContent = text;
  listStatus.classList.remove("ok", "err");
  if (kind) listStatus.classList.add(kind);
}

/**
 * 带访问密钥发起管理 API 请求。
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function adminFetch(path, init = {}) {
  const key = getAccessKey();
  if (!key) {
    throw new Error("请先填写访问密钥");
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

/** 用列表接口验证密钥是否有效 */
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
  showUnlocked(false);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileNameEl.textContent = file ? file.name : "未选择文件";
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
  if (!file.name.toLowerCase().endsWith(".nupkg")) {
    setUploadStatus("文件扩展名必须是 .nupkg", "err");
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
      return;
    }
    const id = payload.id ?? "?";
    const version = payload.version ?? "?";
    setUploadStatus(`已发布 ${id} ${version}`, "ok");
    fileInput.value = "";
    fileNameEl.textContent = "未选择文件";
    await refreshList();
  } catch (e) {
    setUploadStatus(e instanceof Error ? e.message : "网络错误", "err");
  } finally {
    submitBtn.disabled = false;
  }
});

listSearchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await refreshList();
});

// 启动：若 sessionStorage 有密钥则自动验证
try {
  const saved = sessionStorage.getItem(KEY_STORAGE);
  if (saved) {
    accessKeyInput.value = saved;
    unlock();
  }
} catch {
  // ignore
}
