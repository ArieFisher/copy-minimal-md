chrome.commands.onCommand.addListener((command) => {
    if (command === "run-markdown-clean") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                files: ["turndown.js", "turndown-plugin-gfm.js", "content.js"]
            });
        });
    }
});