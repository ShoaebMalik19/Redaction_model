// Layer 0: live DOM check. Zero model inference — a content script can call this
// synchronously on any real page and get ground-truth sensitive-field locations
// before a single AI model even loads.

const DOM_SELECTORS = [
  { sel: 'input[type="password"]', label: 'password-field' },
  { sel: 'input[autocomplete*="username"]', label: 'username-field' },
  { sel: 'input[autocomplete*="email"]', label: 'email-field' },
  { sel: 'input[type="email"]', label: 'email-field' },
  { sel: 'input[autocomplete*="cc-number"]', label: 'card-number-field' },
];

/**
 * Scan a root (defaults to the whole document) for sensitive form fields.
 * Coordinates are viewport-relative (from getBoundingClientRect), matching what a
 * content script needs to draw an overlay directly on the live page.
 * @param {Document|Element} root
 * @returns {{source:'dom', label:string, x1:number, y1:number, x2:number, y2:number, score:number}[]}
 */
export function detectDomFields(root = document) {
  const found = [];
  const seen = new Set();
  for (const { sel, label } of DOM_SELECTORS) {
    root.querySelectorAll(sel).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return; // hidden field, nothing to redact visually
      found.push({
        source: 'dom',
        label,
        score: 1.0,
        x1: r.left, y1: r.top, x2: r.right, y2: r.bottom,
      });
    });
  }
  return found;
}
