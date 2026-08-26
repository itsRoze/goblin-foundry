import { unwrapHtmlFragment } from '@goblin/schema';

/**
 * `sandbox=""` on the review iframe blocks script execution, gives the frame
 * an opaque origin, and blocks forms and top-level navigation — but it does
 * NOT stop the document from issuing network requests for images, stylesheets,
 * `@import`s or nested frames. An agent-authored document (planner or
 * reviewer output, ultimately built from repo content) could otherwise beacon
 * out through an `<img src>`. A strict CSP meta tag closes that: it applies
 * inside the sandboxed document regardless of its opaque origin.
 */
const REVIEW_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

export function sandboxedReviewDoc(raw: string): string {
  // Designs already stored can carry a CDATA or fence wrapper the planner no
  // longer emits; unwrap on the way in so an old row still renders.
  const html = unwrapHtmlFragment(raw);
  const meta = `<meta http-equiv="Content-Security-Policy" content="${REVIEW_CSP}">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, match => `${match}${meta}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, match => `${match}<head>${meta}</head>`);
  return `<head>${meta}</head>${html}`;
}
