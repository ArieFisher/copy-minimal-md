// Print version info to console on load
console.log(`Docs Markdown Cleaner version: ${chrome.runtime.getManifest().version}`);

// Register the cmd+shift+U variant of the TSV auto-write listener once per page.
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
        console.log(`Docs Cleaner: Selected text length: ${selectedText.length} chars.`);

        // 1.5. Pre-compute grid structure from the live DOM BEFORE copying.
        // GridDetector tries native <table>, ARIA role, and heuristic div strategies in order.
        // The result is used post-copy to either fix jagged clipboard HTML (type='native') or
        // synthesize structured Markdown when no HTML payload exists (type='aria'/'heuristic').
        const gridResult = GridDetector.extract(selection);

        // 2. Attempt programmatic copy
        // Note: document.execCommand('copy') is broadly considered deprecated, but it is strictly REQUIRED here.
        // It tells the browser to simulate a 'Cmd+C' keystroke, guaranteeing we get the exact same
        // clipboard HTML payload that a native copy would generate. This forces complex apps like
        // Google Docs, Notion, or Confluence to fire their custom copy event listeners and format 
        // their specific internal data structures into standard clipboard HTML, which we then read and process.
        // (Also note: Google Docs sometimes blocks this when initiated by a background script)
        
        const success = document.execCommand('copy'); 
        
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
            // the copy probably failed silently.
            if (selectedText && cleanText) {
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



            if (htmlBlob) {
                // HTML Priority
                let htmlText = await htmlBlob.text();

                // Safety: Size Limit (Bulletproof #2)
                if (htmlText.length > 1000000) {
                    console.warn("Docs Cleaner: Content too large (" + htmlText.length + " chars).");
                    flashError("Content too large (>1MB). Please copy a smaller section.");
                    return;
                }

                console.log("Docs Cleaner: HTML content found. Length:", htmlText.length);
                console.groupCollapsed("Docs Cleaner: Processing HTML...");

                const markdown = Pipeline.htmlToMarkdown(htmlText, { gridResult });

                await navigator.clipboard.writeText(markdown);

                console.log("Docs Cleaner: Markdown written to clipboard.");
                console.groupEnd();
                flashSuccess("Markdown Ready!");
                return;
            } else if (textBlob) {
                // Plain Text Fallback
                console.log("Docs Cleaner: No HTML found, using Plain Text.");

                // Grid table intercept: if we pre-computed a structured table from ARIA or heuristic
                // DOM detection, synthesize Markdown from it instead of the flat plain text.
                // This handles sites like Google Finance Beta that produce no text/html payload.
                if (gridResult?.type === 'aria' || gridResult?.type === 'heuristic') {
                    console.log(`Docs Cleaner: ${gridResult.type} grid detected; synthesizing Markdown from DOM structure.`);
                    const gridMarkdown = Pipeline.gridToMarkdown(gridResult);
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