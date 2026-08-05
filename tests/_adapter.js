/**
 * tests/_adapter.js
 *
 * Loads the extension's third-party libs (DOMPurify, Turndown, GFM plugin) into
 * the jsdom test environment and then `require`s the pure modules so tests can
 * call them directly:
 *   - pipeline.js     `htmlToMarkdown` / `gridToMarkdown` and their `…SimpleHtml`
 *                     counterparts — the cmd+shift+U path
 *   - equivalents.js  `fromHtml` — what the inspector derives from the clipboard
 *
 * No code is duplicated from content.js or inspector.js. Those two modules are
 * the single source of truth for their transformations.
 */
const fs = require('node:fs');
const path = require('node:path');

let libsLoaded = false;
let cachedPipeline = null;
let cachedEquivalents = null;

function loadLibs() {
    if (libsLoaded) return;

    const createDOMPurify = require('../lib/purify.min.js');
    globalThis.DOMPurify = createDOMPurify(window);

    const loadGlobal = (relPath, name) => {
        const src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
        const fn = new Function('window', 'document', `${src}\n;return typeof ${name} !== 'undefined' ? ${name} : undefined;`);
        globalThis[name] = fn(window, document);
    };
    loadGlobal('lib/turndown.js', 'TurndownService');
    loadGlobal('lib/turndown-plugin-gfm.js', 'turndownPluginGfm');

    libsLoaded = true;
}

function getPipeline() {
    if (cachedPipeline) return cachedPipeline;
    loadLibs();
    // pipeline.js reaches for the global Equivalents to derive the Simple HTML,
    // the same way the injected content script does.
    getEquivalents();

    delete require.cache[require.resolve('../pipeline.js')];
    delete window.Pipeline;
    cachedPipeline = require('../pipeline.js');
    return cachedPipeline;
}

function getEquivalents() {
    if (cachedEquivalents) return cachedEquivalents;
    loadLibs();

    delete require.cache[require.resolve('../equivalents.js')];
    delete window.Equivalents;
    cachedEquivalents = require('../equivalents.js');
    return cachedEquivalents;
}

module.exports = {
    get htmlToMarkdown() { return getPipeline().htmlToMarkdown; },
    get htmlToSimpleHtml() { return getPipeline().htmlToSimpleHtml; },
    get gridToMarkdown() { return getPipeline().gridToMarkdown; },
    get gridToSimpleHtml() { return getPipeline().gridToSimpleHtml; },
    get fromHtml() { return getEquivalents().fromHtml; },
    get collapseContainers() { return getEquivalents().collapseContainers; },
    get nameEmptyLinksAndImages() { return getEquivalents().nameEmptyLinksAndImages; },
    get toSimpleHtml() { return getEquivalents().toSimpleHtml; },
    get isSameHtmlEntry() { return getEquivalents().isSameHtmlEntry; },
};
