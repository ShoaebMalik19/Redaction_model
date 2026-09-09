# pii-redaction-engine

On-device redaction pipeline built for **SIH26171** (ISRO — On-device Visual Perception for
Lightweight Browser Agents). Detects and redacts sensitive on-screen content (faces,
passwords, Aadhaar-style numbers, phone numbers, names) entirely client-side — nothing is
ever sent to a server. This is the **privacy filter layer** that sits *before* the agent's
cloud LLM/VLM call: capture screen → run this engine → send only the sanitized output onward.

## Architecture — 4 layers

| Layer | What | Speed | Notes |
|---|---|---|---|
| 0. DOM check | `input[type=password]`, username/email/card fields | instant, 0ms | Ground truth — no model involved. Only works on a live page, not a flat image. |
| 1. PII vision model | Text-based PII regions in a screenshot | ~0.2-0.8s | [screenpipe/pii-image-redactor](https://huggingface.co/screenpipe/pii-image-redactor) (rfdetr, ONNX, ~57MB). **CC BY-NC 4.0 — non-commercial only.** |
| 2. Face detector | Faces | ~0.1-0.6s | [SCRFD-500m](https://huggingface.co/RuteNL/SCRFD-face-detection-ONNX) (ONNX, 2.3MB, Apache-2.0). |
| 3. OCR + regex safety net | Aadhaar-style numbers, phone numbers, password field values, proper names | ~2-10s | Tesseract.js (`eng` + `eng+hin` in parallel) + pattern matching. Catches what the vision models miss on clean documents/forms. |

All 4 layers run independently and their results are simply unioned — duplicate/overlapping
boxes across layers are expected and harmless (same region gets redacted twice, which looks
identical to once).

## Install / usage

No build step. Pass in `onnxruntime-web` and `tesseract.js` as already-loaded globals (via
`<script>` tag or your own bundler) — the engine doesn't bundle or fetch them itself.

```js
import { RedactionEngine, bracketLabel } from './src/redaction-engine.js';

const engine = new RedactionEngine({ ort: window.ort, Tesseract: window.Tesseract });
await engine.init(); // downloads model weights from Hugging Face on first call

// Layers 1-3, on a screenshot/image:
const { regions, timings } = await engine.detect(imageOrCanvas);

// Layer 0, on the live page (sync, instant):
const domRegions = engine.detectDom(document);

// Draw labeled, dimmed redaction boxes (not solid black — shows what was redacted, e.g. "[NAME]")
engine.redactCanvas(canvasCtx, [...regions, ...domRegions]);

// Or overlay directly on live DOM elements:
engine.redactDomOverlay(domRegions);
```

Model weights are **not** committed to this repo — they're fetched at runtime from Hugging
Face on first `init()`. See `src/redaction-engine.js` `DEFAULT_MODEL_URLS` to override with
a locally-hosted copy.

## Demo

`demo/index.html` — a working test page using the actual published module (not a copy). Serve
the repo root with any static file server that sends
`Cross-Origin-Opener-Policy: same-origin` / `Cross-Origin-Embedder-Policy: require-corp`
(see `server.py`) and open `demo/index.html`. Buttons load real test cases (a registration
form, a face grid, a chat screenshot, a real Aadhaar sample) — none of the sample images are
of real identifiable people except the Aadhaar sample, which is a widely-circulated public
sample ID used for OCR-testing tutorials, not a private document.

## MV3 / browser-extension integration notes

Read this before wiring `src/` into a content script — these are real constraints, not
assumptions:

- **CSP**: MV3's `content_security_policy.extension_pages` cannot be relaxed to allow remote
  `<script src="https://...">` tags (`script-src` is locked to `'self'` for extension pages
  under Chrome's remote-code policy). **onnxruntime-web and tesseract.js must be bundled as
  local extension files**, not loaded from a CDN — that works fine on a plain webpage (as the
  demo does) but will not work the same way inside an extension's own page. A content script
  running in a target *webpage's* context follows that page's CSP instead, which is
  inconsistent across sites — bundling locally sidesteps this entirely.
- **Fetching model weights** (the `.onnx` binary files) from Hugging Face at runtime via
  `fetch()` is fine under MV3 — that's data, not executable code, and is unaffected by the
  restriction above. Requires `host_permissions` covering the Hugging Face domain (or wherever
  you choose to host the weights).
- **Local module loading**: dynamic `import()` of the engine's own JS files from
  `chrome.runtime.getURL(...)` works from a content script's isolated world — verified via
  `extension-test/`.
- **Tesseract.js Web Workers**: not yet verified running inside an actual extension content
  script (only verified on a plain webpage). Test this specifically before shipping — worker
  script loading from a `chrome-extension://` origin is the one piece of this pipeline that
  hasn't been confirmed working in a real extension context yet.
- `extension-test/` contains a minimal unpacked-extension harness that verifies the two
  genuinely new risk items (local module import + remote model fetch) without re-running the
  full AI pipeline inside the extension shell — that's already proven in `demo/`. Load it via
  `chrome://extensions` → Developer mode → Load unpacked → select `extension-test/`.

## Known limitations

- **Names in Devanagari (or other non-Latin) script are not covered** by the name-detection
  heuristic — it only matches Title-Case Latin-script word patterns (e.g. catches "Bhushan
  Diwakar" but not "भूषण दिवाकर" on the same card).
- **The name heuristic is pattern-based, not a trained model** — on images with little or no
  real text (e.g. a photo with visual noise/texture and nothing to actually read), Tesseract
  can occasionally hallucinate plausible-looking capitalized text fragments, producing a false
  positive. Not expected to be a meaningful problem on real screens/documents, which have
  substantial genuine UI text that dominates over any incidental noise.
- **PII vision model category labels aren't always accurate** even when the *region* is
  correctly located (e.g. may label an Aadhaar number as "phone" instead of "id") — if your
  redaction logic blacks out any detected region regardless of label, this doesn't matter; if
  you display the category to the user, expect occasional mislabeling.
- **screenpipe/pii-image-redactor's license is CC BY-NC 4.0** (non-commercial). Fine for a
  hackathon; contact the model author before any commercial deployment.
- Total detect() time (0.5-10s depending on image size, dominated by the OCR layer) is not
  "instant" — plan the extension's UX around a brief redaction delay, not a synchronous
  screen-capture-to-redacted-image step.
