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
  // Real person-name fields, found via the actual HTML living-standard autocomplete
  // tokens first, with common id-substring naming conventions as a backstop for
  // forms (like a real government registration form found in testing) that don't
  // set autocomplete at all.
  { sel: 'input[autocomplete="name"], input[autocomplete*="given-name"], input[autocomplete*="family-name"]', label: 'name-field' },
  { sel: 'input[id*="fname" i], input[id*="lname" i], input[id*="fullname" i], input[id*="firstname" i], input[id*="lastname" i]', label: 'name-field' },
  // Home/postal address — textareas aren't covered by any selector above at all.
  { sel: 'textarea[id*="address" i], textarea[name*="address" i], textarea[autocomplete*="address"]', label: 'address-field' },
];

// Value-shape patterns, checked against any text input's live value — catches
// government-ID-style fields (Aadhaar, PAN) regardless of what the field is
// named, the same way the OCR layer's regex safety net works on image text.
const VALUE_PATTERNS = [
  { re: /^\d{4}\s?\d{4}\s?\d{4}$/, label: 'aadhaar-field' },
  { re: /^[A-Z]{5}\d{4}[A-Z]$/, label: 'pan-field' },
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

  // Value-shape check: any text input whose current value looks like an Aadhaar
  // or PAN number, independent of field naming.
  root.querySelectorAll('input[type="text"], input:not([type])').forEach((el) => {
    if (seen.has(el)) return;
    const val = el.value.trim();
    for (const { re, label } of VALUE_PATTERNS) {
      if (re.test(val)) { addField(found, seen, el, label); break; }
    }
  });

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
