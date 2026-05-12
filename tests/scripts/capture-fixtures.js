#!/usr/bin/env node
/**
 * Captures rendered DOM from a list of ARIA-table reference sites into
 * tests/regressions/<slug>/input.html and writes a stub notes.md / fixture.json.
 *
 * Run once (or whenever you want to refresh):
 *   npm run capture:fixtures
 *
 * Requires Playwright chromium to be installed:
 *   npx playwright install chromium
 *
 * The script does NOT write expected.md. After capture, run the test suite —
 * the new fixture will fail. Inspect the actual output (printed in the diff),
 * decide if it's correct, then save it as expected.md.
 */
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const SITES = [
  {
    slug: 'w3c-apg-grid',
    url: 'https://www.w3.org/WAI/ARIA/apg/patterns/grid/examples/data-grids/',
    selector: '[role="grid"]',
    notes: 'W3C ARIA Authoring Practices Guide — canonical data grid reference.',
  },
  {
    slug: 'react-aria-table',
    url: 'https://react-spectrum.adobe.com/react-aria/Table.html',
    selector: '[role="grid"]',
    notes: 'Adobe React Aria Table component — interactive grid with selection.',
  },
  {
    slug: 'mui-datagrid',
    url: 'https://mui.com/x/react-data-grid/',
    selector: '[role="grid"]',
    notes: 'MUI X DataGrid — production-grade React data grid.',
  },
  {
    slug: 'codepen-aria-grid',
    url: 'https://codepen.io/M-M/pen/oWxzwR',
    selector: '[role="grid"]',
    notes: 'CodePen ARIA grid demo with aria-colindex/rowcount attributes.',
  },
  {
    slug: 'observable-data-table',
    url: 'https://observablehq.com/documentation/cells/data-table',
    selector: '[role="table"], [role="grid"]',
    notes: 'Observable data table documentation page.',
  },
];

const today = new Date().toISOString().slice(0, 10);
const FIX_ROOT = path.resolve(__dirname, '..', 'regressions');

async function captureOne(browser, site) {
  const slug = `${today}-${site.slug}`;
  const dir = path.join(FIX_ROOT, slug);
  fs.mkdirSync(dir, { recursive: true });

  const page = await browser.newPage();
  try {
    console.log(`[${slug}] navigating ${site.url}`);
    await page.goto(site.url, { waitUntil: 'networkidle', timeout: 60_000 });

    // Wait for any matching grid to render
    await page.waitForSelector(site.selector, { timeout: 15_000 }).catch(() => {
      console.warn(`[${slug}] selector "${site.selector}" not found — capturing whatever exists`);
    });

    const grid = await page.$(site.selector);
    if (!grid) {
      console.warn(`[${slug}] no grid found, skipping`);
      return;
    }
    const html = await grid.evaluate((el) => el.outerHTML);
    fs.writeFileSync(path.join(dir, 'input.html'), html);
    fs.writeFileSync(
      path.join(dir, 'notes.md'),
      `# ${slug}\n\nSource: ${site.url}\nSelector: \`${site.selector}\`\nCaptured: ${new Date().toISOString()}\n\n${site.notes}\n\n## Observed behavior\n_TODO: paste the user-visible bug or pinned-behavior description here._\n`,
    );
    fs.writeFileSync(
      path.join(dir, 'fixture.json'),
      JSON.stringify({ isFullDom: true }, null, 2) + '\n',
    );
    console.log(`[${slug}] captured ${html.length} chars`);
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const site of SITES) {
      try {
        await captureOne(browser, site);
      } catch (e) {
        console.error(`[${site.slug}] failed:`, e.message);
      }
    }
  } finally {
    await browser.close();
  }
  console.log('Done. Now run: npm test  → new fixtures will fail with missing expected.md.');
  console.log('Inspect actual output, save as expected.md.');
})();
