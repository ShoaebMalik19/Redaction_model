// Layer 3: OCR + pattern safety net. Catches things the vision models miss on
// clean documents/forms — Aadhaar-style numbers, phone numbers, password field
// values, and (new) proper names — by reading actual text and pattern-matching it.
//
// Runs two Tesseract passes in parallel (eng, eng+hin) and processes each pass's
// own native line grouping independently (Tesseract's line/word hierarchy is
// authoritative — an earlier custom y-coordinate clustering heuristic incorrectly
// split "Bhushan" and "Diwakar" into separate lines despite them being on the same
// visual row; Tesseract's own `data.lines` groups them correctly). Results from
// both passes are concatenated without deduplication — duplicate/overlapping boxes
// are harmless (same region redacted twice looks identical to once), and an
// earlier bbox-overlap dedup attempt was a real bug: it discarded a correctly-read
// Aadhaar number because it spuriously overlapped a garbled Hindi-pass token.

const AADHAAR_REGEX = /\d{4}\s?\d{4}\s?\d{4}/;
const PHONE_REGEX = /(\+?\d{1,3}[\s-]?)?\d{5}[\s-]?\d{5}\b/;

// Words that are Title-Case but are NOT names — field labels, document boilerplate,
// months, common sentence-starters. Keeps the name heuristic from over-firing.
const NAME_STOPWORDS = new Set([
  'government', 'india', 'male', 'female', 'dob', 'aadhaar', 'address', 'name',
  'card', 'identity', 'proof', 'citizenship', 'verification', 'authentication',
  'scanning', 'code', 'offline', 'online', 'issued', 'number', 'portal',
  'registration', 'user', 'company', 'full', 'email', 'phone', 'password',
  'remember', 'login', 'submit', 'home', 'log', 'in', 'this', 'the', 'should',
  'used', 'not', 'and', 'or', 'is', 'of', 'for', 'with', 'please', 'new', 'sign',
  'up', 'start', 'playing', 'chess', 'forgot', 'apple', 'google', 'facebook',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'it', 'as', 'so', 'but', 'if', 'when', 'while', 'after', 'before', 'you', 'your',
]);
const TITLE_CASE_WORD = /^[A-Z][a-z]{1,}$/;

function preprocessForOCR(img) {
  // upscale small images + grayscale + contrast stretch, helps OCR on photographed documents
  const scaleUp = (img.naturalWidth || img.width) < 1200 ? 1200 / (img.naturalWidth || img.width) : 1;
  const w = Math.round((img.naturalWidth || img.width) * scaleUp);
  const h = Math.round((img.naturalHeight || img.height) * scaleUp);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0, w, h);
  const imgData = cx.getImageData(0, 0, w, h);
  const d = imgData.data;
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const stretched = Math.min(255, Math.max(0, ((gray - min) / range) * 255));
    d[i] = d[i + 1] = d[i + 2] = stretched;
  }
  cx.putImageData(imgData, 0, 0);
  return { canvas: c, scale: scaleUp };
}

function boxFromWords(words, scale) {
  return {
    x1: Math.min(...words.map((w) => w.bbox.x0)) / scale,
    y1: Math.min(...words.map((w) => w.bbox.y0)) / scale,
    x2: Math.max(...words.map((w) => w.bbox.x1)) / scale,
    y2: Math.max(...words.map((w) => w.bbox.y1)) / scale,
  };
}

/** Find runs of 2+ consecutive Title-Case, non-stopword words on a line — the
 * name-detection heuristic. Zero added model weight; extends the same
 * pattern-matching approach already used for Aadhaar/phone/password. */
function findNameRuns(words) {
  const runs = [];
  let current = [];
  for (const w of words) {
    const clean = w.text.trim();
    const isNameWord = TITLE_CASE_WORD.test(clean) && !NAME_STOPWORDS.has(clean.toLowerCase());
    if (isNameWord) {
      current.push(w);
    } else {
      if (current.length >= 2) runs.push(current);
      current = [];
    }
  }
  if (current.length >= 2) runs.push(current);
  return runs;
}

/** Run all pattern checks against one OCR pass's native lines. */
function extractLineHits(lines, scale) {
  const results = [];
  for (const line of lines) {
    const words = (line.words || []).map((w) => ({ text: w.text, bbox: w.bbox }));
    if (words.length === 0) continue;
    const lineJoinedSpace = words.map((w) => w.text).join(' ');

    let hitAadhaarOrPhone = false;
    if (AADHAAR_REGEX.test(lineJoinedSpace)) {
      const digitWords = words.filter((w) => /^\d{2,4}$/.test(w.text));
      if (digitWords.length >= 2) {
        results.push({ source: 'regex', label: 'aadhaar-pattern', score: 1.0, ...boxFromWords(digitWords, scale) });
        hitAadhaarOrPhone = true;
      }
    }

    const digitOnlyWords = words.filter((w) => /^\+?\d{2,6}$/.test(w.text));
    const concatDigits = digitOnlyWords.map((w) => w.text.replace('+', '')).join('');
    if (digitOnlyWords.length >= 2 && PHONE_REGEX.test(concatDigits) && !AADHAAR_REGEX.test(lineJoinedSpace)) {
      results.push({ source: 'regex', label: 'phone-pattern', score: 1.0, ...boxFromWords(digitOnlyWords, scale) });
      hitAadhaarOrPhone = true;
    }

    const labelIdx = words.findIndex((w) => /^password:?$/i.test(w.text));
    if (labelIdx !== -1) {
      const valueWords = words.slice(labelIdx + 1);
      if (valueWords.length > 0) {
        results.push({ source: 'regex', label: 'password-value', score: 1.0, ...boxFromWords(valueWords, scale) });
      }
    }

    if (!hitAadhaarOrPhone) {
      for (const run of findNameRuns(words)) {
        results.push({ source: 'regex', label: 'name-pattern', score: 0.8, ...boxFromWords(run, scale) });
      }
    }
  }
  return results;
}

export async function detectViaOcr(Tesseract, img) {
  const t0 = performance.now();
  const { canvas: preCanvas, scale } = preprocessForOCR(img);

  const [resHin, resEng] = await Promise.all([
    Tesseract.recognize(preCanvas, 'eng+hin'),
    Tesseract.recognize(preCanvas, 'eng'),
  ]);

  const results = [
    ...extractLineHits(resEng.data.lines || [], scale),
    ...extractLineHits(resHin.data.lines || [], scale),
  ];

  const time = performance.now() - t0;
  return { results, time };
}
