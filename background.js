chrome.commands.onCommand.addListener((command) => {
    if (command === "run-markdown-clean") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTab = tabs[0];
            if (currentTab && currentTab.url && (currentTab.url.startsWith("http://") || currentTab.url.startsWith("https://") || currentTab.url.startsWith("file://"))) {
                chrome.scripting.executeScript({
                    target: { tabId: currentTab.id },
                    files: ["purify.min.js", "turndown.js", "turndown-plugin-gfm.js", "content.js"]
                });
            } else {
                console.log("Docs Markdown Cleaner: URL is not supported for text extraction.");
            }
        });
    }
});