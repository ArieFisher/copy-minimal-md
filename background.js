let lastAriaPreview = null;
let pendingAriaPreviewResolve = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'aria-preview') {
        lastAriaPreview = msg.data;
        pendingAriaPreviewResolve?.();
        pendingAriaPreviewResolve = null;
        return false;
    }
    if (msg.type === 'get-aria-preview') {
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
            await new Promise((resolve) => {
                pendingAriaPreviewResolve = resolve;
                setTimeout(resolve, 500);
                chrome.scripting
                    .executeScript({ target: { tabId: tab.id }, files: ['aria-preview.js'] })
                    .catch(resolve);
            });
        }
        chrome.tabs.create({ url: chrome.runtime.getURL("inspector.html") });
    }
});
