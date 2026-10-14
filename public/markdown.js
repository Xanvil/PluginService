/**
 * 轻量 Markdown → HTML（标题、列表、代码块、链接、粗斜体、段落）。
 * 输出均经转义，避免 XSS。
 */

/**
 * @param {string} src
 * @returns {string} HTML
 */
export function renderMarkdown(src) {
  if (!src || !String(src).trim()) return "";
  const lines = String(src).replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let i = 0;
  let inCode = false;
  let codeLang = "";
  let codeBuf = [];
  let listType = null; // "ul" | "ol"
  let para = [];

  const flushPara = () => {
    if (para.length === 0) return;
    html.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };

  const flushList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (inCode) {
      if (/^```/.test(line)) {
        html.push(
          `<pre class="md-code"><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`,
        );
        inCode = false;
        codeBuf = [];
        codeLang = "";
      } else {
        codeBuf.push(line);
      }
      i++;
      continue;
    }

    const fence = /^```([\w-]*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      flushList();
      inCode = true;
      codeLang = fence[1] || "";
      codeBuf = [];
      i++;
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushPara();
      flushList();
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    const ul = /^[-*+]\s+(.+)$/.exec(line);
    if (ul) {
      flushPara();
      if (listType !== "ul") {
        flushList();
        listType = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${inline(ul[1])}</li>`);
      i++;
      continue;
    }

    const ol = /^\d+\.\s+(.+)$/.exec(line);
    if (ol) {
      flushPara();
      if (listType !== "ol") {
        flushList();
        listType = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${inline(ol[1])}</li>`);
      i++;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      flushPara();
      flushList();
      html.push("<hr />");
      i++;
      continue;
    }

    flushList();
    para.push(line.trim());
    i++;
  }

  if (inCode) {
    html.push(
      `<pre class="md-code"><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`,
    );
  }
  flushPara();
  flushList();
  return html.join("\n");
}

function inline(text) {
  let s = escapeHtml(text);
  // code
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  // bold / italic
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  // links [text](url)
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>',
  );
  return s;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
