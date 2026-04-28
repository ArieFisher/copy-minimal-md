function formatBytes(bytes) {
    if (bytes === 0) return '0 bytes';
    const k = 1024;
    const sizes = ['bytes', 'kb', 'mb', 'gb', 'tb'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const size = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
    return `${size} ${sizes[i]}`;
}

/**
 * Pretty-print HTML using js-beautify for the raw data pane.
 * Tag names are uppercased for easier visual scanning; attributes are left as-is.
 */
function prettyPrintHtml(html) {
    if (typeof html_beautify === 'function') {
        html = html_beautify(html, {
            indent_size: 2,
            wrap_line_length: 0,
            preserve_newlines: false,
            indent_inner_html: true
        });
    }
    // Uppercase tag names only (not attributes)
    html = html.replace(/<(\/?)([a-z][a-z0-9]*)/gi, (match, slash, tag) => {
        return '<' + slash + tag.toUpperCase();
    });
    return html;
}

async function simulateCopyMinimalMd(clipboardItems) {
    let htmlBlob = null;
    let textBlob = null;
    
    for (const item of clipboardItems) {
        if (item.types.includes("text/html")) {
            htmlBlob = await item.getType("text/html");
        }
        if (item.types.includes("text/plain")) {
            textBlob = await item.getType("text/plain");
        }
    }

    let markdown = "";
    let cleanHtml = "";
    let originalPlainText = "";
    let sourceType = "";
    let htmlText = "";

    if (textBlob) {
        originalPlainText = await textBlob.text();
    }

    if (htmlBlob) {
        sourceType = "HTML";
        htmlText = await htmlBlob.text();
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const tables = doc.querySelectorAll('table');

        let modified = false;

        // Fix Google Sheets extra newlines by converting block-level divs to inline spans inside tables
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

        tables.forEach(table => {
            const firstRow = table.rows[0];
            if (firstRow && !table.tHead) {
                // Check if the first row is actually a header row (all th) despite missing thead
                const isImplicitHeader = Array.from(firstRow.cells).every(cell => cell.tagName === 'TH');

                if (!isImplicitHeader) {
                    const thead = doc.createElement('thead');
                    const tr = doc.createElement('tr');
                    for (let i = 0; i < firstRow.cells.length; i++) {
                        const th = doc.createElement('th');
                        th.textContent = firstRow.cells[i]?.textContent || "";
                        tr.appendChild(th);
                    }
                    thead.appendChild(tr);
                    table.insertBefore(thead, table.firstChild);
                    firstRow.remove();
                    modified = true;
                }
            }
        });

        // Reconstruct ARIA flex/grid tables into standard HTML tables (e.g., Databricks, Notion)
        const ariaRows = doc.querySelectorAll('[role="row"]');
        if (ariaRows.length > 0 && doc.querySelectorAll('table').length === 0) {
            const newTable = doc.createElement('table');
            const tbody = doc.createElement('tbody');
            let thead = null;
            
            ariaRows.forEach(ariaRow => {
                const tr = doc.createElement('tr');
                const ariaCells = ariaRow.querySelectorAll('[role="cell"], [role="columnheader"], [role="gridcell"]');
                
                let isHeaderRow = false;
                
                if (ariaCells.length > 0) {
                    ariaCells.forEach(ariaCell => {
                        const isHeader = ariaCell.getAttribute('role') === 'columnheader';
                        if (isHeader) isHeaderRow = true;
                        
                        const cell = doc.createElement(isHeader ? 'th' : 'td');
                        cell.innerHTML = ariaCell.innerHTML;
                        tr.appendChild(cell);
                    });
                } else {
                    // Fallback for generic div children
                    const children = Array.from(ariaRow.children);
                    children.forEach((child) => {
                        const cell = doc.createElement('td');
                        cell.innerHTML = child.innerHTML;
                        tr.appendChild(cell);
                    });
                }
                
                if (isHeaderRow) {
                    if (!thead) thead = doc.createElement('thead');
                    thead.appendChild(tr);
                } else {
                    tbody.appendChild(tr);
                }
            });
            
            if (thead) {
                newTable.appendChild(thead);
            } else if (tbody.firstChild) {
                // Turndown GFM requires a thead to render a Markdown table.
                // If we didn't find specific columnheader roles, promote the first row.
                thead = doc.createElement('thead');
                const firstRow = tbody.firstChild;
                const tr = doc.createElement('tr');
                Array.from(firstRow.children).forEach(cell => {
                    const th = doc.createElement('th');
                    th.innerHTML = cell.innerHTML;
                    tr.appendChild(th);
                });
                thead.appendChild(tr);
                newTable.appendChild(thead);
                firstRow.remove();
            }
            newTable.appendChild(tbody);
            
            const firstRowParent = ariaRows[0].parentElement;
            if (firstRowParent) {
                 firstRowParent.insertBefore(newTable, ariaRows[0]);
            } else {
                 doc.body.prepend(newTable);
            }
            
            // Clean up original ARIA structure to prevent duplicates
            ariaRows.forEach(row => row.remove());
            modified = true;
            sourceType = "HTML (Extracted ARIA Table)";
        }

        if (modified) {
            htmlText = doc.body.innerHTML;
        }

        if (typeof DOMPurify !== 'undefined') {
            cleanHtml = DOMPurify.sanitize(htmlText, {
                ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'b', 'i', 'strong', 'em', 'u', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'hr', 'blockquote', 'code', 'pre'],
                ALLOWED_ATTR: ['href', 'src', 'alt', 'title'],
                ALLOW_DATA_ATTR: false
            });
        } else {
            cleanHtml = htmlText;
        }

        const turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced'
        });
        if (typeof turndownPluginGfm !== 'undefined') {
            turndownService.use(turndownPluginGfm.gfm);
        }

        markdown = turndownService.turndown(cleanHtml);

        // Post-process to fix excess whitespace within markdown links
        markdown = markdown.replace(/\[([\s\S]+?)\]\((.*?)\)/g, (match, innerText, href) => {
            return `[${innerText.trim().replace(/\s+/g, ' ')}](${href})`;
        });

        if (!textBlob) {
            originalPlainText = markdown;
        }
    } else if (originalPlainText) {
        const detection = TsvDetector.detect({ hasHtml: false, plainText: originalPlainText });
        if (!detection) return null;
        sourceType = detection.sourceType;
        markdown = detection.markdown;
        cleanHtml = detection.simpleHtml;
        await TsvDetector.fire(detection);
    } else {
        return null; // Nothing to simulate
    }

    // Create the UI Card for simulation
    const card = document.createElement('div');
    card.className = 'clipboard-card';
    card.style.border = '2px dashed #4b5563'; // Add dashed border to distinguish it

    const header = document.createElement('div');
    header.className = 'card-header';
    
    const titleText = document.createElement('h2');
    titleText.style.margin = '0';
    titleText.textContent = 'Simulated';
    
    const sourceBadge = document.createElement('span');
    sourceBadge.style.color = '#94a3b8';
    sourceBadge.style.marginLeft = '12px';
    sourceBadge.style.fontSize = '0.9rem';
    sourceBadge.style.fontWeight = 'normal';
    sourceBadge.textContent = 'from ' + sourceType;
    titleText.appendChild(sourceBadge);
    
    header.appendChild(titleText);
    card.appendChild(header);

    // Create the data section
    const dataSectionOuter = document.createElement('div');
    dataSectionOuter.style.marginTop = '1rem';

    const mdHeaderContainer = document.createElement('div');
    mdHeaderContainer.style.display = 'flex';
    mdHeaderContainer.style.justifyContent = 'space-between';
    mdHeaderContainer.style.alignItems = 'center';
    mdHeaderContainer.style.marginBottom = '0.5rem';

    const mdHeader = document.createElement('h3');
    mdHeader.style.color = '#e2e8f0';
    mdHeader.style.margin = '0';
    mdHeader.style.fontSize = '1.1rem';
    const mdSize = formatBytes(new Blob([markdown || '']).size);
    mdHeader.innerHTML = 'Simulated: Markdown &nbsp;&nbsp;&nbsp; <span style="opacity: 0.6; font-size: 0.9em; font-weight: normal;">' + mdSize + '</span>';
    mdHeaderContainer.appendChild(mdHeader);

    const mdCopyBtn = document.createElement('button');
    mdCopyBtn.textContent = 'Copy to Clipboard';
    mdCopyBtn.style.cursor = 'pointer';
    mdCopyBtn.style.padding = '4px 8px';
    mdCopyBtn.style.backgroundColor = '#3b82f6';
    mdCopyBtn.style.color = '#fff';
    mdCopyBtn.style.border = 'none';
    mdCopyBtn.style.borderRadius = '4px';
    mdCopyBtn.onclick = async () => {
        try {
            await navigator.clipboard.write([
                new ClipboardItem({
                    "text/plain": new Blob([markdown || ""], { type: "text/plain" })
                })
            ]);
            mdCopyBtn.textContent = 'Copied!';
            setTimeout(() => {
                mdCopyBtn.textContent = 'Copy to Clipboard';
                readClipboard();
            }, 500);
        } catch (err) {
            console.error("Failed to copy:", err);
            mdCopyBtn.textContent = 'Error';
            setTimeout(() => mdCopyBtn.textContent = 'Copy to Clipboard', 2000);
        }
    };
    mdHeaderContainer.appendChild(mdCopyBtn);
    dataSectionOuter.appendChild(mdHeaderContainer);

    const dataPair = document.createElement('div');
    dataPair.className = 'data-pair';

    // Empty Left Pane
    const emptyLeftPane = document.createElement('div');
    emptyLeftPane.className = 'pane';
    dataPair.appendChild(emptyLeftPane);

    // Tabbed Right Pane
    const tabbedPane = document.createElement('div');
    tabbedPane.className = 'tabbed-pane';

    const tabsHeader = document.createElement('div');
    tabsHeader.className = 'tabs-header';

    const renderBtn = document.createElement('button');
    renderBtn.className = 'tab-btn active';
    renderBtn.textContent = 'Rendered View';

    const rawBtn = document.createElement('button');
    rawBtn.className = 'tab-btn';
    rawBtn.textContent = 'Raw Markdown';

    tabsHeader.appendChild(renderBtn);
    tabsHeader.appendChild(rawBtn);
    tabbedPane.appendChild(tabsHeader);

    const tabContentContainer = document.createElement('div');
    tabContentContainer.className = 'tab-content';
    tabbedPane.appendChild(tabContentContainer);

    const rawScroll = document.createElement('div');
    rawScroll.className = 'scroll-container';
    rawScroll.style.display = 'none'; // Hidden by default
    const dataContent = document.createElement('pre');
    dataContent.className = 'data-content';
    let displayMarkdown = markdown || '[Empty String]';
    displayMarkdown = displayMarkdown.replace(/(data:image\/[^;]+;base64,)[a-zA-Z0-9+/=]+/g, '$1[IMAGE_BINARY]');
    dataContent.textContent = displayMarkdown;
    rawScroll.appendChild(dataContent);

    // Rendered View Pane (Now just content)

    const renderedScroll = document.createElement('div');
    renderedScroll.className = 'scroll-container';
    const renderedContent = document.createElement('div');
    renderedContent.className = 'rendered-content';
    
    if (typeof marked !== 'undefined') {
        renderedContent.innerHTML = marked.parse(markdown, { breaks: true });
    } else {
        renderedContent.textContent = markdown;
    }

    renderedScroll.appendChild(renderedContent);
    tabContentContainer.appendChild(renderedScroll);
    tabContentContainer.appendChild(rawScroll);

    // Tab switching logic
    renderBtn.onclick = () => {
        renderBtn.classList.add('active');
        rawBtn.classList.remove('active');
        rawScroll.style.display = 'none';
        renderedScroll.style.display = 'block';
    };

    rawBtn.onclick = () => {
        rawBtn.classList.add('active');
        renderBtn.classList.remove('active');
        renderedScroll.style.display = 'none';
        rawScroll.style.display = 'block';
    };

    dataPair.appendChild(tabbedPane);
    dataSectionOuter.appendChild(dataPair);
    card.appendChild(dataSectionOuter);

    if (cleanHtml && typeof DOMPurify !== 'undefined') {
        const simpleOuter = document.createElement('div');
        simpleOuter.style.marginTop = '2rem';
        simpleOuter.style.borderTop = '1px solid #334155';
        simpleOuter.style.paddingTop = '1rem';
        
        const simpleHeaderContainer = document.createElement('div');
        simpleHeaderContainer.style.display = 'flex';
        simpleHeaderContainer.style.justifyContent = 'space-between';
        simpleHeaderContainer.style.alignItems = 'center';
        simpleHeaderContainer.style.marginBottom = '0.5rem';

        const simpleHeader = document.createElement('h3');
        simpleHeader.style.color = '#e2e8f0';
        simpleHeader.style.margin = '0';
        simpleHeader.style.fontSize = '1.1rem';
        const simpleSize = formatBytes(new Blob([cleanHtml || '']).size);
        simpleHeader.innerHTML = 'Simulated: Simple HTML &nbsp;&nbsp;&nbsp; <span style="opacity: 0.6; font-size: 0.9em; font-weight: normal;">' + simpleSize + '</span>';
        simpleHeaderContainer.appendChild(simpleHeader);

        const simpleCopyBtn = document.createElement('button');
        simpleCopyBtn.textContent = 'Copy to Clipboard';
        simpleCopyBtn.style.cursor = 'pointer';
        simpleCopyBtn.style.padding = '4px 8px';
        simpleCopyBtn.style.backgroundColor = '#3b82f6';
        simpleCopyBtn.style.color = '#fff';
        simpleCopyBtn.style.border = 'none';
        simpleCopyBtn.style.borderRadius = '4px';
        simpleCopyBtn.onclick = async () => {
            try {
                await navigator.clipboard.write([
                    new ClipboardItem({
                        "text/html": new Blob([cleanHtml || ""], { type: "text/html" }),
                        "text/plain": new Blob([originalPlainText || ""], { type: "text/plain" })
                    })
                ]);
                simpleCopyBtn.textContent = 'Copied!';
                setTimeout(() => {
                    simpleCopyBtn.textContent = 'Copy to Clipboard';
                    readClipboard();
                }, 500);
            } catch (err) {
                console.error("Failed to copy:", err);
                simpleCopyBtn.textContent = 'Error';
                setTimeout(() => simpleCopyBtn.textContent = 'Copy to Clipboard', 2000);
            }
        };
        simpleHeaderContainer.appendChild(simpleCopyBtn);
        simpleOuter.appendChild(simpleHeaderContainer);

        const simpleDataPair = document.createElement('div');
        simpleDataPair.className = 'data-pair';

        // Empty Left Pane for Simple HTML
        const simpleEmptyLeft = document.createElement('div');
        simpleEmptyLeft.className = 'pane';
        simpleDataPair.appendChild(simpleEmptyLeft);

        // Tabbed Right Pane for Simple HTML
        const simpleTabbedPane = document.createElement('div');
        simpleTabbedPane.className = 'tabbed-pane';

        const simpleTabsHeader = document.createElement('div');
        simpleTabsHeader.className = 'tabs-header';

        const simpleRenderBtn = document.createElement('button');
        simpleRenderBtn.className = 'tab-btn active';
        simpleRenderBtn.textContent = 'Rendered HTML';

        const simpleRawBtn = document.createElement('button');
        simpleRawBtn.className = 'tab-btn';
        simpleRawBtn.textContent = 'Simple HTML';

        simpleTabsHeader.appendChild(simpleRenderBtn);
        simpleTabsHeader.appendChild(simpleRawBtn);
        simpleTabbedPane.appendChild(simpleTabsHeader);

        const simpleTabContentContainer = document.createElement('div');
        simpleTabContentContainer.className = 'tab-content';
        simpleTabbedPane.appendChild(simpleTabContentContainer);

        const simpleRawScroll = document.createElement('div');
        simpleRawScroll.className = 'scroll-container';
        simpleRawScroll.style.display = 'none'; // Hidden by default
        const simpleDataContent = document.createElement('pre');
        simpleDataContent.className = 'data-content';
        let displayCleanHtml = cleanHtml || '[Empty String]';
        displayCleanHtml = displayCleanHtml.replace(/(data:image\/[^;]+;base64,)[a-zA-Z0-9+/=]+/g, '$1[IMAGE_BINARY]');
        simpleDataContent.textContent = prettyPrintHtml(displayCleanHtml);
        simpleRawScroll.appendChild(simpleDataContent);
        const simpleRenderedScroll = document.createElement('div');
        simpleRenderedScroll.className = 'scroll-container';
        const simpleRenderedContent = document.createElement('div');
        simpleRenderedContent.className = 'rendered-content';
        
        const simpleShadowHost = document.createElement('div');
        const simpleShadowRoot = simpleShadowHost.attachShadow({ mode: 'closed' });
        simpleShadowRoot.innerHTML = cleanHtml;
        simpleRenderedContent.appendChild(simpleShadowHost);
        
        simpleRenderedScroll.appendChild(simpleRenderedContent);
        simpleTabContentContainer.appendChild(simpleRenderedScroll);
        simpleTabContentContainer.appendChild(simpleRawScroll);

        // Tab switching logic for Simple HTML
        simpleRenderBtn.onclick = () => {
            simpleRenderBtn.classList.add('active');
            simpleRawBtn.classList.remove('active');
            simpleRawScroll.style.display = 'none';
            simpleRenderedScroll.style.display = 'block';
        };

        simpleRawBtn.onclick = () => {
            simpleRawBtn.classList.add('active');
            simpleRenderBtn.classList.remove('active');
            simpleRenderedScroll.style.display = 'none';
            simpleRawScroll.style.display = 'block';
        };

        simpleDataPair.appendChild(simpleTabbedPane);
        simpleOuter.appendChild(simpleDataPair);
        card.appendChild(simpleOuter);
    }

    return card;
}

async function readClipboard() {
    const containerEl = document.getElementById('output-container');
    const errorEl = document.getElementById('error');
    const loadingEl = document.getElementById('loading');

    try {
        // Requires focus. Depending on exact timing, we might need a tiny delay or it just works immediately.
        const clipboardItems = await navigator.clipboard.read();

        if (clipboardItems.length === 0) {
            throw new Error("Clipboard is empty.");
        }

        containerEl.innerHTML = ''; // Clear existing output if any

        let simCard = null;
        try {
            simCard = await simulateCopyMinimalMd(clipboardItems);
        } catch (e) {
            console.error("Simulation failed:", e);
        }

        for (const [index, item] of clipboardItems.entries()) {
            const card = document.createElement('div');
            card.className = 'clipboard-card';

            // Header for Badges
            const header = document.createElement('div');
            header.className = 'card-header';

            // Store content blocks to append after header
            const contentBlocks = [];

            for (const type of item.types) {
                const pill = document.createElement('div');
                pill.className = 'pill';
                pill.style.display = 'none';

                // --- Outer Section wrapper ---
                const dataSectionOuter = document.createElement('div');
                dataSectionOuter.style.marginTop = '1rem';

                const dataPair = document.createElement('div');
                dataPair.className = 'data-pair';

                // --- Left Pane (Empty Space) ---
                const emptyLeftPane = document.createElement('div');
                emptyLeftPane.className = 'pane';
                const typeHeaderContainer = document.createElement('div');
                emptyLeftPane.appendChild(typeHeaderContainer);
                dataPair.appendChild(emptyLeftPane);

                // --- Tabbed Right Pane ---
                const tabbedPane = document.createElement('div');
                tabbedPane.className = 'tabbed-pane';

                const tabsHeader = document.createElement('div');
                tabsHeader.className = 'tabs-header';

                const renderBtn = document.createElement('button');
                renderBtn.className = 'tab-btn active';
                renderBtn.textContent = 'Rendered View';

                const rawBtn = document.createElement('button');
                rawBtn.className = 'tab-btn';
                rawBtn.textContent = 'Raw Data';

                tabsHeader.appendChild(renderBtn);
                tabsHeader.appendChild(rawBtn);
                tabbedPane.appendChild(tabsHeader);

                const tabContentContainer = document.createElement('div');
                tabContentContainer.className = 'tab-content';
                tabbedPane.appendChild(tabContentContainer);

                const rawScroll = document.createElement('div');
                rawScroll.className = 'scroll-container';
                rawScroll.style.display = 'none'; // Hidden by default
                const dataContent = document.createElement('pre');
                dataContent.className = 'data-content';
                rawScroll.appendChild(dataContent);
                const renderedScroll = document.createElement('div');
                renderedScroll.className = 'scroll-container';
                const renderedContent = document.createElement('div');
                renderedContent.className = 'rendered-content';
                renderedScroll.appendChild(renderedContent);
                tabContentContainer.appendChild(renderedScroll);
                tabContentContainer.appendChild(rawScroll);

                // Tab switching logic for main items
                renderBtn.onclick = () => {
                    renderBtn.classList.add('active');
                    rawBtn.classList.remove('active');
                    rawScroll.style.display = 'none';
                    renderedScroll.style.display = 'block';
                };

                rawBtn.onclick = () => {
                    rawBtn.classList.add('active');
                    renderBtn.classList.remove('active');
                    renderedScroll.style.display = 'none';
                    rawScroll.style.display = 'block';
                };

                dataPair.appendChild(tabbedPane);
                dataSectionOuter.appendChild(dataPair);

                try {
                    const blob = await item.getType(type);
                    const sizeStr = formatBytes(blob.size);

                    const leftHeaderText = document.createElement('h3');
                    leftHeaderText.style.marginTop = '0';
                    leftHeaderText.innerHTML = type + ' &nbsp;&nbsp;&nbsp; <span style="opacity: 0.6; font-size: 0.9em; font-weight: normal;">' + sizeStr + '</span>';
                    typeHeaderContainer.appendChild(leftHeaderText);

                    if (type.startsWith('image/')) {
                        dataContent.textContent = '[IMAGE_BINARY]';

                        // Render Image
                        const img = document.createElement('img');
                        img.src = URL.createObjectURL(blob);
                        renderedContent.appendChild(img);
                    } else if (type === 'text/html') {
                        let text = await blob.text();
                        if (text) {
                            text = text.replace(/(data:image\/[^;]+;base64,)[a-zA-Z0-9+/=]+/g, '$1[IMAGE_BINARY]');
                        }
                        dataContent.textContent = prettyPrintHtml(text) || '[Empty String]';

                        // Render HTML using Shadow DOM for isolation
                        const shadowHost = document.createElement('div');
                        const shadowRoot = shadowHost.attachShadow({ mode: 'closed' });
                        const originalText = await blob.text();
                        shadowRoot.innerHTML = originalText;
                        renderedContent.appendChild(shadowHost);
                    } else if (type === 'text/plain') {
                        let text = await blob.text();
                        if (text) {
                            text = text.replace(/(data:image\/[^;]+;base64,)[a-zA-Z0-9+/=]+/g, '$1[IMAGE_BINARY]');
                        }
                        dataContent.textContent = text || '[Empty String]';

                        // Render Markdown (basic heuristic)
                        let renderedHtml = text || '';
                        const isMarkdown = /^(#|\*|-|>|`|\|)/m.test(text) || /\*\*.*\*\*/.test(text) || /\[.*\]\(.*\)/.test(text) || /\|.*\|/.test(text);

                        if (isMarkdown && typeof marked !== 'undefined') {
                            // Use marked library if available for robust parsing (handles tables, etc)
                            renderedHtml = marked.parse(text, { breaks: true });
                        } else {
                            // Plain text fallback
                            renderedHtml = renderedHtml.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/gim, '<br />');
                        }
                        renderedContent.innerHTML = renderedHtml;
                    } else {
                        // Fallback handling
                        let text = await blob.text();
                        if (text) {
                            text = text.replace(/(data:image\/[^;]+;base64,)[a-zA-Z0-9+/=]+/g, '$1[IMAGE_BINARY]');
                        }
                        dataContent.textContent = text || '[Empty String]';
                        renderedContent.textContent = 'Rendering not supported for this type.';
                    }
                } catch (e) {
                    dataContent.textContent = `[Error reading blob: ${e.message}]`;
                    renderedContent.textContent = `[Error reading rendering]`;
                    
                    const leftHeaderText = document.createElement('h3');
                    leftHeaderText.style.marginTop = '0';
                    leftHeaderText.innerHTML = type + ' &nbsp;&nbsp;&nbsp; <span style="opacity: 0.6; font-size: 0.9em; font-weight: normal;">unknown size</span>';
                    typeHeaderContainer.appendChild(leftHeaderText);
                }

                contentBlocks.push(dataSectionOuter);
                header.appendChild(pill);
            }

            // Only append header if it actually has visible content (no pills are visible anymore)
            // But we still append contentBlocks
            // card.appendChild(header); // Removed deliberately to hide the empty grey bar
            contentBlocks.forEach(block => card.appendChild(block));
            containerEl.appendChild(card);
        }

        if (simCard) {
            containerEl.appendChild(simCard);
        }

        loadingEl.style.display = 'none';

    } catch (err) {
        loadingEl.style.display = 'none';
        errorEl.style.display = 'block';
        errorEl.textContent = `Error reading clipboard: ${err.message}\nMake sure the window is focused and the extension has clipboardRead permissions.`;
        console.error(err);
    }
}

// Auto-write simulated simple HTML to the clipboard whenever the TSV state is detected,
// so the user doesn't have to click the per-card "Copy" button.
TsvDetector.addListener(async (d) => {
    await navigator.clipboard.write([
        new ClipboardItem({
            "text/plain": new Blob([d.plainText], { type: "text/plain" }),
            "text/html": new Blob([d.simpleHtml], { type: "text/html" })
        })
    ]);
});

// Execute when DOM is fully loaded.
// The Async Clipboard API requires document focus. Fire immediately if we already
// have it (e.g. the tab was opened in the foreground), otherwise wait for the
// first focus event — no arbitrary timer needed.
document.addEventListener('DOMContentLoaded', () => {
    if (document.hasFocus()) {
        readClipboard();
    } else {
        window.addEventListener('focus', readClipboard, { once: true });
    }
});

// Close the tab when the user leaves it
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        window.close();
    }
});
