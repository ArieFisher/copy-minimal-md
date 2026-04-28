#!/usr/bin/env node
/**
 * test_grid_runner.js
 *
 * Headless test runner using Chrome DevTools Protocol.
 * Requires: Chrome installed at the default macOS path.
 * No npm packages needed — uses Node.js v21+ built-in WebSocket.
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TEST_FILE = `file://${path.resolve(__dirname, 'test_grid_headless.html')}`;
const PORT = 9224; // avoid collisions with any running Chrome instance

async function getWsUrl(port, retries = 10) {
    for (let i = 0; i < retries; i++) {
        await sleep(300);
        try {
            const data = await httpGet(`http://localhost:${port}/json`);
            const targets = JSON.parse(data);
            const target = targets.find(t => t.type === 'page') || targets[0];
            if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
        } catch (_) {}
    }
    throw new Error('Chrome did not start in time');
}

function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => resolve(d));
        }).on('error', reject);
    });
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function run() {
    console.log('Starting Chrome headless...');
    const chrome = spawn(CHROME, [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        `--remote-debugging-port=${PORT}`,
    ], { stdio: 'ignore' });

    chrome.on('error', err => { console.error('Chrome failed to start:', err.message); process.exit(1); });

    let wsUrl;
    try {
        wsUrl = await getWsUrl(PORT);
    } catch (e) {
        chrome.kill();
        console.error(e.message);
        process.exit(1);
    }

    console.log('Connected to Chrome DevTools.');

    // Node.js v21+ has global WebSocket
    const ws = new WebSocket(wsUrl);
    let msgId = 0;
    const pending = new Map();
    const eventHandlers = new Map();

    ws.addEventListener('message', ({ data }) => {
        const msg = JSON.parse(data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
        if (msg.method) {
            const h = eventHandlers.get(msg.method);
            if (h) h(msg.params);
        }
    });

    await new Promise(r => ws.addEventListener('open', r));

    function send(method, params = {}) {
        const id = ++msgId;
        return new Promise((resolve, reject) => {
            pending.set(id, msg => {
                if (msg.error) reject(new Error(msg.error.message));
                else resolve(msg.result);
            });
            ws.send(JSON.stringify({ id, method, params }));
        });
    }

    // Enable Page events then navigate
    await send('Page.enable');

    const loadFired = new Promise(resolve => {
        eventHandlers.set('Page.loadEventFired', resolve);
    });

    await send('Page.navigate', { url: TEST_FILE });
    await Promise.race([loadFired, sleep(5000)]);
    await sleep(300); // let synchronous JS finish

    // Extract results written by the test page
    const evalResult = await send('Runtime.evaluate', {
        expression: `document.getElementById('output')?.getAttribute('data-results') || null`,
        returnByValue: true,
    });

    ws.close();
    chrome.kill();

    const raw = evalResult?.result?.value;
    if (!raw) {
        console.error('No test results found in page. Did grid-detector.js load?');
        process.exit(1);
    }

    const { passed, failed, results } = JSON.parse(raw);

    console.log('\n── Test Results ──────────────────────────────────');
    for (const r of results) {
        console.log(`${r.pass ? '✅' : '❌'}  ${r.label}`);
        if (!r.pass) {
            console.log(`     actual:   ${JSON.stringify(r.actual)}`);
            console.log(`     expected: ${JSON.stringify(r.expected)}`);
        }
    }
    console.log(`──────────────────────────────────────────────────`);
    console.log(`${passed}/${results.length} tests passed${failed > 0 ? ` — ${failed} FAILED` : ' ✅'}\n`);

    process.exit(failed > 0 ? 1 : 0);
}

run();
