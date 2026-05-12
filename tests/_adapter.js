/**
 * tests/_adapter.js
 *
 * Loads the extension's third-party libs (DOMPurify, Turndown, GFM plugin) into
 * the jsdom test environment and then `require`s pipeline.js so regression and
 * pipeline tests can call `htmlToMarkdown` / `gridToMarkdown` directly.
 *
 * No code is duplicated from content.js. pipeline.js is the single source of
 * truth for the HTML→Markdown transformations.
 */
const fs = require('node:fs');
const path = require('node:path');

let cachedPipeline = null;

function getPipeline() {
    if (cachedPipeline) return cachedPipeline;

    const createDOMPurify = require('../lib/purify.min.js');
    globalThis.DOMPurify = createDOMPurify(window);

    const loadGlobal = (relPath, name) => {
        const src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
        const fn = new Function('window', 'document', `${src}\n;return typeof ${name} !== 'undefined' ? ${name} : undefined;`);
        globalThis[name] = fn(window, document);
    };
    loadGlobal('lib/turndown.js', 'TurndownService');
    loadGlobal('lib/turndown-plugin-gfm.js', 'turndownPluginGfm');

    delete require.cache[require.resolve('../pipeline.js')];
    delete window.Pipeline;
    cachedPipeline = require('../pipeline.js');
    return cachedPipeline;
}

module.exports = {
    get htmlToMarkdown() { return getPipeline().htmlToMarkdown; },
    get gridToMarkdown() { return getPipeline().gridToMarkdown; },
};
