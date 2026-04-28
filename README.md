* * *

# A new 'copy' function for the browser-only users

Converts copied web content to Markdown—preserving structure (tables, headers, lists) while stripping source formatting.

## The Problem

**1\. Copy-paste often breaks.** Copy a table from a spreadsheet...

| Revenue | Impressions |
| --- | --- |
| 1512721 | 4031139 |
| 1397029 | 2114095 |
| 1017926 | 376937 |
| 74201 | 147111 |

... and paste it into an LLM, and you get the text but no structure (not even spaces between cell contents).  Claude and Gemini would see this:

```
RevenueImpressions1512721403113913970292114095101792637693774201147111
```

## The Solution: a new 'copy' function

This one desiged for portability: it copies *text* and *structure* -- in a way that LLMs natively understand.

Which format?  JSON preserves text and structure while shedding formatting.  So does XML. 

### Markdown
While LLMs can interpret this format, there is a lighter weight choice that is natively understood by more and more tools.  When a Markdown table is pasted into many tools, it will render as an actual table (not true for JSON or XML): tools like Google Docs, Notion, Obsidian, python / jupyter notebooks, Confluence, Jira, GitHub, and a host of others.

The solution is a new **copy function** that copies the selection and then converts the clipboard contents into **Markdown**.

It is desiged for data 'portability':

(1) copying tables between spreadsheets and LLMs

(2) copying regular text between 'websites' (traditional websites, SaaS tools, LLM chatbots ....):

This second way helps avoid a tedious dance that you may have experience with:

 * copy from the web/LLM/....
 * paste into a Google Doc
 * select all of that newly pasted text:
     * 'Copy As Markdown'
     * delete
     * Format -> "Normal Text"
     * 'Paste from Markdown'

Instead:

 * copy-minimal-md ....
 * 'Paste from Markdown' into a Google Doc (or regular paste into many other tools)


## Why have I developed this tool?

**Learning:** To experiment with Agentic Development applied to a (minor) irritant.

**Security:** I try to avoid installing Chrome Extensions and software from unknown authors.

**Unique use case:** Some alternatives (like [Markdownload](https://github.com/deathau/markdownload)) or the very cool [Jina.ai](https://jina.ai/reader/) extract full pages and save them as files. I wanted to use/create a very simple clipboard utility.  note: simplicity is not synonymous with 'easy'.

**Should you use this tool?** There are many mature, well-maintained, more feature-rich tools; use what feels good to you.

## Features
*   **Strips inline styles**: Removes font families, colors, and background highlights
*   **Preserves structure**: Headings, bold, italics, links, lists, and tables
*   **Clipboard integration**: Automatically updates your clipboard with clean Markdown
*   **Local processing**: No data sent to an external service

## Usage

1.  **Select** text on any web page
2.  Press the keyboard shortcut:
    *   **Mac**: `Cmd + Shift + U`
    *   **Windows/Linux**: `Ctrl + Shift + U`
3.  **Paste** (`Cmd+V` / `Ctrl+V`) — pastes clean Markdown

## How It Works

1.  Background script listens for the command (`run-markdown-clean`)
2.  Programmatically triggers 'copy' (`document.execCommand('copy')`) to simulate a native user copy (`Cmd+C`). 
    *   *Why use a deprecated API?* Modern APIs (`navigator.clipboard.writeText`) require explicit string data and bypass the browser's native copy logic. Using `execCommand` forces the browser—and complex host apps like Google Docs, Notion, or code editors—to fire their custom event listeners. This is the only reliable way to guarantee they serialize their complex internal state into the rich HTML format, allowing the script to grab the exact same clipboard data a real user would get.
3.  Converts HTML to Markdown via [Turndown](https://github.com/mixmark-io/turndown), discarding style attributes
4.  Writes clean Markdown back to clipboard
5.  **TSV Fallback**: If no HTML is present, but the plain text looks like Tab-Separated Values (TSV), it converts the TSV data directly into a Markdown table structure. This is especially useful for modern data grids (like Databricks) that intercept copy events and provide only raw TSV text.
6.  **Plain Text Fallback**: If no HTML or TSV is present, it re-writes plain text to scrub hidden metadata (e.g., RTF or vendor tags).

## Dependencies

*   [Turndown](https://github.com/mixmark-io/turndown) — HTML to Markdown converter
*   [Turndown Plugin GFM](https://github.com/mixmark-io/turndown-plugin-gfm) — Tables and strikethrough support

## Chrome Extension Permissions

*   `activeTab`: Execute script on current page
*   `scripting`: Inject library files
*   `clipboardRead` / `clipboardWrite`: Modify clipboard content

## Installation

Install as an unpacked extension:

1.  Download this repository
2.  Open Chrome → `chrome://extensions`
3.  Enable **Developer mode** (top right)
4.  Click **Load unpacked**
5.  Select the project folder (containing `manifest.json`)

## Troubleshooting

### "Copy Failed: Clipboard content mismatch"

**issue:** When the clipboard contents doesn't match current selection, it won't run (and risk overwriting whatever you already had in the clipboard.)
**fix:**  manually copy (`Cmd+C` / `Ctrl+C`) first, then run the shortcut.  
**fix:**  manually copy (`Cmd+C` / `Ctrl+C`) first.  Then deselect text and press `Cmd + Shift + U`.  This will convert *what is already inside the clipboard*.
