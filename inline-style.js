/**
 * inline-style.js
 *
 * The inspector renders the clipboard's text/html with the payload's own inline
 * styles, so a copy from Sheets or Word sits in the card looking the way it
 * looked where it was copied. The highlight is yellow, the italics lean, the
 * 16pt row is bigger than the others. That is the whole point of a rendered
 * view — the Source view is there for reading the tags.
 *
 * Showing it means putting CSS from an untrusted source into an extension page,
 * and this module decides which declarations get to go. Two are refused:
 *
 *   - Anything that fetches. A background-image, a border-image, a font: each is
 *     a request from an extension page to a URL the payload chose, which tells
 *     whoever wrote the payload that this clipboard entry was inspected, and
 *     when. The manifest's CSP refuses those requests as well; this is the layer
 *     that stops them being made in the first place.
 *   - fixed and sticky positioning, which lift an element out of the card and
 *     put it over the rest of the page — over the Replace buttons, say. The
 *     `contain` on the render body would hold it there anyway, and a clipboard
 *     payload has no business asking.
 *
 * Everything else is the payload's own business: colour, weight, size, family,
 * borders, alignment, spacing.
 *
 * What this does NOT cover, because it never sees them: <style> elements and
 * class/id attributes. Those are dropped whole by the inspector's sanitizer
 * call. A <style> block has no scope — it would restyle the inspector's chrome
 * along with the payload — and a class lets the payload reach the inspector's
 * own rules by name. Rendering either one safely needs the payload in its own
 * document, which is a separate change.
 */
(function (global) {
    'use strict';

    /**
     * Value functions that make the browser fetch. `image-set` and `cross-fade`
     * take bare strings as well as url(), so a check for `url(` alone misses
     * them.
     */
    const FETCHING_FUNCTION =
        /(?:^|[^\w-])(?:-webkit-image-set|image-set|-webkit-cross-fade|cross-fade|-webkit-canvas|element|image|paint|url|src)\(/i;

    /** Dead in Chrome for years. Free to refuse, so refuse it. */
    const LEGACY_SCRIPTING = /(?:expression|-moz-binding|behavior)\s*[(:]/i;

    /** The two `position` values that leave the card behind. */
    const OUT_OF_FLOW = /^(?:fixed|sticky|-webkit-sticky)$/i;

    /**
     * The policy, one declaration at a time. Pure — no DOM, no parser — so it
     * says the same thing wherever it runs, which is what the unit tests hold.
     */
    function isAllowed(property, value) {
        if (!property || !value) return false;

        const name = String(property).toLowerCase();
        const declared = String(value);

        // A custom property is the payload reaching for the inspector's own
        // design tokens: --border-neutral and the rest name real rules in
        // inspector.css, and the card's own borders read them.
        if (name.startsWith('--')) return false;
        if (!/^-?[a-z][a-z0-9-]*$/.test(name)) return false;

        if (FETCHING_FUNCTION.test(declared)) return false;
        if (LEGACY_SCRIPTING.test(declared)) return false;
        if (name === 'position' && OUT_OF_FLOW.test(declared.trim())) return false;

        return true;
    }

    let probe = null;

    /**
     * Split a style attribute with the browser's own CSS parser, drop what the
     * policy refuses, and write the rest back.
     *
     * Going through the CSSOM rather than splitting on `;` is what makes
     * shorthands work: `background: url(beacon.png) yellow` arrives here as
     * background-image and background-color separately, so the fetch goes and
     * the highlight stays. It also means a declaration the browser will not
     * parse never reaches the policy at all, and neither do comments, escapes
     * or the other ways a declaration list can be written to read two ways.
     *
     * The probe element is never inserted into the document, so the untrusted
     * declarations it holds on the way through are parsed but never rendered,
     * and it is cleared as soon as they have been read.
     *
     * jsdom's parser knows a subset of CSS and quietly drops the rest, so what
     * this returns there is not what Chrome returns. The policy is what the
     * unit tests cover; this is covered end to end, in the extension.
     */
    function filter(value) {
        if (!value || typeof document === 'undefined') return '';

        if (!probe) probe = document.createElement('div');
        probe.style.cssText = '';
        probe.style.cssText = String(value);

        const kept = [];
        for (const property of Array.from(probe.style)) {
            const declared = probe.style.getPropertyValue(property);
            if (!isAllowed(property, declared)) continue;
            const priority = probe.style.getPropertyPriority(property);
            kept.push(`${property}: ${declared}${priority ? ' !' + priority : ''}`);
        }
        probe.style.cssText = '';

        return kept.join('; ');
    }

    global.InlineStyle = { isAllowed, filter };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof window !== 'undefined' ? window : globalThis).InlineStyle;
}
