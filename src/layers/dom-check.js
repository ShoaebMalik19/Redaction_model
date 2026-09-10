// Layer 0: live DOM check. Zero model inference — a content script can call this
// synchronously on any real page and get ground-truth sensitive-field locations
// before a single AI model even loads.

const DOM_SELECTORS = [
  { sel: 'input[type="password"]', label: 'password-field' },
  { sel: 'input[autocomplete*="username"]', label: 'username-field' },
  { sel: 'input[autocomplete*="email"]', label: 'email-field' },
  { sel: 'input[type="email"]', label: 'email-field' },
  { sel: 'input[type="tel"]', label: 'phone-field' },
  { sel: 'input[autocomplete*="tel"]', label: 'phone-field' },
  { sel: 'input[autocomplete*="cc-number"]', label: 'card-number-field' },
  // Backstop for real-world forms with no autocomplete attribute at all (common —
  // found on a real government login form where the identifier field had only
  // id="username", no autocomplete): match on id/name substrings directly.
  { sel: 'input[id*="user" i], input[name*="user" i]', label: 'username-field' },
  { sel: 'input[id*="mobile" i], input[name*="mobile" i]', label: 'phone-field' },
];

function addField(found, seen, el, label) {
  if (seen.has(el)) return;
  seen.add(el);
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return; // hidden field, nothing to redact visually
  found.push({ source: 'dom', label, score: 1.0, x1: r.left, y1: r.top, x2: r.right, y2: r.bottom });
}

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
    root.querySelectorAll(sel).forEach((el) => addField(found, seen, el, label));
  }

  // Robust fallback independent of any naming convention: the identifier field
  // (mobile number / user ID / email) is almost always the text input immediately
  // preceding a password field in the same form — catches real-world login forms
  // that don't use `autocomplete` at all and have no recognizable id/name pattern.
  root.querySelectorAll('input[type="password"]').forEach((pwEl) => {
    const form = pwEl.closest('form') || root;
    const allInputs = Array.from(form.querySelectorAll('input'));
    const pwPos = allInputs.indexOf(pwEl);
    const identifierTypes = new Set(['text', 'tel', 'number', '']);
    let candidate = null;
    allInputs.forEach((inp, pos) => {
      if (pos < pwPos && identifierTypes.has(inp.type) && (!candidate || pos > candidate.pos)) {
        candidate = { el: inp, pos };
      }
    });
    if (candidate) addField(found, seen, candidate.el, 'username-field');
  });

  return found;
}
