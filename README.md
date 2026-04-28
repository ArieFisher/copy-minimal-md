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

**Features:** It includes some clever features, like handling 'jagged' table selection.

e.g. [income statement](https://en.wikipedia.org/wiki/Income_statement#:~:text=Full%20consolidated%20statement%20of%20operations), contains a table:

| 2019 ($) | 2020 ($) | 2021 ($) |
| --- | --- | -- |
| 5,000 | 10,000 | 25,000 |

To copy the 2020 revenue, you click into the `2020 ($)` cell and drag until you have highlighted the value, then press `copy` (`ctrl\cmd-c`).

The **wrong information** goes into your clipboard (try it).

| 2020 ($) | 2021 ($) |
| --- | --- |
| 5,000 | 10,000 |

The clipboard stored a table where
- row 1: B1:C1
- row 2: A2:B2 -- two *different* columns.  The value under '`2020 ($)`' is the 2019 value (!)

By contrast, if you copy with this library, it takes the **selected values** in the **original structure**:

| | 2020 ($) | 2021 ($) |
| --- | --- | --- |
| 5,000 | 10,000 |  |

## Features
*   **Strips inline styles**: Removes font families, colors, and background highlights
*   **Preserves structure**: Headings, bold, italics, links, lists, and tables
*   **Clipboard integration**: Automatically updates the clipboard with clean Markdown
*   **Jagged tables**: Copies selected values in the correct structure
*   **ARIA tables**: Many sites no longer use traditional HTML `<table>` tags, but instead construct what looks like tables out of sophisticated HTML.
*   **TSV tables**: When users copy a table, many websites will only give the clipboard tab-separated values. This library converts those into traditional tables for easier pasting.
*   **Clipboard Inspector**: Want to see what's actually in your clipboard? Press `Ctrl`/`Cmd + Shift + O` to inspect clipboard contents.
*   **Local processing**: No data sent to an external service

## Usage

1.  **Select** text on any web page
2.  Press the keyboard shortcut:
    *   **Mac**: `Cmd + Shift + U`
    *   **Windows/Linux**: `Ctrl + Shift + U`
3.  **Paste** (`Cmd+V` / `Ctrl+V`) — pastes clean Markdown

## How It Works

1.  **Selection Capture**: The script captures the user's current selection and immediately analyzes the DOM for structured data (tables/grids).
2.  **Grid Detection (Strategy Pattern)**: Before the copy occurs, the `GridDetector` evaluates the selection against three strategies:
    *   **Native Table**: Detects standard `<table>` structures. It calculates a "bounding box" of the selection and reconstructs a perfect grid in memory, padding unselected cells with empty spaces to maintain alignment.
    *   **ARIA Grid**: Detects modern data grids (divs/spans with `role="grid"`). It extracts the data and transforms it into a standard HTML `<table>` for the Markdown converter.
    *   **Heuristic Div (Planned)**: Fingerprints custom `display: flex/grid` containers that lack semantic markers.
3.  **Native Copy Execution**: Triggers `document.execCommand('copy')` to simulate a `Cmd+C`. 
    *   *Why?* This is the only way to force complex apps (Google Docs, Notion, Confluence) to fire their custom serializers and provide the rich HTML payload we need.
4.  **Clipboard Repair & Synthesis**:
    *   **Repair**: If a native table was selected, the script replaces the browser's "jagged" clipboard HTML with the reconstructed "perfect" table from step 2.
    *   **Synthesis**: If an ARIA grid was detected but the browser provided no HTML payload, the script synthesizes a table directly from the DOM extraction.
5.  **Markdown Conversion**: Converts the final sanitized HTML to Markdown via [Turndown](https://github.com/mixmark-io/turndown).
6.  **TSV Fallback**: If no HTML is present but the plain text looks like Tab-Separated Values (TSV), it converts the TSV data directly into a Markdown table.
7.  **Clipboard Update**: Writes the final clean Markdown back to the clipboard.

## Dependencies

Third-party libraries are located in the `lib/` directory:
*   [Turndown](https://github.com/mixmark-io/turndown) — HTML to Markdown converter
*   [Turndown Plugin GFM](https://github.com/mixmark-io/turndown-plugin-gfm) — Tables and strikethrough support
*   [DOMPurify](https://github.com/cure53/dompurify) — Robust XSS sanitization for HTML payloads
*   [Marked](https://github.com/markedjs/marked) — Markdown parser (used for rendering previews in the Inspector)

## Chrome Extension Permissions

*   `activeTab`: Execute the script on the currently active tab.
*   `scripting`: Inject content scripts and library files into the page.
*   `clipboardRead` / `clipboardWrite`: Intercept and modify clipboard content for cleaning.

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
