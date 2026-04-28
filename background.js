chrome.commands.onCommand.addListener((command) => {
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
        chrome.tabs.create({ url: chrome.runtime.getURL("inspector.html") });
    }
});