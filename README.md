<div align="center">

# PII Redaction Engine

**On-device privacy filter for browser agents: finds and redacts faces, passwords, IDs, phone numbers and names before a screenshot ever leaves the browser.**

[![JavaScript](https://img.shields.io/badge/JavaScript_ESM-1a1a1a?style=for-the-badge&logo=javascript&logoColor=F7DF1E)](https://developer.mozilla.org/docs/Web/JavaScript)
[![ONNX Runtime Web](https://img.shields.io/badge/ONNX_Runtime_Web-1f2937?style=for-the-badge&logo=onnx&logoColor=white)](https://onnxruntime.ai)
[![Tesseract.js](https://img.shields.io/badge/Tesseract.js_OCR-1e293b?style=for-the-badge&logo=googlelens&logoColor=white)](https://tesseract.projectnaptha.com)
[![Hugging Face](https://img.shields.io/badge/Hugging_Face_Models-1a1a1a?style=for-the-badge&logo=huggingface&logoColor=FFD21E)](https://huggingface.co)
[![Chrome MV3](https://img.shields.io/badge/Chrome_Extension_MV3-202124?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3)
[![SIH](https://img.shields.io/badge/SIH-SIH26171-0b3d2e?style=for-the-badge)](#-overview)

</div>

---

## ✨ Overview

Built for **SIH26171** (ISRO: On-device Visual Perception for Lightweight Browser Agents). This is the **privacy filter layer** that sits *before* an agent's cloud LLM/VLM call:

```
capture screen → run this engine → send only the sanitized output onward
```

Everything runs client-side. Nothing is sent to a server; only the model weights are fetched (from Hugging Face) on first use.

## 🚀 Features

- **Four independent detection layers** whose results are unioned (overlapping boxes are harmless):

  | Layer | What | Speed | Notes |
  | --- | --- | --- | --- |
  | 0. DOM check | `input[type=password]`, username/email/card fields | instant | Ground truth, no model. Works on a live page, not a flat image. |
  | 1. PII vision model | Text-based PII regions in a screenshot | ~0.2-0.8s | [screenpipe/pii-image-redactor](https://huggingface.co/screenpipe/pii-image-redactor) (RF-DETR, ONNX, ~57MB). **CC BY-NC 4.0, non-commercial only.** |
  | 2. Face detector | Faces | ~0.1-0.6s | [SCRFD-500m](https://huggingface.co/RuteNL/SCRFD-face-detection-ONNX) (ONNX, 2.3MB, Apache-2.0) |
  | 3. OCR + regex safety net | Aadhaar-style numbers, phone numbers, password values, proper names | ~2-10s | Tesseract.js (`eng` and `eng+hin` in parallel) plus pattern matching |

- **Labeled redaction:** dimmed boxes tagged with what was removed (for example `[NAME]`) instead of solid black.
- **Canvas or live-DOM output:** redact a screenshot on a canvas, or overlay directly on page elements.
- **Context-aware name detection:** pass `domRoot: document` when the image is a capture of the current page to cut false positives from nav links and headings.
- **No build step:** plain ES modules; bring your own `onnxruntime-web` and `tesseract.js`.

## 🧱 Tech Stack

- **Runtime:** browser, plain ES modules
- **Inference:** `onnxruntime-web` running RF-DETR (PII) and SCRFD (faces)
- **OCR:** `tesseract.js` (English + Hindi)
- **Integration target:** Chrome Manifest V3 content scripts
- **Dev server:** a tiny Python static server that sends COOP/COEP headers

## 🗂️ Project Structure

```
.
├── src/
│   ├── redaction-engine.js   # Public API: RedactionEngine
│   ├── labels.js             # Redaction label text and sizing
│   └── layers/
│       ├── dom-check.js      # Layer 0: sensitive form fields
│       ├── pii-vision.js     # Layer 1: PII vision model
│       ├── face-detect.js    # Layer 2: SCRFD face detector
│       └── ocr-regex.js      # Layer 3: OCR + regex safety net
├── demo/index.html           # Interactive test page using the real module
├── extension-test/           # Minimal unpacked MV3 extension harness
├── test-images/              # Sample form, face grid, chat screenshot, ID sample
└── server.py                 # Static server with COOP/COEP headers (port 8903)
```

## ⚡ Getting Started

### Use the engine

Load `onnxruntime-web` and `tesseract.js` yourself (script tag or bundler) and pass them in; the engine does not bundle or fetch them.

```js
import { RedactionEngine, bracketLabel } from './src/redaction-engine.js';

const engine = new RedactionEngine({ ort: window.ort, Tesseract: window.Tesseract });
await engine.init(); // downloads model weights from Hugging Face on first call

// Layers 1-3, on a screenshot/image:
const { regions, timings } = await engine.detect(imageOrCanvas);

// Layer 0, on the live page (sync, instant):
const domRegions = engine.detectDom(document);

// Draw labeled, dimmed redaction boxes
engine.redactCanvas(canvasCtx, [...regions, ...domRegions]);

// Or overlay directly on live DOM elements:
engine.redactDomOverlay(domRegions);
```

Model weights are **not** committed. To self-host them, override `modelUrls` (see `DEFAULT_MODEL_URLS` in `src/redaction-engine.js`):

```js
new RedactionEngine({ ort, Tesseract, modelUrls: { pii: '/models/pii.onnx', face: '/models/face.onnx' } });
```

### Run the demo

The demo needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. `server.py` sends both:

```bash
python server.py
# open http://localhost:8903/demo/index.html
```

The demo buttons load the test cases in [`test-images/`](test-images): a registration form, a face grid, a chat screenshot and a widely circulated public Aadhaar sample used in OCR tutorials.

### Load the extension harness

`chrome://extensions` → Developer mode → **Load unpacked** → select `extension-test/`. It verifies local module `import()` from a content script and remote model fetch under `host_permissions`, without re-running the full AI pipeline.

## 🧩 MV3 Integration Notes

- **CSP:** MV3 extension pages cannot load remote scripts, so **`onnxruntime-web` and `tesseract.js` must be bundled as local extension files** rather than loaded from a CDN.
- **Model weights:** fetching `.onnx` files at runtime is fine under MV3 (data, not code). It needs `host_permissions` for wherever the weights are hosted.
- **Local module loading:** dynamic `import()` of the engine from `chrome.runtime.getURL(...)` works from a content script's isolated world (verified via `extension-test/`).
- **Tesseract.js workers:** verified on a plain webpage, **not yet verified** inside an extension content script. Test this before shipping.

## ⚠️ Known Limitations

- Names in Devanagari or other non-Latin scripts are not covered by the name heuristic (Title-Case Latin only).
- The name heuristic is pattern-based, so OCR on texture-heavy images with little real text can occasionally produce false positives.
- The PII vision model sometimes mislabels the category (for example an Aadhaar number as "phone") even when the region is correct.
- `screenpipe/pii-image-redactor` is **CC BY-NC 4.0**: contact the model author before any commercial use.
- Total `detect()` time is roughly 0.5-10s depending on image size, dominated by OCR, so plan the UX around a short redaction delay.

## 🛣️ Roadmap

- Bundle `onnxruntime-web` and `tesseract.js` into the extension and verify Tesseract workers inside a content script.
- Extend name detection to non-Latin scripts.

## 👤 Author

**Mohammed Shoaeb Malik** · AI & Full-Stack Developer, Bengaluru

[![GitHub](https://img.shields.io/badge/GitHub-ShoaebMalik19-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/ShoaebMalik19)
