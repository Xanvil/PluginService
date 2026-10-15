/**
 * 轻量 Markdown → HTML（标题、列表、代码块、链接、粗斜体、段落、GFM 表格）。
 * 输出均经转义，避免 XSS。
 */

/**
 * 将 Markdown 转为安全 HTML。
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

    // GFM 表格：当前行含 |，下一行为对齐分隔行（| --- | --- |）
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      flushPara();
      flushList();
      const headerCells = splitTableCells(line);
      const aligns = parseTableAligns(lines[i + 1], headerCells.length);
      i += 2;
      const bodyRows = [];
      while (i < lines.length && looksLikeTableRow(lines[i])) {
        bodyRows.push(splitTableCells(lines[i]));
        i++;
      }
      html.push(renderTable(headerCells, aligns, bodyRows));
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

/**
 * 按 | 拆分表格行单元格（去掉首尾空段）。
 * @param {string} line
 * @returns {string[]}
 */
function splitTableCells(line) {
  const trimmed = line.trim();
  const raw = trimmed.split("|");
  // 行首/行尾的 | 会产生空串，去掉它们
  if (raw.length > 0 && raw[0].trim() === "") raw.shift();
  if (raw.length > 0 && raw[raw.length - 1].trim() === "") raw.pop();
  return raw.map((c) => c.trim());
}

/**
 * 是否为 GFM 表头分隔行（如 `| --- | :---: | ---: |`）。
 * 要求含 `|`，避免把普通水平线 `---` 误判为表分隔。
 * @param {string} line
 */
function isTableSeparator(line) {
  if (!line || !line.includes("|")) return false;
  const cells = splitTableCells(line);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(c.trim()));
}

/**
 * 粗判是否为表格数据行（含 | 且非空）。
 * @param {string} line
 */
function looksLikeTableRow(line) {
  if (!line || /^\s*$/.test(line)) return false;
  if (!line.includes("|")) return false;
  // 避免把普通分隔线 --- 当成行
  if (isTableSeparator(line)) return false;
  return true;
}

/**
 * 从分隔行解析每列对齐：left / center / right / ""。
 * @param {string} sepLine
 * @param {number} colCount
 * @returns {string[]}
 */
function parseTableAligns(sepLine, colCount) {
  const cells = splitTableCells(sepLine);
  const aligns = [];
  for (let i = 0; i < colCount; i++) {
    const c = (cells[i] || "").trim();
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) aligns.push("center");
    else if (right) aligns.push("right");
    else if (left) aligns.push("left");
    else aligns.push("");
  }
  return aligns;
}

/**
 * 生成 table HTML；单元格内容走 inline（含转义）。
 * @param {string[]} headers
 * @param {string[]} aligns
 * @param {string[][]} bodyRows
 */
function renderTable(headers, aligns, bodyRows) {
  const ths = headers
    .map((h, idx) => {
      const align = aligns[idx];
      const style = align ? ` style="text-align:${align}"` : "";
      return `<th${style}>${inline(h)}</th>`;
    })
    .join("");
  const trs = bodyRows
    .map((row) => {
      const tds = headers
        .map((_, idx) => {
          const align = aligns[idx];
          const style = align ? ` style="text-align:${align}"` : "";
          return `<td${style}>${inline(row[idx] ?? "")}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
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
