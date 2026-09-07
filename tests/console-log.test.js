/**
 * The recorder that keeps the inspector page's console for the capture.
 *
 * Every test drives a stand-in console rather than the real one: the module
 * installs itself only inside the extension, and a test runner's console is not
 * ours to wrap.
 */
import { describe, it, expect, vi } from 'vitest';
const ConsoleLog = require('../console-log.js');

/** A console with counted methods, wrapped by a fresh recorder. */
function recorder(options) {
    const calls = [];
    const fake = {};
    for (const method of [...Object.keys(ConsoleLog.LEVELS), 'groupEnd']) {
        fake[method] = (...args) => calls.push([method, ...args]);
    }

    const rec = ConsoleLog.create(options);
    rec.attach(fake);
    return { rec, fake, calls, rows: () => rec.snapshot().entries };
}

/** A target that hands back the handlers it was given. */
function listener() {
    const handlers = {};
    const rec = ConsoleLog.create();
    rec.listen({ addEventListener: (name, fn) => { handlers[name] = fn; } });
    return { rec, handlers, rows: () => rec.snapshot().entries };
}

/* ------------------------------------------------------------- formatting */

describe('format', () => {
    it('leaves a string alone', () => {
        expect(ConsoleLog.format('Inspector: reading')).toBe('Inspector: reading');
    });

    it('names the empty values rather than dropping them', () => {
        expect(ConsoleLog.format(undefined)).toBe('undefined');
        expect(ConsoleLog.format(null)).toBe('null');
        expect(ConsoleLog.format(0)).toBe('0');
        expect(ConsoleLog.format(false)).toBe('false');
    });

    it('keeps an error with its stack', () => {
        const text = ConsoleLog.format(new TypeError('no clipboard'));
        expect(text).toContain('TypeError');
        expect(text).toContain('no clipboard');
    });

    it('writes an object as JSON', () => {
        expect(ConsoleLog.format({ rows: 2, kind: 'table' })).toBe('{"rows":2,"kind":"table"}');
    });

    it('names a cycle instead of throwing on it', () => {
        const state = { view: 'source' };
        state.self = state;
        expect(ConsoleLog.format(state)).toContain('[circular]');
    });

    // A card holds the clipboard payload. Logging one must not put a second
    // copy of it in the capture, so a node comes out as its start tag.
    it('reduces a DOM node to its start tag', () => {
        const node = document.createElement('div');
        node.id = 'output-container';
        node.className = 'card card--plain';
        node.innerHTML = '<p>the whole payload</p>';
        expect(ConsoleLog.format(node)).toBe('<div#output-container.card.card--plain>');
        expect(ConsoleLog.format(node)).not.toContain('payload');
    });

    it('quotes a text node short', () => {
        expect(ConsoleLog.format(document.createTextNode('hello'))).toBe('#text "hello"');
    });

    it('names a function', () => {
        expect(ConsoleLog.format(function render() {})).toBe('[function render]');
    });

    it('cuts a long argument and says it cut it', () => {
        const text = ConsoleLog.format('x'.repeat(5000));
        expect(text.length).toBeLessThan(1200);
        expect(text.endsWith('… [cut]')).toBe(true);
    });
});

/* ---------------------------------------------------------------- wrapping */

describe('attach', () => {
    it('records a call and passes it to the real console', () => {
        const { fake, calls, rows } = recorder();
        fake.log('Inspector: reading', 3);

        expect(rows()).toHaveLength(1);
        expect(rows()[0].text).toBe('Inspector: reading 3');
        expect(calls).toEqual([['log', 'Inspector: reading', 3]]);
    });

    it('keeps the level each method means', () => {
        const { fake, rows } = recorder();
        fake.log('a');
        fake.info('b');
        fake.debug('c');
        fake.warn('d');
        fake.error('e');
        fake.trace('f');
        expect(rows().map((row) => row.level)).toEqual(['log', 'info', 'debug', 'warn', 'error', 'trace']);
    });

    it('records dir and table as ordinary rows', () => {
        const { fake, rows } = recorder();
        fake.dir({ a: 1 });
        fake.table([{ a: 1 }]);
        expect(rows().map((row) => row.level)).toEqual(['log', 'log']);
    });

    it('records a failed assertion and stays quiet about one that held', () => {
        const { fake, rows } = recorder();
        fake.assert(true, 'never');
        fake.assert(false, 'no rows');
        expect(rows()).toHaveLength(1);
        expect(rows()[0]).toMatchObject({ level: 'error', text: 'Assertion failed: no rows' });
    });

    it('stamps every row with a time', () => {
        const { fake, rows } = recorder();
        fake.log('x');
        expect(rows()[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('leaves the console usable when a formatter would throw', () => {
        const { fake, rows } = recorder();
        const hostile = { get boom() { throw new Error('no'); } };
        expect(() => fake.log(hostile)).not.toThrow();
        expect(rows()).toHaveLength(1);
    });
});

/* ------------------------------------------------------------------ groups */

describe('groups', () => {
    it('writes the group at its own depth and the rows under it one deeper', () => {
        const { fake, rows } = recorder();
        fake.group('Processing HTML');
        fake.log('inside');
        fake.groupCollapsed('deeper');
        fake.log('further in');
        fake.groupEnd();
        fake.log('back out');
        fake.groupEnd();
        fake.log('done');

        expect(rows().map((row) => [row.depth, row.text])).toEqual([
            [0, 'Processing HTML'],
            [1, 'inside'],
            [1, 'deeper'],
            [2, 'further in'],
            [1, 'back out'],
            [0, 'done']
        ]);
    });

    it('takes an unmatched groupEnd without going negative', () => {
        const { fake, rows } = recorder();
        fake.groupEnd();
        fake.groupEnd();
        fake.log('x');
        expect(rows()[0].depth).toBe(0);
    });
});

/* ------------------------------------------------------------- the buffer */

describe('the buffer', () => {
    it('keeps the last rows and counts what it dropped', () => {
        const { fake, rec } = recorder({ limit: 3 });
        for (let i = 1; i <= 5; i += 1) fake.log(`row ${i}`);

        const snap = rec.snapshot();
        expect(snap.entries.map((row) => row.text)).toEqual(['row 3', 'row 4', 'row 5']);
        expect(snap.dropped).toBe(2);
        expect(snap.limit).toBe(3);
    });

    it('ships a cap of 50 rows', () => {
        // The figure a capture carries, pinned so it cannot drift unnoticed.
        expect(ConsoleLog.LIMIT).toBe(50);

        const { fake, rec } = recorder();
        for (let i = 1; i <= 60; i += 1) fake.log(`row ${i}`);

        const snap = rec.snapshot();
        expect(snap.entries).toHaveLength(50);
        expect(snap.entries[0].text).toBe('row 11');
        expect(snap.dropped).toBe(10);
    });

    it('hands out copies, so a reader cannot rewrite the log', () => {
        const { fake, rec } = recorder();
        fake.log('original');
        rec.snapshot().entries[0].text = 'tampered';
        expect(rec.snapshot().entries[0].text).toBe('original');
    });

    it('cuts a row that would carry a whole payload', () => {
        const { fake, rows } = recorder();
        fake.log('a'.repeat(4000), 'b'.repeat(4000), 'c'.repeat(4000));
        expect(rows()[0].text.length).toBeLessThanOrEqual(ConsoleLog.ROW_CHARS + 10);
    });
});

/* ------------------------------------------------------- what never logged */

describe('listen', () => {
    it('records an uncaught error with where it came from', () => {
        const { handlers, rows } = listener();
        handlers.error({
            message: 'x is not a function',
            filename: 'chrome-extension://abc/inspector.js',
            lineno: 412,
            colno: 9
        });

        expect(rows()[0].level).toBe('error');
        expect(rows()[0].text).toContain('x is not a function');
        expect(rows()[0].text).toContain('inspector.js:412:9');
    });

    it('records an unhandled rejection', () => {
        const { handlers, rows } = listener();
        handlers.unhandledrejection({ reason: new Error('clipboard read failed') });
        expect(rows()[0].text).toContain('Unhandled rejection');
        expect(rows()[0].text).toContain('clipboard read failed');
    });
});

/* ----------------------------------------------------------- the default */

describe('the page recorder', () => {
    it('reads empty until something installs it', () => {
        expect(ConsoleLog.snapshot()).toMatchObject({ entries: [], dropped: 0 });
    });

    it('installs once and hands the same recorder back', () => {
        const target = { console: { log: vi.fn() }, addEventListener: vi.fn() };
        const first = ConsoleLog.install(target);
        expect(ConsoleLog.install(target)).toBe(first);

        target.console.log('after install');
        expect(ConsoleLog.snapshot().entries[0].text).toBe('after install');
    });
});
