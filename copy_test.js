const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('file://' + __dirname + '/test_selection.html');

  // Override browser permissions to allow clipboard
  const context = browser.defaultBrowserContext();
  await context.overridePermissions('file://' + __dirname + '/test_selection.html', ['clipboard-read', 'clipboard-write']);

  const html = await page.evaluate(async () => {
    document.execCommand('copy');
    
    // Sometimes navigator.clipboard isn't immediately ready or available via file://
    // Alternatively, we can intercept the copy event:
    return new Promise(resolve => {
        document.addEventListener('copy', e => {
            e.preventDefault();
            resolve(e.clipboardData.getData('text/html'));
        });
        document.execCommand('copy');
    });
  });

  console.log("Copied HTML:");
  console.log(html);

  await browser.close();
})();
