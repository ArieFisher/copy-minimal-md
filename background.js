// Holds the aria-selected DOM snapshot sent by aria-preview.js.
// Cleared once the inspector has consumed it via 'get-aria-preview'.
let lastAriaPreview = null;
let pendingAriaPreviewResolve = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'aria-preview') {
        // aria-preview.js finished scanning the page and sent its result.
        console.log('Background: Received aria-preview from content script.', msg.data ? `${msg.data.cellCount} cells` : 'null (no selection)');
        lastAriaPreview = msg.data;
        pendingAriaPreviewResolve?.(); // unblock the inspect-clipboard handler
        pendingAriaPreviewResolve = null;
        return false;
    }
    if (msg.type === 'get-aria-preview') {
        // Inspector page is asking for the stored snapshot.
        console.log('Background: Inspector requested aria-preview — responding with', lastAriaPreview ? 'data' : 'null', 'then clearing.');
        sendResponse(lastAriaPreview);
        lastAriaPreview = null;
        return false;
    }
});

chrome.commands.onCommand.addListener(async (command) => {
    if (command === "run-markdown-clean") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTab = tabs[0];
            if (currentTab && currentTab.url && (currentTab.url.startsWith("http://") || currentTab.url.startsWith("https://") || currentTab.url.startsWith("file://"))) {
                chrome.scripting.executeScript({
                    target: { tabId: currentTab.id },
                    files: ["lib/purify.min.js", "lib/turndown.js", "lib/turndown-plugin-gfm.js", "lib/marked.min.js", "tsv-detector.js", "grid-detector.js", "content.js"]
                });
            } else {
                console.log("Docs Markdown Cleaner: URL is not supported for text extraction.");
            }
        });
    }

    if (command === "inspect-clipboard") {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];

        if (tab?.url && /^https?:|^file:/.test(tab.url)) {
            console.log(`Background: Injecting aria-preview.js into tab ${tab.id} (${tab.url})`);
            // Inject aria-preview.js and wait up to 500 ms for it to reply.
            // The script runs synchronously on the DOM, so it normally replies in <50 ms.
            await new Promise((resolve) => {
                pendingAriaPreviewResolve = resolve;
                setTimeout(() => {
                    if (pendingAriaPreviewResolve) {
                        console.warn('Background: aria-preview.js timed out — opening inspector without DOM data.');
                        pendingAriaPreviewResolve = null;
                        resolve();
                    }
                }, 500);
                chrome.scripting
                    .executeScript({ target: { tabId: tab.id }, files: ['aria-preview.js'] })
                    .catch((err) => {
                        console.warn('Background: Could not inject aria-preview.js (restricted page?):', err.message);
                        resolve();
                    });
            });
        } else {
            console.log('Background: Tab URL not injectable (chrome:// or extension page) — skipping aria-preview.');
        }

        console.log('Background: Opening inspector tab.');
        chrome.tabs.create({ url: chrome.runtime.getURL("inspector.html") });
    }
});
