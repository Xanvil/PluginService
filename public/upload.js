/**
 * 上传页：multipart PUT /v3/package。
 */

const form = document.getElementById("upload-form");
const apiKeyInput = document.getElementById("api-key");
const fileInput = document.getElementById("package-file");
const fileNameEl = document.getElementById("file-name");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const serviceIndexUrl = document.getElementById("service-index-url");
const serviceIndexLink = document.getElementById("service-index-link");

const indexHref = new URL("/v3/index.json", location.origin).href;
serviceIndexUrl.textContent = indexHref;
serviceIndexLink.href = indexHref;

const KEY_STORAGE = "pluginService.nugetApiKey";

try {
  const saved = sessionStorage.getItem(KEY_STORAGE);
  if (saved) apiKeyInput.value = saved;
} catch {
  // ignore
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileNameEl.textContent = file ? file.name : "未选择文件";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("");

  const apiKey = apiKeyInput.value.trim();
  const file = fileInput.files?.[0];
  if (!apiKey) {
    setStatus("请填写 API Key", "err");
    return;
  }
  if (!file) {
    setStatus("请选择 .nupkg 文件", "err");
    return;
  }
  if (!file.name.toLowerCase().endsWith(".nupkg")) {
    setStatus("文件扩展名必须是 .nupkg", "err");
    return;
  }

  try {
    sessionStorage.setItem(KEY_STORAGE, apiKey);
  } catch {
    // ignore
  }

  const body = new FormData();
  body.append("package", file, file.name);

  submitBtn.disabled = true;
  setStatus("正在上传…");

  try {
    const res = await fetch("/v3/package", {
      method: "PUT",
      headers: {
        "X-NuGet-ApiKey": apiKey,
      },
      body,
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        payload.error || payload.message || `上传失败（${res.status}）`;
      setStatus(msg, "err");
      return;
    }

    const id = payload.id ?? "?";
    const version = payload.version ?? "?";
    setStatus(`已发布 ${id} ${version} — 可在商店中查看`, "ok");
    fileInput.value = "";
    fileNameEl.textContent = "未选择文件";
  } catch (e) {
    setStatus(e instanceof Error ? e.message : "网络错误", "err");
  } finally {
    submitBtn.disabled = false;
  }
});

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.classList.remove("ok", "err");
  if (kind) statusEl.classList.add(kind);
}
