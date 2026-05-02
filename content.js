// Register the cmd+shift+U variant of the TSV auto-write listener once per page.
// The content script may be re-injected on every invocation, so guard against
// stacking duplicate listeners on the shared TsvDetector.
if (!window.__tsvCleanerListenerRegistered) {
    window.__tsvCleanerListenerRegistered = true;
    TsvDetector.addListener(async (d) => {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/plain": new Blob([d.markdown], { type: "text/plain" }),
                "text/html": new Blob([d.simpleHtml], { type: "text/html" })
            })
        ]);
    });
}

(async function () {
    try {
        console.log("Docs Cleaner: Starting cleaning process...");

        // 1. Capture user selection for verification steps later
        const selection = window.getSelection();
        const selectedText = selection ? selection.toString().trim() : "";

        // 1.5. Pre-compute grid structure from the live DOM BEFORE copying.
        // GridDetector tries native <table>, ARIA role, and heuristic div strategies in order.
        // The result is used post-copy to either fix jagged clipboard HTML (type='native') or
        // synthesize structured Markdown when no HTML payload exists (type='aria'/'heuristic').
        const gridResult = GridDetector.extract(selection);

        // 1.6. Orphan-ARIA grid fast path (e.g. Databricks virtualised data grids).
        // These grids emit role="row"/"cell"/"columnheader" but omit a role="grid" root,
        // so AriaGridStrategy never fires. Worse, execCommand('copy') triggers the site's
        // own copy handler which writes SQL or other unexpected content instead of TSV.
        // Bypass execCommand entirely and synthesise Markdown straight from the DOM table.
        // Note: the stale-clipboard check (step 4) is intentionally skipped here — this
        // path extracts data from the live DOM, not the clipboard, so clipboard freshness
        // is irrelevant.
        if (gridResult?.type === 'orphan-aria') {
            const cleanGridHtml = DOMPurify.sanitize(gridResult.tables[0].outerHTML, {
                ALLOWED_TAGS: ['table', 'thead', 'tbody', 'tr', 'th', 'td'],
                ALLOWED_ATTR: [],
                ALLOW_DATA_ATTR: false
            });
            const gridTurndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
            gridTurndown.use(turndownPluginGfm.gfm);
            const gridMarkdown = gridTurndown.turndown(cleanGridHtml);
            await navigator.clipboard.writeText(gridMarkdown);
            console.log("Docs Cleaner: Orphan-ARIA Grid Markdown written to clipboard.");
            flashSuccess("Grid Table Ready!");
            return;
        }

        // 2. Attempt programmatic copy
        // Note: document.execCommand('copy') is broadly considered deprecated, but it is strictly REQUIRED here.
        // It tells the browser to simulate a 'Cmd+C' keystroke, guaranteeing we get the exact same
        // clipboard HTML payload that a native copy would generate. This forces complex apps like
        // Google Docs, Notion, or Confluence to fire their custom copy event listeners and format 
        // their specific internal data structures into standard clipboard HTML, which we then read and process.
        // (Also note: Google Docs sometimes blocks this when initiated by a background script)

        // If Databricks grid is selected (via its custom CSS classes) but the native selection
        // is outside (e.g. in the SQL editor), Databricks' copy handler will ignore execCommand('copy')
        // and the browser will copy the SQL editor. We must temporarily move the native selection
        // into the grid to trick Databricks into firing its TSV copy logic.
        let originalRange = null;
        if (selection && selection.rangeCount > 0) {
            originalRange = selection.getRangeAt(0);
        }
        
        const databricksCell = document.querySelector('.dg--selected-cell');
        let tempSelectionAdded = false;
        if (databricksCell && (!selection || !selection.anchorNode || !(databricksCell.closest('.dg--table-wrapper') || databricksCell.closest('[role="table"]'))?.contains(selection.anchorNode))) {
            const tempRange = document.createRange();
            tempRange.selectNodeContents(databricksCell);
            selection.removeAllRanges();
            selection.addRange(tempRange);
            tempSelectionAdded = true;
            console.log("Docs Cleaner: Temporarily moved native selection to Databricks grid to trigger native copy.");
        }

        const success = document.execCommand('copy');

        // Restore original selection
        if (tempSelectionAdded && originalRange) {
            selection.removeAllRanges();
            selection.addRange(originalRange);
        }

        console.log("Docs Cleaner: execCommand('copy') result:", success);

        // Wait for clipboard I/O to settle (race condition fix)
        await new Promise(r => setTimeout(r, 150));

        if (!success) {
            flashError("Copy failed natively. Please select text and try again.");
            return;
        }

        // 3. Read clipboard with Retry Logic (Bulletproof #1)
        try {
            const items = await readClipboardWithRetry(3);
            let htmlBlob = null;
            let textBlob = null;
            let cleanText = "";

            for (const item of items) {
                if (item.types.includes("text/html")) {
                    htmlBlob = await item.getType("text/html");
                }
                if (item.types.includes("text/plain")) {
                    textBlob = await item.getType("text/plain");
                    cleanText = await textBlob.text();
                }
            }

            // 4. Verification: Check for stale clipboard
            // If the clipboard text doesn't contain a significant chunk of our selection, 
            // the copy probably failed silently. Skip this check if we used the Databricks
            // fallback selection, since the TSV payload won't match the faked selection text.
            if (selectedText && cleanText && !tempSelectionAdded) {
                // Use a word-intersection check to avoid issues with formatting/whitespace diffs from grid/flexbox layouts.
                const checkWords = selectedText.substring(0, 50).split(/\s+/).filter(w => w.length > 0);

                // For table selections, the browser's plain-text clipboard payload starts at the leftmost
                // cell of the first selected row — which may come *before* where the user's highlight
                // started. Searching only the first 100 chars would miss the user's starting cell.
                // Broaden the search window to the full text and lower the required match count to 1.
                const isTableSelection = gridResult !== null;
                const searchText = isTableSelection ? cleanText : cleanText.substring(0, 100);
                const targetMatches = isTableSelection ? 1 : Math.min(3, checkWords.length);
                const clipboardWords = searchText.split(/\s+/).filter(w => w.length > 0);

                let matchCount = 0;
                for (const word of checkWords) {
                    if (clipboardWords.includes(word)) {
                        matchCount++;
                    }
                }

                if (matchCount < targetMatches && checkWords.length > 0) {
                    console.log("Docs Cleaner: Selected words:", checkWords);
                    console.log("Docs Cleaner: Clipboard words:", clipboardWords);
                    console.warn(`Docs Cleaner: Stale clipboard detected. Matched ${matchCount}/${targetMatches} words.`);
                    flashError("Copy Failed: Clipboard content mismatch. Click document & retry.");
                    return;
                }
            }



            let htmlText = null;
            let doc = null;
            let tables = [];

            if (htmlBlob) {
                htmlText = await htmlBlob.text();
                const parser = new DOMParser();
                doc = parser.parseFromString(htmlText, 'text/html');
                tables = doc.querySelectorAll('table');

                // Heuristic: If the source app placed valid TSV in text/plain, but put bogus/non-tabular 
                // data in text/html (like Databricks returning the SQL query instead of the grid),
                // we should discard the HTML and fall back to the plain text.
                if (tables.length === 0) {
                    if (gridResult !== null) {
                        console.log("Docs Cleaner: DOM grid detected but no HTML table found. Discarding bogus HTML payload.");
                        htmlBlob = null;
                    } else if (cleanText && TsvDetector.detect({ hasHtml: false, plainText: cleanText })) {
                        console.log("Docs Cleaner: Valid TSV detected in plain text and HTML has no table. Discarding bogus HTML payload.");
                        htmlBlob = null;
                    }
                }
            }

            if (htmlBlob) {
                // HTML Priority
                // Safety: Size Limit (Bulletproof #2)
                if (htmlText.length > 1000000) {
                    console.warn("Docs Cleaner: Content too large (" + htmlText.length + " chars).");
                    flashError("Content too large (>1MB). Please copy a smaller section.");
                    return;
                }

                console.log("Docs Cleaner: HTML content found. Length:", htmlText.length);

                let modified = false;

                // Attempt to fix malformed jagged tables by replacing them with our DOM-extracted structured tables.
                // Guard 1: table counts must match — prevents accidentally replacing tables in apps like Google Docs
                //   or Notion that emit hidden wrapper/layout tables in their clipboard HTML.
                // Guard 2: column count sanity — if the clipboard table's max column count is more than 2× our
                //   DOM table's column count it is almost certainly a different (layout) table, not the data table
                //   the user selected. Skip replacement in that case.
                if (tables.length > 0 && gridResult?.type === 'native' && gridResult.tables.length === tables.length) {
                    let structureMatch = true;
                    for (let i = 0; i < tables.length; i++) {
                        const maxClipboardCols = Math.max(...Array.from(tables[i].rows).map(r => r.cells.length));
                        const domCols = gridResult.tables[i].rows[0]?.cells.length || 0;
                        if (domCols > 0 && maxClipboardCols > domCols * 2) {
                            console.warn(`Docs Cleaner: Table ${i} column mismatch (clipboard max: ${maxClipboardCols}, dom: ${domCols}). Skipping structured replacement.`);
                            structureMatch = false;
                            break;
                        }
                    }
                    if (structureMatch) {
                        for (let i = 0; i < tables.length; i++) {
                            // Explicitly adopt the node into the DOMParser document before inserting.
                            // cloneNode alone creates a node owned by the live page document; adoptNode
                            // transfers ownership to doc, preventing any cross-document reference issues.
                            tables[i].replaceWith(doc.adoptNode(gridResult.tables[i].cloneNode(true)));
                        }
                        modified = true;
                    }
                }

                // Re-query tables after potential replacement for the rest of the processing.
                // Note: if structuredDomTables was empty (e.g. the page renders its grid with JS/canvas
                // or <div> elements — as some versions of Google Finance do — rather than native <table>
                // elements), the replacement block above was a no-op and we fall through here using the
                // browser's native clipboard HTML as-is.
                const currentTables = doc.querySelectorAll('table');

                // Fix Google Sheets extra newlines by converting block-level divs to inline spans inside tables.
                // Queried from the full doc (not scoped to currentTables) so freshly adopted nodes are included.
                const cells = doc.querySelectorAll('td div, th div');
                Array.from(cells).forEach(div => {
                    const span = doc.createElement('span');
                    span.append(...div.childNodes);
                    div.replaceWith(span);
                    modified = true;
                });

                // Fix Google Docs wrapping entire copy in a fake bold tag
                const fakeBolds = doc.querySelectorAll('b[style*="font-weight:normal"], b[style*="font-weight: normal"]');
                Array.from(fakeBolds).forEach(b => {
                    const span = doc.createElement('span');
                    span.append(...b.childNodes);
                    b.replaceWith(span);
                    modified = true;
                });

                currentTables.forEach(table => {
                    const firstRow = table.rows[0];
                    if (firstRow && !table.tHead) {
                        // Check if the first row is actually a header row (all th) despite missing thead
                        const isImplicitHeader = Array.from(firstRow.cells).every(cell => cell.tagName === 'TH');

                        if (!isImplicitHeader) {
                            // It's a data table without headers (e.g. partial copy)
                            // Promote the first row as the header instead of creating empty headers
                            const thead = doc.createElement('thead');
                            const tr = doc.createElement('tr');
                            // Copy content from first row to header
                            for (let i = 0; i < firstRow.cells.length; i++) {
                                const th = doc.createElement('th');
                                th.textContent = firstRow.cells[i]?.textContent || "";
                                tr.appendChild(th);
                            }
                            thead.appendChild(tr);
                            table.insertBefore(thead, table.firstChild);
                            // Remove the original first row from tbody to avoid duplication
                            firstRow.remove();
                            modified = true;
                        }
                    }
                });

                if (modified) {
                    htmlText = doc.body.innerHTML;
                }

                // 3. Setup Converters
                const cleanHtml = DOMPurify.sanitize(htmlText, {
                    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'b', 'i', 'strong', 'em', 'u', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'hr', 'blockquote', 'code', 'pre'],
                    ALLOWED_ATTR: ['href', 'src', 'alt', 'title'],
                    ALLOW_DATA_ATTR: false
                });

                const turndownService = new TurndownService({
                    headingStyle: 'atx',
                    codeBlockStyle: 'fenced'
                });
                turndownService.use(turndownPluginGfm.gfm);

                // 4. Convert to Markdown
                let markdown = turndownService.turndown(cleanHtml);

                // Post-process to fix excess whitespace within markdown links
                markdown = markdown.replace(/\[([\s\S]+?)\]\((.*?)\)/g, (match, innerText, href) => {
                    return `[${innerText.trim().replace(/\s+/g, ' ')}](${href})`;
                });

                // 5. Write back to clipboard
                await navigator.clipboard.writeText(markdown);

                console.log("Docs Cleaner: Markdown written to clipboard.");
                flashSuccess("Markdown Ready!");
                return;
            } else if (textBlob) {
                // Plain Text Fallback
                console.log("Docs Cleaner: No HTML found, using Plain Text.");

                // Grid table intercept: if we pre-computed a structured table from ARIA or heuristic
                // DOM detection, synthesize Markdown from it instead of the flat plain text.
                // This handles sites like Google Finance Beta that produce no text/html payload.
                // NOTE: 'heuristic-WIP' is a placeholder branch — HeuristicDivStrategy is not yet
                // implemented but will return this type when it ships.
                if (gridResult?.type === 'aria' || gridResult?.type === 'heuristic-WIP') {
                    console.log(`Docs Cleaner: ${gridResult.type} grid detected; synthesizing Markdown from DOM structure.`);
                    const cleanGridHtml = DOMPurify.sanitize(gridResult.tables[0].outerHTML, {
                        ALLOWED_TAGS: ['table', 'thead', 'tbody', 'tr', 'th', 'td'],
                        ALLOWED_ATTR: [],
                        ALLOW_DATA_ATTR: false
                    });
                    const gridTurndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
                    gridTurndown.use(turndownPluginGfm.gfm);
                    const gridMarkdown = gridTurndown.turndown(cleanGridHtml);
                    await navigator.clipboard.writeText(gridMarkdown);
                    console.log("Docs Cleaner: Grid Markdown written to clipboard.");
                    flashSuccess("Grid Table Ready!");
                    return;
                }
                const plainText = await textBlob.text();

                const detection = TsvDetector.detect({ hasHtml: false, plainText });
                if (detection) {
                    console.log("Docs Cleaner: TSV pattern detected; firing listeners.");
                    await TsvDetector.fire(detection);
                    flashSuccess("TSV Table Ready!");
                } else {
                    // Scrubs hidden metadata (RTF, vendor tags) by rewriting as clean text
                    await navigator.clipboard.writeText(plainText);
                    console.log("Docs Cleaner: Plain text written to clipboard.");
                    flashSuccess("Cleaned (Text)!");
                }
                return;
            } else {
                if (!htmlBlob && !textBlob) {
                    // Clipboard access worked, but no recognized content
                    console.warn("Docs Cleaner: No HTML or Text found in clipboard.");
                    promptManualCopy("No valid text content found. Please manually Copy (Cmd+C/Ctrl+C) your selection first, then run this again.");
                }
            }

        } catch (readError) {
            console.error("Docs Cleaner: Clipboard Read Failed:", readError);

            // Provide more specific error messages based on error type
            if (readError.name === 'NotAllowedError') {
                flashError("Clipboard access denied. Please reload the extension and try again.");
            } else if (readError.name === 'NotFoundError') {
                flashError("Clipboard empty. Please select text first.");
            } else {
                flashError("Clipboard read failed. Try reloading the page.");
            }
        }

    } catch (err) {
        console.error("Docs Cleaner Critical Failure:", err);
        alert("Cleaner failed unexpectedly: " + err.message);
    }

    function flashSuccess(msg) {
        showToast(msg, '#4CAF50'); // Green
    }

    function flashError(msg) {
        showToast(msg, '#F44336'); // Red
    }

    function promptManualCopy(msg) {
        // Replaced alert with flashError for better UX
        // We might want to shorten the message since it's a toast now
        if (msg.includes("Copy failed")) {
            flashError("Copy Failed: Click document & retry");
        } else {
            flashError(msg);
        }
    }

    function showToast(msg, bgColor) {
        const overlay = document.createElement('div');
        overlay.style.cssText = `position:fixed;top:20px;right:20px;padding:10px 20px;background:${bgColor};color:white;z-index:99999;border-radius:4px;font-family:sans-serif;font-weight:bold;box-shadow:0 2px 5px rgba(0,0,0,0.2);transition: opacity 0.5s ease-in-out;`;
        overlay.innerText = msg;
        document.body.appendChild(overlay);

        // Remove after 3 seconds
        setTimeout(() => {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 500);
        }, 3000);
    }

    // --- Helpers ---

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    async function readClipboardWithRetry(maxAttempts) {
        for (let i = 0; i < maxAttempts; i++) {
            try {
                return await navigator.clipboard.read();
            } catch (e) {
                console.warn(`Docs Cleaner: Clipboard Read Attempt ${i + 1} failed:`, e.name, e.message);
                if (i === maxAttempts - 1) throw e; // Last attempt failed, propagate error
                await sleep(150); // 150ms backoff
            }
        }
    }
})();