/**
 * The inspector's console, kept.
 *
 * A console message is evidence the same way a payload is, and it lives about
 * as long as the tab. The tester presses Capture after the interesting thing
 * has already scrolled past, so this file starts recording the moment the page
 * loads and every capture carries what it holds. There is no switch for it.
 *
 * WHAT IT REACHES
 *
 * This page's console, and nothing else. The service worker and the content
 * script log into consoles of their own that a page cannot read.
 *
 * WHAT IT RECORDS
 *
 * Every console method the extension or a library might call, uncaught errors,
 * and unhandled promise rejections. A group becomes a row of its own and the
 * rows under it carry a depth, so nesting survives as indentation in a file
 * that has no console to fold it into.
 *
 * WHAT IT WILL NOT DO
 *
 * Grow without bound, and carry a payload twice. An argument is formatted to a
 * bounded string: a DOM node comes out as its start tag, an object as JSON, and
 * both are cut at a ceiling. So a card logged whole leaves a marker, not a
 * second copy of the clipboard. The buffer keeps the last LIMIT rows and counts
 * what it dropped, because a count of lost rows is worth more than the memory
 * they would have cost.
 *
 * The real console still gets every call, in order and unaltered. Recording is
 * a side effect; the tester watching devtools sees what they always saw.
 */
(function (global) {
    'use strict';

    /** Rows kept. Older ones fall off the front and are counted. */
    const LIMIT = 50;

    /** Characters kept per row, and per argument inside it. */
    const ROW_CHARS = 2000;
    const ARG_CHARS = 800;

    /**
     * Every method worth wrapping, and the level each records at.
     *
     * assert lands under error because that is what it means. dir and table
     * land under log: their formatting is the console's, and what survives into
     * a file is the text either way. groupEnd records nothing — it closes a row
     * that is already written.
     */
    const LEVELS = {
        log: 'log',
        info: 'info',
        debug: 'debug',
        warn: 'warn',
        error: 'error',
        trace: 'trace',
        dir: 'log',
        table: 'log',
        assert: 'error',
        group: 'group',
        groupCollapsed: 'group'
    };

    const cut = (text, max) => (text.length > max ? `${text.slice(0, max)}… [cut]` : text);

    /* --------------------------------------------------------- formatting */

    /** A node as its start tag. The markup inside is the payload, and is not ours to copy. */
    function tagOf(node) {
        if (node.nodeType === 3) return `#text ${JSON.stringify(cut(node.data, 80))}`;
        if (node.nodeType === 9) return '#document';
        if (node.nodeType === 11) return '#document-fragment';
        if (node.nodeType !== 1) return `#node(${node.nodeType})`;

        const name = node.tagName.toLowerCase();
        const id = node.id ? `#${node.id}` : '';
        const cls = typeof node.className === 'string' && node.className
            ? `.${node.className.trim().split(/\s+/).join('.')}`
            : '';
        return `<${name}${id}${cls}>`;
    }

    /** JSON, with cycles named rather than thrown on. */
    function jsonOf(value) {
        const seen = new WeakSet();
        return JSON.stringify(value, (key, val) => {
            if (typeof val === 'bigint') return `${val}n`;
            if (typeof val === 'function') return `[function ${val.name || 'anonymous'}]`;
            if (val && typeof val === 'object') {
                if (seen.has(val)) return '[circular]';
                seen.add(val);
                if (val.nodeType) return tagOf(val);
            }
            return val;
        });
    }

    /** One argument, as a bounded string. Never throws: a formatter that throws loses the row. */
    function format(value) {
        try {
            if (typeof value === 'string') return cut(value, ARG_CHARS);
            if (value === null || value === undefined) return String(value);
            if (value instanceof Error) return cut(value.stack || `${value.name}: ${value.message}`, ARG_CHARS);
            if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
            if (typeof value === 'symbol' || typeof value === 'bigint') return String(value);
            if (typeof value !== 'object') return String(value);
            if (value.nodeType) return tagOf(value);

            const json = jsonOf(value);
            return cut(json === undefined ? String(value) : json, ARG_CHARS);
        } catch (err) {
            return '[unformattable]';
        }
    }

    /** The arguments of one call, as the one string a row carries. */
    const line = (args) => cut(Array.from(args, format).join(' '), ROW_CHARS);

    /* ---------------------------------------------------------- the buffer */

    function create({ limit = LIMIT } = {}) {
        const entries = [];
        let dropped = 0;
        let depth = 0;

        function push(level, text) {
            entries.push({ at: new Date().toISOString(), level, depth, text });
            if (entries.length > limit) {
                entries.shift();
                dropped += 1;
            }
        }

        /** Record one call. Group rows are written at their own depth, then open one. */
        function record(method, args) {
            const level = LEVELS[method] || 'log';
            if (method === 'assert') {
                if (args[0]) return;
                push(level, `Assertion failed${args.length > 1 ? `: ${line(Array.prototype.slice.call(args, 1))}` : ''}`);
                return;
            }
            push(level, line(args));
            if (level === 'group') depth += 1;
        }

        /** Close a group. Nothing is written: the row that opened it is already there. */
        function close() {
            if (depth > 0) depth -= 1;
        }

        /** Wrap a console in place. Returns it, so a caller can wrap a stand-in. */
        function attach(target) {
            for (const method of Object.keys(LEVELS)) {
                const original = target[method];
                if (typeof original !== 'function') continue;
                target[method] = function (...args) {
                    record(method, args);
                    return original.apply(target, args);
                };
            }

            const groupEnd = target.groupEnd;
            if (typeof groupEnd === 'function') {
                target.groupEnd = function (...args) {
                    close();
                    return groupEnd.apply(target, args);
                };
            }

            return target;
        }

        /**
         * Take the failures that never reach a console call.
         *
         * A capture of a copy that went wrong is worth most when the thing that
         * went wrong threw, and a throw nobody caught logs nothing this file
         * would otherwise see.
         */
        function listen(target) {
            target.addEventListener('error', (event) => {
                const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : '';
                push('error', cut(`Uncaught ${event.error ? format(event.error) : event.message}${where}`, ROW_CHARS));
            });

            target.addEventListener('unhandledrejection', (event) => {
                push('error', cut(`Unhandled rejection: ${format(event.reason)}`, ROW_CHARS));
            });

            return target;
        }

        return {
            attach,
            listen,
            record,
            close,
            snapshot: () => ({ entries: entries.map((entry) => ({ ...entry })), dropped, limit })
        };
    }

    /** The page's own recorder, once something installs it. */
    let installed = null;

    /** Start recording. Idempotent: a second call hands back the first recorder. */
    function install(target = global) {
        if (installed) return installed;
        installed = create();
        if (target.console) installed.attach(target.console);
        if (target.addEventListener) installed.listen(target);
        return installed;
    }

    const EMPTY = { entries: [], dropped: 0, limit: LIMIT };

    global.ConsoleLog = {
        LIMIT,
        ROW_CHARS,
        ARG_CHARS,
        LEVELS,
        format,
        create,
        install,
        snapshot: () => (installed ? installed.snapshot() : { ...EMPTY, entries: [] })
    };

    // The extension page installs on load, so a message logged before anything
    // else runs is already in the buffer. A test runner has a console of its
    // own and gets the factory instead.
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) install();
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof window !== 'undefined' ? window : globalThis).ConsoleLog;
}
