* * *

# Copy as Minimally-Formatted Markdown

Converts copied web content to Markdown—preserving structure (tables, headers, lists) while stripping source formatting.

## The Problem

**1\. Copy-paste often breaks.** Copy a table from a spreadsheet and paste it into an LLM, and you get the text but no structure (not even spaces between cell contents).  LLMs cannot work with this.

```
SourceRevenueImpressionsShopify15127214031139...
```

**2\. Copy-paste also over-preserves.** Pasting from the web into Google Docs brings unwanted formatting. "Paste as plain text" strips it, but loses all structure.

## The Solution

A second keyboard shortcut that copies text and structure, without formatting. Ideal for pasting into LLMs or Markdown-aware editors like Google Docs.

**Why this tool?**

**Security:** Published Chrome extensions require trusting third-party code with clipboard access. This installs as an unpacked extension—you can inspect every line before running it.

**Unique use case:** Most alternatives (like [Markdownload](https://github.com/deathau/markdownload)) are _web clippers_—they extract full pages and save them as files. This tool is a _clipboard utility_: select text, hit a shortcut, paste clean Markdown. No popups, no file management, no context switching.

**When to use something else:** If you want full-page archiving, Obsidian integration, frontmatter templates, or rich configuration options, use Markdownload or [yorkxin/copy-as-markdown](https://github.com/yorkxin/copy-as-markdown). They're mature, well-maintained, and do more.

## Features

*   **Strips inline styles**: Removes font families, colors, and background highlights
*   **Preserves structure**: Headings, bold, italics, links, lists, and tables
*   **Local processing**: No data sent to the cloud
*   **Clipboard integration**: Automatically updates your clipboard with clean Markdown

## Usage

1.  **Select** text on any web page
2.  Press the keyboard shortcut:
    *   **Mac**: `Cmd + Shift + U`
    *   **Windows/Linux**: `Ctrl + Shift + U`
3.  **Paste** (`Cmd+V` / `Ctrl+V`)—now clean Markdown

## How It Works

1.  Background script listens for the command (`run-markdown-clean`)
2.  Programmatically triggers copy to get the browser's rich HTML
3.  Converts HTML to Markdown via [Turndown](https://github.com/mixmark-io/turndown), discarding style attributes
4.  Writes clean Markdown back to clipboard

## Dependencies

*   [Turndown](https://github.com/mixmark-io/turndown) — HTML to Markdown converter
*   [Turndown Plugin GFM](https://github.com/mixmark-io/turndown-plugin-gfm) — Tables and strikethrough support

## Permissions

*   `activeTab`: Execute script on current page
*   `scripting`: Inject library files
*   `clipboardRead` / `clipboardWrite`: Modify clipboard content

## Installation

Install as an unpacked extension:

1.  Clone or download this repository
2.  Open Chrome → `chrome://extensions`
3.  Enable **Developer mode** (top right)
4.  Click **Load unpacked**
5.  Select the project folder (containing `manifest.json`)

## Troubleshooting

### "Copy Failed: Clipboard content mismatch"

Prevents processing stale clipboard data.

**Causes:**

*   Browser blocked background copy (security restriction)
*   Clipboard doesn't match current selection

**Fix:**

1.  Click in the document to ensure focus
2.  Retry the shortcut
3.  If it persists, manually copy (`Cmd+C` / `Ctrl+C`) first, then run the shortcut