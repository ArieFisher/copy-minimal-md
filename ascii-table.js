/**
 * ascii-table.js
 *
 * A table drawn in text → the table it draws.
 *
 * Database shells, CLI tools and chat replies print tables as characters:
 *
 *     +------+-----+      ┌──────┬─────┐       name | age      Name   Age
 *     | Name | Age |      │ Name │ Age │      ------+-----      -----  ---
 *     +------+-----+      ├──────┼─────┤       Bob  |  25      Bob    25
 *     | Bob  | 25  |      │ Bob  │ 25  │      (1 row)
 *     +------+-----+      └──────┴─────┘
 *
 * `parse` reads any of these into `{ title, header, rows }`, and `toNodes` builds
 * that into a real <table>. The cells go in with `textContent`, so a cell holding
 * a tag comes out as the tag's characters.
 *
 * A drawn table is rarely drawn perfectly, so `parse` repairs what it reads:
 *
 *   - a row with too few cells is padded, and a row with too many widens the
 *     table rather than losing a cell;
 *   - a border that is missing from one line, or out of line with the rest, is
 *     read from the border characters themselves rather than from their column;
 *   - a pipe inside a cell stays in the cell when the rules show it is not on a
 *     column boundary;
 *   - a cell wrapped across several lines, in a table that rules off every row,
 *     comes back as one cell;
 *   - a row or column with nothing in it is dropped, and so is a footer such as
 *     `(3 rows)`;
 *   - a full-width line above the column headings is kept as a title, ahead of
 *     the table, rather than squeezed into the first column.
 *
 * A table can sit among other text. `parseBlocks` splits the text at blank
 * lines and reads each block on its own, so a table set off by blank lines is
 * found wherever it is; the blocks around it are kept as text. A box with a
 * single column in it is not a table.
 *
 * A pipe table with a GFM delimiter row under its first line is Markdown
 * already, and is left for the Markdown reader. So is an entry whose text
 * around the table reads as Markdown: written out as plain text, its
 * emphasis, lists and links would come out escaped.
 *
 * Exports `window.AsciiTable = { parse, parseBlocks, toNodes, blocksToNodes,
 * detect }`. `detect` needs `Equivalents` (equivalents.js) and `PlainKind`
 * (plain-kind.js) at call time; the rest need nothing but a document.
 */
(function (global) {
    if (global.AsciiTable) return;

    /** Characters that draw a column border. */
    const VERTICALS = new Set(Array.from('|│┃┆┇┊┋╎╏║'));

    /** Characters that draw a horizontal rule. */
    const HORIZONTALS = new Set(Array.from('-=─━┄┅┈┉╌╍═'));

    /** The rule characters that set a header off from a body ruled with light ones. */
    const HEAVY = new Set(Array.from('=━═'));

    /** The fewest horizontal characters a rule is drawn with. */
    const MIN_RULE_LENGTH = 3;

    /** The fewest columns a table has; a box round one column is a frame. */
    const MIN_COLUMNS = 2;

    /** A row count printed under the table by psql, MySQL or SQL Server. */
    const FOOTER = /^(?:\(\d+ rows?(?: affected)?\)|\d+ rows? in set\b.*)$/i;

    /** A rule of dashes or equals signs in two or more runs, spaces between. */
    const UNDERLINE = /^\s*([-=])\1+(?:\s+\1{2,})+\s*$/;

    /** The delimiter row of a GFM table: pipes, dashes, colons, nothing else. */
    const GFM_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/;

    const TAB_WIDTH = 8;

    const isVertical = ch => VERTICALS.has(ch);
    const isBoxDrawing = ch => ch >= '─' && ch <= '╿';
    const isRuleMark = ch => ch === '+' || ch === ':' || HORIZONTALS.has(ch) || isVertical(ch) || isBoxDrawing(ch);

    /** Where two rules cross, or a rule meets a border: a column boundary. */
    const isJunction = ch => ch !== ':' && !/\s/.test(ch) && !HORIZONTALS.has(ch);

    /* ---------------------------------------------------------------- lines */

    /** The non-blank lines, with trailing space and a row-count footer cut off. */
    function linesOf(text) {
        const lines = text
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map(line => line.trimEnd())
            .filter(line => line.trim() !== '');
        const last = lines[lines.length - 1];
        return last !== undefined && FOOTER.test(last.trim()) ? lines.slice(0, -1) : lines;
    }

    /** A line drawn with rule characters and no text. */
    function isRule(line) {
        const marks = Array.from(line).filter(ch => !/\s/.test(ch));
        if (!marks.every(isRuleMark)) return false;
        const runs = marks.filter(ch => HORIZONTALS.has(ch)).length;
        return runs >= MIN_RULE_LENGTH && runs * 2 >= marks.length;
    }

    const hasVertical = line => Array.from(line).some(isVertical);
    const firstMark = line => line.trimStart().charAt(0);
    const lastMark = line => line.charAt(line.length - 1);
    const isHeavyRule = rule => !!rule && Array.from(rule).some(ch => HEAVY.has(ch));

    /** One tab stop's worth of spaces in place of each tab, so columns line up. */
    function expandTabs(line) {
        let column = 0;
        return Array.from(line).map(ch => {
            if (ch !== '\t') {
                column += 1;
                return ch;
            }
            const pad = TAB_WIDTH - (column % TAB_WIDTH);
            column += pad;
            return ' '.repeat(pad);
        }).join('');
    }

    /* ---------------------------------------------------------------- cells */

    /**
     * The line's cells, cut where the rule has a junction. Null unless the line
     * has a border character at every one of those places, which is the sign
     * that it was drawn on the same grid.
     *
     * Cutting by position is what keeps a pipe inside a cell in its cell.
     */
    function cutAtJunctions(line, rule) {
        const ruleChars = Array.from(rule);
        const lineChars = Array.from(line);
        const cuts = ruleChars.flatMap((ch, i) => (isJunction(ch) ? [i] : []));
        if (cuts.length === 0) return null;
        if (!cuts.every(i => isVertical(lineChars[i]))) return null;
        if (lineChars.slice(ruleChars.length).some(isVertical)) return null;

        const ruleStart = ruleChars.findIndex(ch => !/\s/.test(ch));
        const opensWithBorder = cuts[0] === ruleStart;
        const closesWithBorder = cuts[cuts.length - 1] === ruleChars.length - 1;

        const edges = [opensWithBorder ? null : -1, ...cuts, closesWithBorder ? null : lineChars.length]
            .filter(edge => edge !== null);
        return edges.slice(1).map((end, i) => lineChars.slice(edges[i] + 1, end).join('').trim());
    }

    /** The line's cells, split at every border character. */
    function splitAtBorders(line, borders) {
        let body = line.trim();
        if (borders.left && isVertical(body.charAt(0))) body = body.slice(1);
        if (borders.right && isVertical(lastMark(body))) body = body.slice(0, -1);
        return Array.from(body).reduce((cells, ch) => (
            isVertical(ch)
                ? [...cells, '']
                : [...cells.slice(0, -1), cells[cells.length - 1] + ch]
        ), ['']).map(cell => cell.trim());
    }

    /**
     * Whether the table draws a left and a right border. Decided by most of its
     * lines, so one line that lost its border is read the same as the rest
     * instead of losing its first or last cell.
     */
    function bordersOf(lines) {
        const most = count => count * 2 > lines.length;
        return {
            left: most(lines.filter(line => isVertical(firstMark(line))).length),
            right: most(lines.filter(line => isVertical(lastMark(line))).length)
        };
    }

    /** Several lines of one row, each cell's pieces joined back together. */
    function mergeLines(cellLists) {
        const width = Math.max(...cellLists.map(cells => cells.length));
        return Array.from({ length: width }, (_, i) =>
            cellLists.map(cells => cells[i] || '').filter(Boolean).join(' ')
        );
    }

    /* ------------------------------------------------------------- bordered */

    /** Runs of text lines, each with the rule drawn above it. */
    function groupsOf(lines) {
        return lines.reduce(({ groups, rule }, line) => {
            if (isRule(line)) return { groups, rule: line };
            const open = groups[groups.length - 1];
            if (open && rule === null) {
                return { groups: [...groups.slice(0, -1), { ...open, lines: [...open.lines, line] }], rule };
            }
            return { groups: [...groups, { lines: [line], ruleBefore: rule }], rule: null };
        }, { groups: [], rule: null }).groups;
    }

    /** One line, then a GFM delimiter row, then no other rule: Markdown. */
    function isGfmTable(lines) {
        return lines.length >= 2
            && !isRule(lines[0])
            && GFM_DELIMITER.test(lines[1])
            && !lines.slice(2).some(isRule);
    }

    /**
     * A first line with one cell, above a table with several columns, is the
     * table's title. Null when there is none.
     */
    function titleOf(groups) {
        const [first, ...rest] = groups;
        if (!first || rest.length === 0 || first.rows.length !== 1) return null;
        const cells = first.rows[0].filter(Boolean);
        const widest = Math.max(...rest.flatMap(group => group.rows.map(row => row.length)));
        return cells.length === 1 && first.rows[0].length === 1 && widest >= MIN_COLUMNS ? cells[0] : null;
    }

    /**
     * Which lines are the header and which are the body.
     *
     *   - One run of lines, no rule between them: no header.
     *   - Two runs: the rule between them sets off the header, as MySQL and
     *     psql draw it. Each line of the body is a row.
     *   - More: the table rules off every row, so each run is one row, wrapped
     *     over its lines. The first is a header only when the rule under it is
     *     drawn heavier than the rules under the rest.
     */
    function headerAndBody(groups) {
        if (groups.length === 1) return { header: null, rows: groups[0].rows };
        if (groups.length === 2) return { header: mergeLines(groups[0].rows), rows: groups[1].rows };

        const ruled = groups.map(group => mergeLines(group.rows));
        const headed = isHeavyRule(groups[1].ruleBefore)
            && !groups.slice(2).some(group => isHeavyRule(group.ruleBefore));
        return headed ? { header: ruled[0], rows: ruled.slice(1) } : { header: null, rows: ruled };
    }

    function parseBordered(lines) {
        const text = lines.filter(line => !isRule(line));
        if (text.length < 2 || !text.every(hasVertical)) return null;
        if (isGfmTable(lines)) return null;

        const rules = lines.filter(isRule);
        const borders = bordersOf(text);
        if (rules.length === 0 && !text.every(line => isVertical(firstMark(line)) && isVertical(lastMark(line)))) {
            return null;
        }

        // The rule with the most columns first, so a full-width title rule
        // does not swallow a row that is drawn on the finer grid below it.
        const grids = [...rules].sort((a, b) =>
            Array.from(b).filter(isJunction).length - Array.from(a).filter(isJunction).length
        );
        const cellsOf = line => grids.reduce(
            (cells, rule) => cells || cutAtJunctions(line, rule), null
        ) || splitAtBorders(line, borders);

        const groups = groupsOf(lines).map(group => ({ ...group, rows: group.lines.map(cellsOf) }));
        const title = titleOf(groups);
        return { title, ...headerAndBody(title === null ? groups : groups.slice(1)) };
    }

    /* ----------------------------------------------------------- underlined */

    /** Each run of rule characters in an underline, as `[start, end)`. */
    function runsOf(rule) {
        return Array.from(rule.matchAll(/[-=]+/g), match => [match.index, match.index + match[0].length]);
    }

    /**
     * A table aligned with spaces, its header underlined with dashes:
     *
     *     Name     Age
     *     -------  ---
     *     Bob      25
     *
     * Each run of dashes is a column. A column's cells start halfway across the
     * gap before its run, which takes in text that sits a little left of it.
     * A rule above the header and one under the body, as reStructuredText
     * draws them, are allowed.
     */
    function parseUnderlined(lines) {
        const flat = lines.map(expandTabs);
        const body = UNDERLINE.test(flat[0]) ? flat.slice(1) : flat;
        if (body.length < 3 || !UNDERLINE.test(body[1]) || UNDERLINE.test(body[0])) return null;

        const runs = runsOf(body[1]);
        const starts = runs.map(([start], i) => (i === 0 ? 0 : runs[i - 1][1] + Math.floor((start - runs[i - 1][1]) / 2)));
        const cut = line => starts.map((start, i) => line.slice(start, starts[i + 1]).trim());

        const header = cut(body[0]);
        if (header.filter(Boolean).length < MIN_COLUMNS) return null;
        const rows = body.slice(2).filter(line => !UNDERLINE.test(line)).map(cut);
        return { title: null, header, rows };
    }

    /* ---------------------------------------------------------------- shape */

    /**
     * Every row the same width, and nothing in it that holds nothing: empty
     * rows and empty columns go, and so does a header row with no text in it.
     * Null when what is left is not a table.
     */
    function normalise(table) {
        const all = table.header ? [table.header, ...table.rows] : table.rows;
        const width = Math.max(0, ...all.map(row => row.length));
        const pad = row => Array.from({ length: width }, (_, i) => row[i] || '');

        const padded = all.map(pad);
        const kept = Array.from({ length: width }, (_, i) => i).filter(i => padded.some(row => row[i]));
        const narrow = row => kept.map(i => row[i]);

        const headerCells = table.header ? narrow(padded[0]) : null;
        const header = headerCells && headerCells.some(Boolean) ? headerCells : null;
        const rows = (table.header ? padded.slice(1) : padded).map(narrow).filter(row => row.some(Boolean));

        if (kept.length < MIN_COLUMNS) return null;
        if (rows.length + (header ? 1 : 0) < 2) return null;
        return { title: table.title, header, rows };
    }

    /* ---------------------------------------------------------------- API */

    /** `{ title, header, rows }` for a table drawn in text, else null. */
    function parse(text) {
        if (!text) return null;
        const lines = linesOf(text);
        if (lines.length < 2) return null;
        const table = parseBordered(lines) || parseUnderlined(lines);
        return table ? normalise(table) : null;
    }

    /**
     * The parsed table as nodes of `doc`: a paragraph for the title when there
     * is one, then the table. A header row goes in a <thead>; a table with
     * none has no header row made up for it.
     */
    function toNodes(table, doc) {
        const fragment = doc.createDocumentFragment();
        const element = (tag, text) => {
            const node = doc.createElement(tag);
            if (text !== undefined) node.textContent = text;
            return node;
        };
        const row = (cells, tag) => {
            const tr = element('tr');
            cells.forEach(text => tr.appendChild(element(tag, text)));
            return tr;
        };

        if (table.title) fragment.appendChild(element('p', table.title));

        const tableEl = element('table');
        if (table.header) {
            const thead = element('thead');
            thead.appendChild(row(table.header, 'th'));
            tableEl.appendChild(thead);
        }
        const tbody = element('tbody');
        table.rows.forEach(cells => tbody.appendChild(row(cells, 'td')));
        tableEl.appendChild(tbody);
        fragment.appendChild(tableEl);
        return fragment;
    }

    /** A blank line, or one holding only spaces: where one block ends. */
    const BLOCK_BREAK = /\n[^\S\n]*\n/;

    /**
     * The text cut into blocks at blank lines, each either `{ table }` or
     * `{ lines }` of text. Null when no block is a table.
     */
    function parseBlocks(text) {
        if (!text) return null;
        const blocks = text
            .replace(/\r\n?/g, '\n')
            .split(BLOCK_BREAK)
            .filter(block => block.trim() !== '')
            .map(block => {
                const table = parse(block);
                return table ? { table } : { lines: block.split('\n').map(line => line.trimEnd()) };
            });
        return blocks.some(block => block.table) ? blocks : null;
    }

    /** Neighbouring text blocks as one, with the blank line between them kept. */
    function joinTextRuns(blocks) {
        return blocks.reduce((joined, block) => {
            const last = joined[joined.length - 1];
            if (block.lines && last && last.lines) {
                return [...joined.slice(0, -1), { lines: [...last.lines, '', ...block.lines] }];
            }
            return [...joined, block];
        }, []);
    }

    /**
     * The blocks as nodes of `doc`. A table block becomes its table. A text
     * block becomes a paragraph with its line breaks kept, or, with
     * `textTag: 'pre'`, preformatted text as it was — one <pre> for each run
     * of text between tables, so code with blank lines in it stays one block.
     */
    function blocksToNodes(blocks, doc, { textTag = 'p' } = {}) {
        const fragment = doc.createDocumentFragment();
        (textTag === 'pre' ? joinTextRuns(blocks) : blocks).forEach(block => {
            if (block.table) {
                fragment.appendChild(toNodes(block.table, doc));
                return;
            }
            const node = doc.createElement(textTag);
            if (textTag === 'pre') {
                node.textContent = block.lines.join('\n');
            } else {
                block.lines.forEach((line, i) => {
                    if (i > 0) node.appendChild(doc.createElement('br'));
                    node.appendChild(doc.createTextNode(line));
                });
            }
            fragment.appendChild(node);
        });
        return fragment;
    }

    /**
     * Whether a text block would be read as Markdown. With no PlainKind to
     * ask, every block counts as Markdown, so text around a table is never
     * escaped on a guess.
     */
    const readsAsMarkdown = block => typeof PlainKind === 'undefined'
        || PlainKind.of(block.lines.join('\n')) === 'markdown';

    /**
     * Both equivalents for a text/plain entry holding a drawn table, or null.
     * Same shape as `TsvDetector.detect`, and the same derivation behind it.
     */
    function detect({ hasHtml, plainText }) {
        if (hasHtml) return null;
        const blocks = parseBlocks(plainText);
        if (!blocks) return null;
        if (blocks.some(block => block.lines && readsAsMarkdown(block))) return null;

        const doc = new DOMParser().parseFromString('', 'text/html');
        doc.body.appendChild(blocksToNodes(blocks, doc));
        const { markdown, simpleHtml } = Equivalents.fromHtml(doc.body.innerHTML);

        return { markdown, simpleHtml, plainText, sourceType: 'Plain Text (ASCII Table)' };
    }

    global.AsciiTable = { parse, parseBlocks, toNodes, blocksToNodes, detect };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof window !== 'undefined' ? window : globalThis).AsciiTable;
}
