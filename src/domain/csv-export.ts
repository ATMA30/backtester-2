/**
 * Quote one CSV field.
 *
 * The export interpolated raw values into a comma-joined line. Ids and reasons
 * are well-formed today, but positions restored from an imported session file
 * carry whatever that file contained — a comma or a newline there shifted every
 * subsequent column of the export.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  // Nombres : jamais neutralisés, un « -12.5 » doit rester un nombre.
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = String(value);
  // Injection de formule : Excel et LibreOffice évaluent `=HYPERLINK(…)` même
  // entre guillemets. Un texte qui commence par = + - @ tab ou CR est préfixé
  // d'une apostrophe, qui le force en texte.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
