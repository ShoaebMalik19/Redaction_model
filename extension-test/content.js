// Verifies the two genuinely-new-risk items when moving from a plain webpage
// (already proven in demo/) to a real MV3 content-script context:
//   1. Can the content script's isolated world dynamically import() a local
//      extension JS module (chrome-extension:// URL)?
//   2. Can it fetch() a large remote binary (the actual PII model file from
//      Hugging Face) given host_permissions?
// Does NOT re-run onnxruntime-web/tesseract.js here — see README for why.

(async () => {
  const results = { steps: [] };

  try {
    const domUrl = chrome.runtime.getURL('src/layers/dom-check.js');
    const { detectDomFields } = await import(domUrl);
    results.steps.push({ step: 'dynamic import() of local extension module', ok: true });

    const domRegions = detectDomFields(document);
    results.steps.push({ step: 'detectDomFields() ran on the real page', ok: true, fieldsFound: domRegions.length });
  } catch (e) {
    results.steps.push({ step: 'module import / DOM layer', ok: false, error: e.message });
  }

  try {
    const resp = await fetch('https://huggingface.co/screenpipe/pii-image-redactor/resolve/main/rfdetr_v38.onnx', { method: 'HEAD' });
    results.steps.push({ step: 'fetch() remote model URL (Hugging Face)', ok: resp.ok, status: resp.status });
  } catch (e) {
    results.steps.push({ step: 'fetch() remote model URL (Hugging Face)', ok: false, error: e.message });
  }

  console.log('[pii-redaction-engine extension-test]', JSON.stringify(results, null, 2));
  window.__piiEngineTestResults = results;
})();
