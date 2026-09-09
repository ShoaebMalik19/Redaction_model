// Public API for the redaction engine. This is what a browser-extension content
// script imports and calls — everything else in src/ is an implementation detail.
//
// Usage:
//   import { RedactionEngine } from './redaction-engine.js';
//   const engine = new RedactionEngine({ ort, Tesseract });   // pass the globals your page already loaded
//   await engine.init();
//   const regions = await engine.detect(imageOrCanvas);        // vision + OCR layers (async, ~0.5-6s)
//   const domRegions = engine.detectDom(document);              // DOM layer (sync, instant)
//   engine.redactCanvas(canvasCtx, [...regions, ...domRegions]);

import { loadPiiSession, detectPii } from './layers/pii-vision.js';
import { loadFaceSession, detectFaces } from './layers/face-detect.js';
import { detectViaOcr } from './layers/ocr-regex.js';
import { detectDomFields } from './layers/dom-check.js';
import { bracketLabel, fitFontSize } from './labels.js';

const DEFAULT_MODEL_URLS = {
  pii: 'https://huggingface.co/screenpipe/pii-image-redactor/resolve/main/rfdetr_v38.onnx',
  face: 'https://huggingface.co/RuteNL/SCRFD-face-detection-ONNX/resolve/main/500m.onnx',
};

export class RedactionEngine {
  /**
   * @param {object} deps
   * @param {object} deps.ort - the onnxruntime-web module/global (window.ort)
   * @param {object} deps.Tesseract - the tesseract.js global (window.Tesseract)
   * @param {object} [deps.modelUrls] - override default model URLs (e.g. to serve locally)
   */
  constructor({ ort, Tesseract, modelUrls = {} }) {
    if (!ort) throw new Error('RedactionEngine requires onnxruntime-web (pass as `ort`)');
    if (!Tesseract) throw new Error('RedactionEngine requires tesseract.js (pass as `Tesseract`)');
    this.ort = ort;
    this.Tesseract = Tesseract;
    this.modelUrls = { ...DEFAULT_MODEL_URLS, ...modelUrls };
    this.piiSession = null;
    this.faceSession = null;
  }

  async init() {
    [this.piiSession, this.faceSession] = await Promise.all([
      loadPiiSession(this.ort, this.modelUrls.pii),
      loadFaceSession(this.ort, this.modelUrls.face),
    ]);
  }

  /** Layers 1-3 (vision PII model, face detector, OCR+regex safety net) on a
   * screenshot/image. Run engine.detectDom() separately for the DOM layer. */
  async detect(img) {
    if (!this.piiSession || !this.faceSession) {
      throw new Error('RedactionEngine.init() must be called and awaited before detect()');
    }
    // NOTE: the PII and face sessions must run sequentially, not in Promise.all —
    // onnxruntime-web's WebGPU backend throws "Session already started" if two
    // sessions try to run concurrently on the same GPU context. OCR uses a
    // separate engine (Tesseract/WASM) so it's safe to run alongside both.
    const ocrPromise = detectViaOcr(this.Tesseract, img);
    const pii = await detectPii(this.ort, this.piiSession, img);
    const face = await detectFaces(this.ort, this.faceSession, img);
    const ocr = await ocrPromise;
    return {
      regions: [...pii.results, ...face.results, ...ocr.results],
      timings: { piiMs: pii.time, faceMs: face.time, ocrMs: ocr.time },
    };
  }

  /** Layer 0. Synchronous, instant, no model involved. */
  detectDom(root = document) {
    return detectDomFields(root);
  }

  /** Draw solid black redaction boxes with a bold white category label (e.g.
   * "[PASSWORD]") on top — hides the value while still showing what was redacted. */
  redactCanvas(ctx, regions) {
    for (const d of regions) {
      const boxW = d.x2 - d.x1, boxH = d.y2 - d.y1;
      ctx.fillStyle = '#000000';
      ctx.fillRect(d.x1, d.y1, boxW, boxH);

      const text = bracketLabel(d.label);
      const fontSize = fitFontSize(ctx, text, boxW, Math.max(10, Math.min(16, boxH * 0.5)), 8);
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, d.x1 + boxW / 2, d.y1 + boxH / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  /** Create labeled overlay <div>s positioned over live DOM elements (for engine.detectDom()
   * results). Appends to `container` (defaults to document.body) using fixed positioning. */
  redactDomOverlay(regions, container = document.body) {
    const created = [];
    for (const d of regions) {
      const div = document.createElement('div');
      div.textContent = bracketLabel(d.label);
      div.style.cssText = `
        position: fixed; left: ${d.x1}px; top: ${d.y1}px;
        width: ${d.x2 - d.x1}px; height: ${d.y2 - d.y1}px;
        background: #000000;
        display: flex; align-items: center; justify-content: center; overflow: hidden;
        color: #ffffff; font-weight: bold; font-size: ${Math.max(9, Math.min(12, (d.y2 - d.y1) * 0.4))}px;
        letter-spacing: 0.5px; pointer-events: none; z-index: 2147483647; box-sizing: border-box;
      `;
      container.appendChild(div);
      created.push(div);
    }
    return created; // caller can remove these later, e.g. when the page changes
  }
}

export { bracketLabel } from './labels.js';
