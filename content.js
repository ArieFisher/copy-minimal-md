(async function () {
    try {
        console.log("Docs Cleaner: Starting cleaning process...");

        // 1. Capture user selection for verification steps later
        const selection = window.getSelection();
        const selectedText = selection ? selection.toString().trim() : "";

        // 2. Attempt programmatic copy
        // Google Docs often blocks this initiated by background script
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
                // Use a substring check to avoid issues with formatting/whitespace diffs
                const checkChunk = selectedText.substring(0, 50).replace(/\s+/g, ' ');
                const clipboardChunk = cleanText.substring(0, 100).replace(/\s+/g, ' '); // Search in first 100 chars

                if (!clipboardChunk.includes(checkChunk)) {
                    console.warn("Docs Cleaner: Stale clipboard detected.");
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

                // Pre-process: Inject dummy headers for headless tables to ensure Turndown GFM works
                const parser = new DOMParser();
                const doc = parser.parseFromString(htmlText, 'text/html');
                const tables = doc.querySelectorAll('table');

                let modified = false;
                tables.forEach(table => {
                    const firstRow = table.rows[0];
                    if (firstRow && !table.tHead) {
                        // Check if the first row is actually a header row (all th) despite missing thead
                        const isImplicitHeader = Array.from(firstRow.cells).every(cell => cell.tagName === 'TH');

                        if (!isImplicitHeader) {
                            // It's a data table without headers (e.g. partial copy)
                            // Create a dummy header row
                            const thead = doc.createElement('thead');
                            const tr = doc.createElement('tr');
                            // Matches column count of first row
                            for (let i = 0; i < firstRow.cells.length; i++) {
                                const th = doc.createElement('th');
                                th.textContent = ""; // Empty header
                                tr.appendChild(th);
                            }
                            thead.appendChild(tr);
                            table.insertBefore(thead, table.firstChild);
                            modified = true;
                        }
                    }
                });

                if (modified) {
                    htmlText = doc.body.innerHTML;
                }

                // 3. Setup Converters
                const turndownService = new TurndownService({
                    headingStyle: 'atx',
                    codeBlockStyle: 'fenced'
                });
                turndownService.use(turndownPluginGfm.gfm);

                // 4. Convert to Markdown
                const markdown = turndownService.turndown(htmlText);

                // 5. Write back to clipboard
                await navigator.clipboard.writeText(markdown);

                console.log("Docs Cleaner: Markdown written to clipboard.");
                flashSuccess("Markdown Ready!");
                return;
            } else if (textBlob) {
                // Plain Text Fallback
                console.log("Docs Cleaner: No HTML found, using Plain Text.");
                const plainText = await textBlob.text();

                // For plain text, we essentially just treat it as valid markdown (or convert if we wanted to escape things, but usually passthrough is best for "cleaner" intent on plain text)
                await navigator.clipboard.writeText(plainText);

                console.log("Docs Cleaner: Plain text written to clipboard.");
                flashSuccess("Cleaned (Text)!");
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
            promptManualCopy("Could not access clipboard. Please focus the document, manually Copy (Cmd+C), and try again.");
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
                console.warn(`Docs Cleaner: Clipboard Read Attempt ${i + 1} failed:`, e);
                if (i === maxAttempts - 1) throw e; // Last attempt failed, propagate error
                await sleep(100); // 100ms backoff
            }
        }
    }
})();