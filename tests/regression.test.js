/**
 * Regression fixture runner.
 *
 * Each subdir of tests/regressions/ is one captured bug or pinned behavior:
 *   tests/regressions/<slug>/
 *     input.html      - HTML fed to the pipeline (or full DOM if isFullDom: true)
 *     expected.md     - asserted Markdown output
 *     notes.md        - human notes (URL, observed vs expected, repro)
 *     fixture.json    - optional: { isFullDom: bool, gridResult: object|null }
 *     expected.simple.html
 *                     - optional: asserted Simple HTML, the other equivalent the
 *                       inspector offers. Only fixtures that ship this file
 *                       assert it, so a Markdown-only regression stays a
 *                       one-file affair.
 *
 * Adding a regression = drop a folder. No test code changes needed.
 *
 * When `isFullDom` is true the input.html is parsed and GridDetector.extract()
 * runs against the parsed body's selection, then htmlToMarkdown receives the
 * body.innerHTML as the clipboard HTML payload. This mirrors how content.js
 * sees a real selection.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const UPDATE = process.env.UPDATE_FIXTURES === '1';

const { htmlToMarkdown, fromHtml } = require('./_adapter.js');

const FIXTURES_DIR = resolve(__dirname, 'regressions');

function listFixtures() {
  if (!existsSync(FIXTURES_DIR)) return [];
  return readdirSync(FIXTURES_DIR)
    .filter((name) => !name.startsWith('.') && !name.startsWith('_'))
    .filter((name) => statSync(join(FIXTURES_DIR, name)).isDirectory());
}

describe('regression fixtures', () => {
  const fixtures = listFixtures();
  if (fixtures.length === 0) {
    it.skip('no fixtures yet', () => {});
    return;
  }

  for (const slug of fixtures) {
    it(slug, () => {
      const dir = join(FIXTURES_DIR, slug);
      const inputHtml = readFileSync(join(dir, 'input.html'), 'utf8');
      const expectedPath = join(dir, 'expected.md');

      let opts = {};
      let actualInput = inputHtml;
      const fixturePath = join(dir, 'fixture.json');
      if (existsSync(fixturePath)) {
        const meta = JSON.parse(readFileSync(fixturePath, 'utf8'));
        if (meta.isFullDom) {
          document.documentElement.innerHTML = `<head></head><body>${inputHtml}</body>`;
          const range = document.createRange();
          range.selectNodeContents(document.body);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);

          delete window.GridDetector;
          delete require.cache[require.resolve('../grid-detector.js')];
          const GridDetector = require('../grid-detector.js');
          opts.gridResult = GridDetector.extract(sel);
          actualInput = document.body.innerHTML;
        } else if (meta.gridResult) {
          opts.gridResult = meta.gridResult;
        }
      }

      const actual = htmlToMarkdown(actualInput, opts).trim();

      // Opt-in second assertion: the Simple HTML the inspector derives from the
      // same payload. Present only where a fixture pins both equivalents.
      const simplePath = join(dir, 'expected.simple.html');
      const assertsSimple = existsSync(simplePath);
      const actualSimple = assertsSimple ? fromHtml(actualInput).simpleHtml.trim() : null;

      if (UPDATE) {
        writeFileSync(expectedPath, actual + '\n');
        console.log(`[UPDATE_FIXTURES] wrote ${expectedPath}`);
        if (assertsSimple) {
          writeFileSync(simplePath, actualSimple + '\n');
          console.log(`[UPDATE_FIXTURES] wrote ${simplePath}`);
        }
        return;
      }

      if (assertsSimple) {
        expect(actualSimple).toBe(readFileSync(simplePath, 'utf8').trim());
      }
      if (!existsSync(expectedPath)) {
        throw new Error(
          `Fixture "${slug}" has no expected.md.\nActual output (review then re-run with UPDATE_FIXTURES=1 to save):\n---\n${actual}\n---\n`,
        );
      }
      const expected = readFileSync(expectedPath, 'utf8').trim();
      expect(actual).toBe(expected);
    });
  }
});
