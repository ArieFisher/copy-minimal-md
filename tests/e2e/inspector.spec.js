const { test, expect } = require('./fixtures.js');

test('inspector page opens and renders the clipboard cards', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/inspector.html`);

  await expect(page.locator('body')).toContainText(/Clipboard|Inspector|Markdown/i);
  expect((await page.title()).length).toBeGreaterThan(0);
});
