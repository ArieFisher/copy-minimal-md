import { describe, it, expect, beforeAll } from 'vitest';

let AsciiTable;
let fromHtml;

beforeAll(() => {
  // The adapter loads ascii-table.js before equivalents.js, the order the
  // extension loads them in; detect() needs Equivalents in place.
  fromHtml = require('./_adapter.js').fromHtml;
  AsciiTable = require('../ascii-table.js');
});

const parse = (lines) => AsciiTable.parse(lines.join('\n'));

describe('AsciiTable.parse — formats', () => {
  it('reads a MySQL table and drops the row count', () => {
    expect(parse([
      '+------+-----+',
      '| Name | Age |',
      '+------+-----+',
      '| Bob  | 25  |',
      '| Ann  | 30  |',
      '+------+-----+',
      '2 rows in set (0.00 sec)',
    ])).toEqual({
      title: null,
      header: ['Name', 'Age'],
      rows: [['Bob', '25'], ['Ann', '30']],
    });
  });

  it('reads a psql table and drops the row count', () => {
    expect(parse([
      ' name | age',
      '------+-----',
      ' Bob  |  25',
      ' Ann  |  30',
      '(2 rows)',
    ])).toEqual({
      title: null,
      header: ['name', 'age'],
      rows: [['Bob', '25'], ['Ann', '30']],
    });
  });

  it('reads a box-drawing table', () => {
    expect(parse([
      '┌──────┬─────┐',
      '│ Name │ Age │',
      '├──────┼─────┤',
      '│ Bob  │ 25  │',
      '└──────┴─────┘',
    ])).toEqual({ title: null, header: ['Name', 'Age'], rows: [['Bob', '25']] });
  });

  it('reads a double-line box table', () => {
    expect(parse([
      '╔══════╦═════╗',
      '║ Name ║ Age ║',
      '╠══════╬═════╣',
      '║ Bob  ║ 25  ║',
      '╚══════╩═════╝',
    ])).toEqual({ title: null, header: ['Name', 'Age'], rows: [['Bob', '25']] });
  });

  it('reads a pipe table with borders and no rules, as headerless', () => {
    expect(parse([
      '| Name | Age |',
      '| Bob  | 25  |',
    ])).toEqual({ title: null, header: null, rows: [['Name', 'Age'], ['Bob', '25']] });
  });

  it('reads a table underlined with dashes', () => {
    expect(parse([
      'Name     Age  City',
      '-------  ---  ------',
      'Bob      25   Paris',
      'Ann      30   Rome',
    ])).toEqual({
      title: null,
      header: ['Name', 'Age', 'City'],
      rows: [['Bob', '25', 'Paris'], ['Ann', '30', 'Rome']],
    });
  });

  it('reads a reStructuredText simple table', () => {
    expect(parse([
      '=====  =====',
      'A      B',
      '=====  =====',
      'False  True',
      '=====  =====',
    ])).toEqual({ title: null, header: ['A', 'B'], rows: [['False', 'True']] });
  });

  it('marks a header set off by a heavier rule in a table that rules every row', () => {
    expect(parse([
      '+------+-----+',
      '| Name | Age |',
      '+======+=====+',
      '| Bob  | 25  |',
      '+------+-----+',
      '| Ann  | 30  |',
      '+------+-----+',
    ])).toEqual({ title: null, header: ['Name', 'Age'], rows: [['Bob', '25'], ['Ann', '30']] });
  });

  it('marks no header when every rule is drawn alike', () => {
    expect(parse([
      '+------+-----+',
      '| Name | Age |',
      '+------+-----+',
      '| Bob  | 25  |',
      '+------+-----+',
      '| Ann  | 30  |',
      '+------+-----+',
    ])).toEqual({ title: null, header: null, rows: [['Name', 'Age'], ['Bob', '25'], ['Ann', '30']] });
  });
});

describe('AsciiTable.parse — repairs', () => {
  it('pads a row with too few cells', () => {
    expect(parse([
      '+---+---+---+',
      '| a | b | c |',
      '+---+---+---+',
      '| 1 | 2 |',
      '+---+---+---+',
    ]).rows).toEqual([['1', '2', '']]);
  });

  it('widens the table for a row with too many cells, rather than losing one', () => {
    const table = parse([
      '| a | b |',
      '| 1 | 2 | 3 |',
    ]);
    expect(table.rows).toEqual([['a', 'b', ''], ['1', '2', '3']]);
  });

  it('reads a row whose borders are out of line with the rest', () => {
    expect(parse([
      '+------+-----+',
      '| Name | Age |',
      '+------+-----+',
      '| Bartholomew | 25 |',
      '|Ann|30|',
      '+------+-----+',
    ]).rows).toEqual([['Bartholomew', '25'], ['Ann', '30']]);
  });

  it('keeps the first cell of a row that lost its left border', () => {
    expect(parse([
      '+------+-----+',
      '| Name | Age |',
      '+------+-----+',
      '  Bob  | 25  |',
      '| Ann  | 30  |',
      '+------+-----+',
    ]).rows).toEqual([['Bob', '25'], ['Ann', '30']]);
  });

  it('keeps a pipe inside a cell when the rules put no column there', () => {
    expect(parse([
      '+---------+-----+',
      '| Cmd     | Ok  |',
      '+---------+-----+',
      '| ls | wc | yes |',
      '+---------+-----+',
    ]).rows).toEqual([['ls | wc', 'yes']]);
  });

  it('joins a cell wrapped over several lines', () => {
    expect(parse([
      '+------+-----------+',
      '| Name | Note      |',
      '+======+===========+',
      '| Bob  | first     |',
      '|      | second    |',
      '+------+-----------+',
      '| Ann  | only      |',
      '+------+-----------+',
    ]).rows).toEqual([['Bob', 'first second'], ['Ann', 'only']]);
  });

  it('drops empty rows and empty columns', () => {
    expect(parse([
      '+---+--+---+',
      '| a |  | b |',
      '+---+--+---+',
      '|   |  |   |',
      '| 1 |  | 2 |',
      '+---+--+---+',
    ])).toEqual({ title: null, header: ['a', 'b'], rows: [['1', '2']] });
  });

  it('keeps a full-width first line as the title', () => {
    expect(parse([
      '+-------------+',
      '|   Results   |',
      '+------+------+',
      '| Name | Age  |',
      '+------+------+',
      '| Bob  | 25   |',
      '+------+------+',
    ])).toEqual({ title: 'Results', header: ['Name', 'Age'], rows: [['Bob', '25']] });
  });

  it('mixes ASCII and box-drawing borders', () => {
    expect(parse([
      '+------+-----+',
      '│ Name | Age │',
      '├------+-----┤',
      '| Bob  │ 25  |',
      '+------+-----+',
    ])).toEqual({ title: null, header: ['Name', 'Age'], rows: [['Bob', '25']] });
  });

  it('reads CRLF line endings and blank lines around the table', () => {
    expect(parse([
      '',
      '+---+---+',
      '| a | b |',
      '+---+---+',
      '| 1 | 2 |',
      '+---+---+',
      '',
    ]).rows).toEqual([['1', '2']]);
    expect(AsciiTable.parse('| a | b |\r\n| 1 | 2 |\r\n').rows).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('AsciiTable.parse — not a table', () => {
  it.each([
    ['empty text', ''],
    ['one line', '| a | b |'],
    ['prose', 'Some words here.\nAnd a few more.'],
    ['prose with a pipe on one line', 'Home | About\nWelcome to the site.'],
    ['pipes without borders or rules', 'a | b\nc | d'],
    ['a box round one column', '+-------+\n| note  |\n| more  |\n+-------+'],
    ['a GFM table, which is Markdown already', '| a | b |\n| --- | --- |\n| 1 | 2 |'],
    ['a setext heading', 'Title\n-----\nText'],
  ])('%s', (_, text) => {
    expect(AsciiTable.parse(text)).toBeNull();
  });
});

describe('AsciiTable.detect', () => {
  const MYSQL = [
    '+------+-----+',
    '| Name | Age |',
    '+------+-----+',
    '| Bob  | 25  |',
    '+------+-----+',
  ].join('\n');

  it('returns null when HTML is present', () => {
    expect(AsciiTable.detect({ hasHtml: true, plainText: MYSQL })).toBeNull();
  });

  it('writes the Markdown table and the HTML table', () => {
    const out = AsciiTable.detect({ hasHtml: false, plainText: MYSQL });
    expect(out.markdown).toBe('| Name | Age |\n| --- | --- |\n| Bob | 25 |');
    expect(out.simpleHtml).toBe('<table><thead><tr><th>Name</th><th>Age</th></tr></thead><tbody><tr><td>Bob</td><td>25</td></tr></tbody></table>');
    expect(out.sourceType).toBe('Plain Text (ASCII Table)');
  });

  it('writes the title ahead of the table', () => {
    const out = AsciiTable.detect({
      hasHtml: false,
      plainText: '+---------+\n| Results |\n+----+----+\n| a  | b  |\n+----+----+\n| 1  | 2  |\n+----+----+',
    });
    expect(out.markdown).toBe('Results\n\n| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(out.simpleHtml).toContain('<p>Results</p><table>');
  });

  it('writes a cell holding a tag as text in both entries', () => {
    const out = AsciiTable.detect({ hasHtml: false, plainText: '| Tag | Note |\n| <b> | x |' });
    expect(out.markdown).toContain('\\<b>');
    expect(out.simpleHtml).toContain('<td>&lt;b&gt;</td>');
  });
});

describe('a table among other text', () => {
  const TABLE = '+------+-----+\n| Name | Age |\n+------+-----+\n| Bob  | 25  |\n+------+-----+';

  it('is found between paragraphs set off by blank lines', () => {
    const blocks = AsciiTable.parseBlocks(`Here are the users:\n\n${TABLE}\n\nThat is all.`);
    expect(blocks).toEqual([
      { lines: ['Here are the users:'] },
      { table: { title: null, header: ['Name', 'Age'], rows: [['Bob', '25']] } },
      { lines: ['That is all.'] },
    ]);
  });

  it('is not found in text with no table in it', () => {
    expect(AsciiTable.parseBlocks('One paragraph.\n\nAnother | with a pipe.')).toBeNull();
  });

  it('writes the paragraphs around the table in both entries', () => {
    const out = AsciiTable.detect({
      hasHtml: false,
      plainText: `Here are the users:\n\n${TABLE}\n\nThat is all.`,
    });
    expect(out.markdown).toBe('Here are the users:\n\n| Name | Age |\n| --- | --- |\n| Bob | 25 |\n\nThat is all.');
    expect(out.simpleHtml).toMatch(/^<p>Here are the users:<\/p><table>.*<\/table><p>That is all\.<\/p>$/);
  });

  it('keeps the line breaks inside a paragraph', () => {
    const out = AsciiTable.detect({ hasHtml: false, plainText: `Line one\nLine two\n\n${TABLE}` });
    expect(out.simpleHtml).toContain('<p>Line one<br>Line two</p>');
    expect(out.markdown).toMatch(/^Line one\s*\nLine two\n\n\| Name/);
  });

  it('escapes prose that holds a tag', () => {
    const out = AsciiTable.detect({ hasHtml: false, plainText: `Uses <b> tags\n\n${TABLE}` });
    expect(out.simpleHtml).toContain('<p>Uses &lt;b&gt; tags</p>');
  });

  it('leaves an entry alone when the text around the table reads as Markdown', () => {
    expect(AsciiTable.detect({ hasHtml: false, plainText: `**Users**\n\n${TABLE}` })).toBeNull();
    expect(AsciiTable.detect({ hasHtml: false, plainText: `- one\n- two\n\n${TABLE}` })).toBeNull();
  });
});

describe('a table drawn in a <pre> of an HTML copy', () => {
  it('is found below a caption in the same block', () => {
    const { simpleHtml } = fromHtml('<pre>Users\n\n+---+---+\n| a | b |\n+---+---+\n| 1 | 2 |\n+---+---+</pre>');
    expect(simpleHtml).toMatch(/^<pre>Users<\/pre><table>/);
  });

  it('keeps the code around it as one preformatted block', () => {
    const { simpleHtml } = fromHtml('<pre>a = 1\n\nb = 2\n\n| x | y |\n| 1 | 2 |</pre>');
    expect(simpleHtml).toMatch(/^<pre>a = 1\n\nb = 2<\/pre><table>/);
  });

  it('becomes a table in both equivalents', () => {
    const { markdown, simpleHtml } = fromHtml(
      '<p>Result:</p><pre><code>+------+-----+\n| Name | Age |\n+------+-----+\n| Bob  | 25  |\n+------+-----+</code></pre>'
    );
    expect(markdown).toBe('Result:\n\n| Name | Age |\n| --- | --- |\n| Bob | 25 |');
    expect(simpleHtml).toContain('<thead><tr><th>Name</th><th>Age</th></tr></thead>');
    expect(simpleHtml).not.toContain('<pre>');
  });

  it('leaves a <pre> that is not a table as code', () => {
    const { markdown } = fromHtml('<pre><code>const a = 1 | 2;\nconst b = 3;</code></pre>');
    expect(markdown).toContain('```');
  });
});
