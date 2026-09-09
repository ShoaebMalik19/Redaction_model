// Human-readable bracket labels shown on redaction boxes, e.g. "[NAME]", "[PASSWORD]".
// Keeping the redacted value's category visible (instead of a plain black box) lets a
// viewer understand what was hidden without seeing the actual value.

export const LABEL_BRACKETS = {
  private_person: 'NAME', private_email: 'EMAIL', private_phone: 'PHONE',
  private_address: 'ADDRESS', private_url: 'URL', private_company: 'COMPANY',
  private_repo: 'REPO', private_handle: 'HANDLE', private_channel: 'CHANNEL',
  private_id: 'ID', private_date: 'DATE', secret: 'SECRET',
  face: 'FACE',
  'aadhaar-pattern': 'AADHAAR', 'phone-pattern': 'PHONE', 'password-value': 'PASSWORD',
  'name-pattern': 'NAME',
  'password-field': 'PASSWORD', 'username-field': 'USERNAME', 'email-field': 'EMAIL',
  'card-number-field': 'CARD NUMBER',
};

export function bracketLabel(label) {
  return `[${LABEL_BRACKETS[label] || label.replace(/[-_]/g, ' ').toUpperCase()}]`;
}

export function fitFontSize(ctx, text, maxWidth, startSize, minSize) {
  let size = startSize;
  ctx.font = `bold ${size}px sans-serif`;
  while (ctx.measureText(text).width > maxWidth - 6 && size > minSize) {
    size -= 1;
    ctx.font = `bold ${size}px sans-serif`;
  }
  return size;
}
