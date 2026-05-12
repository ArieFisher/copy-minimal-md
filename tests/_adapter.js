/**
 * tests/_adapter.js
 *
 * Phase-A bridge that exposes the HTML→Markdown pipeline currently fused into
 * content.js as a callable `htmlToMarkdown(html, { gridResult })` function for
 * regression tests.
 *
 * In Phase B this entire file is replaced by `require('../pipeline.js')`. The
 * adapter exists so regression fixtures can be written and pinned BEFORE the
 * extraction refactor.
 *
 * The transformations below are a faithful copy of content.js lines 117-237.
 * If content.js changes, this file must be updated until Phase B unifies them.
 */
const fs = require('node:fs');
const path = require('node:path');

let initialized = false;

function initLibs() {
  if (initialized) return;
  initialized = true;

  // DOMPurify exports a factory in Node. Initialize it against the jsdom window.
  const createDOMPurify = require('../lib/purify.min.js');
  globalThis.DOMPurify = createDOMPurify(window);

  // turndown and the GFM plugin are bare IIFEs that declare `var TurndownService`
  // / `var turndownPluginGfm`. In Node those vars don't leak to globalThis, so
  // eval the source with a wrapper that exposes them.
  const loadGlobal = (relPath, name) => {
    const src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
    const fn = new Function('window', 'document', `${src}\n;return typeof ${name} !== 'undefined' ? ${name} : undefined;`);
    globalThis[name] = fn(window, document);
  };
  loadGlobal('lib/turndown.js', 'TurndownService');
  loadGlobal('lib/turndown-plugin-gfm.js', 'turndownPluginGfm');
}

/**
 * Convert clipboard HTML to Markdown using the same logic as content.js.
 *
 * @param {string} htmlText - the clipboard text/html payload
 * @param {object} [opts]
 * @param {object|null} [opts.gridResult] - output of GridDetector.extract(), or null
 * @returns {string} Markdown
 */
function htmlToMarkdown(htmlText, { gridResult = null } = {}) {
  initLibs();

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');
  const tables = doc.querySelectorAll('table');
  let modified = false;

  if (tables.length > 0 && gridResult?.type === 'native' && gridResult.tables.length === tables.length) {
    let structureMatch = true;
    for (let i = 0; i < tables.length; i++) {
      const maxClipboardCols = Math.max(...Array.from(tables[i].rows).map((r) => r.cells.length));
      const domCols = gridResult.tables[i].rows[0]?.cells.length || 0;
      if (domCols > 0 && maxClipboardCols > domCols * 2) {
        structureMatch = false;
        break;
      }
    }
    if (structureMatch) {
      for (let i = 0; i < tables.length; i++) {
        tables[i].replaceWith(doc.adoptNode(gridResult.tables[i].cloneNode(true)));
      }
      modified = true;
    }
  }

  if (tables.length === 0 && (gridResult?.type === 'aria' || gridResult?.type === 'heuristic')) {
    doc.body.innerHTML = '';
    for (const t of gridResult.tables) {
      doc.body.appendChild(doc.adoptNode(t.cloneNode(true)));
    }
    modified = true;
  }

  const currentTables = doc.querySelectorAll('table');

  Array.from(doc.querySelectorAll('td div, th div')).forEach((div) => {
    const span = doc.createElement('span');
    span.append(...div.childNodes);
    div.replaceWith(span);
    modified = true;
  });

  Array.from(doc.querySelectorAll('b[style*="font-weight:normal"], b[style*="font-weight: normal"]')).forEach((b) => {
    const span = doc.createElement('span');
    span.append(...b.childNodes);
    b.replaceWith(span);
    modified = true;
  });

  currentTables.forEach((table) => {
    const firstRow = table.rows[0];
    if (firstRow && !table.tHead) {
      const isImplicitHeader = Array.from(firstRow.cells).every((cell) => cell.tagName === 'TH');
      if (!isImplicitHeader) {
        const thead = doc.createElement('thead');
        const tr = doc.createElement('tr');
        for (let i = 0; i < firstRow.cells.length; i++) {
          const th = doc.createElement('th');
          th.textContent = firstRow.cells[i]?.textContent || '';
          tr.appendChild(th);
        }
        thead.appendChild(tr);
        table.insertBefore(thead, table.firstChild);
        firstRow.remove();
        modified = true;
      }
    }
  });

  if (modified) {
    htmlText = doc.body.innerHTML;
  }

  const cleanHtml = DOMPurify.sanitize(htmlText, {
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'b', 'i', 'strong', 'em', 'u', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'hr', 'blockquote', 'code', 'pre'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title'],
    ALLOW_DATA_ATTR: false,
  });

  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });
  turndownService.use(turndownPluginGfm.gfm);

  let markdown = turndownService.turndown(cleanHtml);
  markdown = markdown.replace(/\[([\s\S]+?)\]\((.*?)\)/g, (m, innerText, href) => {
    return `[${innerText.trim().replace(/\s+/g, ' ')}](${href})`;
  });

  return markdown;
}

module.exports = { htmlToMarkdown };
