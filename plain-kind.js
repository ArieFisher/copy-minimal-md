/**
 * What a text/plain clipboard entry actually holds.
 *
 * The plain entry is not always plain. A copy out of a Markdown editor leaves
 * Markdown there; a copy of page source leaves markup; a copy out of a
 * spreadsheet leaves tab-separated cells and nothing else. The inspector's
 * rendered view draws each as what it is, so it has to ask which of the three
 * it has.
 *
 * Markdown is tested first. A Markdown parser carries raw HTML through
 * untouched, so a payload showing signs of both still comes out right when it
 * is read as Markdown; read the same payload as markup and every Markdown
 * construct in it is lost.
 *
 * The answer is 'text' unless the payload argues otherwise. Anything a reader
 * would not take for markup is drawn as the characters it is, which makes the
 * rendered pane the source pane again — the two views of a truly plain entry
 * are the same view.
 */
(function (global) {
    /* A construct that only a Markdown document has. */
    const MARKDOWN = [
        /^ {0,3}#{1,6}(?:[ \t]|$)/m,                                              // # heading
        /^ {0,3}>[ \t]?\S/m,                                                      // > quote
        /^ {0,3}(?:```|~~~)/m,                                                    // fenced code
        /^ {0,3}[-*+][ \t]+\S/m,                                                  // - item
        /^ {0,3}\d{1,9}[.)][ \t]+\S/m,                                            // 1. item
        /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/m,                                 // --- rule
        /^ {0,3}\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/m, // table delimiter
        /!?\[[^\]\n]*\]\([^()\s]*\)/,                                             // [text](url)
        /(?:\*\*|__)(?=\S)[^\n]*?\S(?:\*\*|__)/,                                  // **bold**
        /~~(?=\S)[^\n]*?\S~~/,                                                    // ~~struck~~
        /`[^`\n]+`/,                                                              // `code`
    ];

    /* A tag, rather than a stray angle bracket: an element that closes, one of
       the elements that never does, or a document header. */
    const HTML = [
        /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>[\s\S]*?<\/\1[ \t]*>/,
        /<(?:br|hr|img|input|meta|link|source|col|area|base|embed|param|track|wbr)\b[^>]*\/?>/i,
        /^\s*<(?:!doctype\b|!--)/i,
    ];

    const matches = (patterns, text) => patterns.some(re => re.test(text));

    /** 'markdown', 'html' or 'text'. */
    function of(text) {
        if (!text) return 'text';
        // Line endings come off the clipboard unpredictably, and every
        // line-anchored pattern above reads them.
        const body = text.replace(/\r\n?/g, '\n');
        if (matches(MARKDOWN, body)) return 'markdown';
        if (matches(HTML, body)) return 'html';
        return 'text';
    }

    global.PlainKind = { of };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof window !== 'undefined' ? window : globalThis).PlainKind;
}
