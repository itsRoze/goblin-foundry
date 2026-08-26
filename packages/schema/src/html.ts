/**
 * An agent asked for "one HTML fragment" sometimes hands back a wrapped one:
 * a `<![CDATA[ ... ]]>` section, or a ```html fence, because the fragment is
 * travelling inside JSON and wrapping markup feels safer than not.
 *
 * Both wrappers are worse than useless in a browser. HTML has no CDATA outside
 * foreign content: `<![CDATA[` opens a *bogus comment* that ends at the very
 * first `>` — which, in a document that starts with a stylesheet, is the `>`
 * closing `<style>`. The opening tag is eaten, the CSS renders as paragraphs of
 * text, and the trailing `</style>` is an orphan. FAC-12 v1 looked exactly like
 * that.
 *
 * Deterministic to strip, so it is stripped rather than sent back as a failed
 * gate: a correction round costs a model call to fix a wrapper.
 */
export function unwrapHtmlFragment(html: string): string {
  let out = html.trim();
  // ```html … ``` — possibly repeated, possibly around the CDATA.
  for (let i = 0; i < 2; i++) {
    const fence = /^```[a-z]*\s*\n([\s\S]*?)\n?```$/i.exec(out);
    if (fence?.[1] !== undefined) { out = fence[1].trim(); continue; }
    const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(out);
    if (cdata?.[1] !== undefined) { out = cdata[1].trim(); continue; }
    break;
  }
  return out;
}
