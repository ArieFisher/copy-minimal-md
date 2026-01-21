# Docs Markdown Cleaner


**What:** Converts copied HTML to Markdown.

**Why:** Useful for people who frequently use LLMs.

1. **Pasting tables into chatbots:** Copying from Sheets and pasting into an LLM joins all text together. Since LLMs understand Markdown, this extension lets you copy from spreadsheets (or web tables) and paste in a format LLMs can parse.  
2. **Pasting into Docs:** If your editor supports Markdown (e.g., Google Docs), this extension strips unwanted formatting, preserving structure (headers, tables, bullets) without the source's idiosyncratic styling.

## Features

- **Removes Inline Styles**: Strips font families, colors, and background highlights that often clutter copied text.
- **Preserves Structure**: Keeps H1-H6, bold, italics, links, and lists intact.
- **Table Support**: Preserves table structures.
- **Privacy Focused**: All processing happens locally in your browser. No data is sent to the cloud.
- **Clipboard Integration**: Automatically updates your clipboard with the CLEAN Markdown, ready to paste.

## Usage

1. **Select** the text you want to clean in Google Docs (or any web page).
2. Press the keyboard shortcut:
   - **Mac**: `Command + Shift + U`
   - **Windows/Linux**: `Ctrl + Shift + U`
3. You will see a brief flash or console log confirming the clean.
4. **Paste** (`Cmd+V` / `Ctrl+V`) the text back into your document. It will now be free of direct formatting.

## How It Works

1. **Trigger**: The background script listens for the command (`run-markdown-clean`).
2. **Copy**: It programmatically triggers a copy to get the browser's rich HTML version of your selection.
3. **Turndown**: The HTML is converted into **Markdown** using [Turndown](https://github.com/mixmark-io/turndown). This step naturally discards style attributes like `font-family` or `background-color`.
4. **Clipboard Write**: The new, clean Markdown is written back to your clipboard.

## Dependencies

- [Turndown](https://github.com/mixmark-io/turndown) - HTML to Markdown converter.
- [Turndown Plugin GFM](https://github.com/mixmark-io/turndown-plugin-gfm) - For Tables & Strikethrough support.

## Permissions

- `activeTab`: To execute the cleaning script on the current page.
- `scripting`: To inject the library files dynamically.
- `clipboardRead` / `clipboardWrite`: To modify your clipboard content.

## Installation

Since this is a developer tool, you will install it as an "Unpacked Extension".

1. Clone or download this repository to your local machine.
2. Open Chrome and navigate to `chrome://extensions`.
3. Toggle **Developer mode** in the top right corner.
4. Click **Load unpacked**.
5. Select the folder containing this project (where `manifest.json` is located).

## Troubleshooting

### "Copy Failed: Clipboard content mismatch"

This error prevents the extension from processing stale clipboard data.

**Why it happens:**
- **Copy Blocked:** The browser may block background copy operations for security.
- **Safety Check:** The extension detected that your clipboard content does not match your current selection.

**Solution:**
1. Click anywhere in the document to ensure it has focus.
2. Retry the shortcut.
3. If it persists, manually Copy (`Cmd+C` / `Ctrl+C`) your selection first, then run the extension shortcut.