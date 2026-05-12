import { describe, it, expect, beforeEach } from 'vitest';

let GridDetector;

function selectAll() {
  const range = document.createRange();
  range.selectNodeContents(document.body);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return sel;
}

beforeEach(() => {
  document.body.innerHTML = '';
  // Reload module fresh-ish; GridDetector is a singleton attached to window.
  delete window.GridDetector;
  delete require.cache[require.resolve('../grid-detector.js')];
  GridDetector = require('../grid-detector.js');
});

describe('GridDetector.extract', () => {
  it('returns null when no selection exists', () => {
    const sel = window.getSelection();
    sel.removeAllRanges();
    expect(GridDetector.extract(sel)).toBeNull();
  });

  it('detects a native <table> in the selection', () => {
    document.body.innerHTML = `
      <table id="t">
        <tr><th>Name</th><th>Age</th></tr>
        <tr><td>Alice</td><td>30</td></tr>
        <tr><td>Bob</td><td>25</td></tr>
      </table>
    `;
    const result = GridDetector.extract(selectAll());
    expect(result).not.toBeNull();
    expect(result.type).toBe('native');
    expect(result.tables).toHaveLength(1);
    const out = result.tables[0];
    expect(out.tagName).toBe('TABLE');
    expect(out.querySelectorAll('tr')).toHaveLength(3);
    expect(out.querySelectorAll('th')).toHaveLength(2);
  });

  it('detects an ARIA grid (role="grid")', () => {
    document.body.innerHTML = `
      <div role="grid">
        <div role="row">
          <span role="columnheader">A</span>
          <span role="columnheader">B</span>
        </div>
        <div role="row">
          <span role="gridcell">1</span>
          <span role="gridcell">2</span>
        </div>
      </div>
    `;
    const result = GridDetector.extract(selectAll());
    expect(result).not.toBeNull();
    expect(result.type).toBe('aria');
    expect(result.tables.length).toBeGreaterThan(0);
    const out = result.tables[0];
    expect(out.querySelectorAll('tr').length).toBeGreaterThanOrEqual(2);
  });

  it('detects role="table" with role="row" / role="cell"', () => {
    document.body.innerHTML = `
      <div role="table">
        <div role="row"><div role="cell">x</div><div role="cell">y</div></div>
        <div role="row"><div role="cell">1</div><div role="cell">2</div></div>
      </div>
    `;
    const result = GridDetector.extract(selectAll());
    expect(result).not.toBeNull();
    expect(result.type).toBe('aria');
  });

  it('returns null for unstructured content', () => {
    document.body.innerHTML = '<p>just some paragraph text</p><p>more text</p>';
    expect(GridDetector.extract(selectAll())).toBeNull();
  });

  it('prefers native over ARIA when both are present', () => {
    document.body.innerHTML = `
      <table><tr><td>n1</td><td>n2</td></tr></table>
      <div role="grid"><div role="row"><span role="gridcell">a1</span></div></div>
    `;
    const result = GridDetector.extract(selectAll());
    expect(result.type).toBe('native');
  });
});
