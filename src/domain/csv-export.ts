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
  // Un Excel réglé en français ouvre le fichier avec « ; » comme séparateur :
  // la ligne entière est alors mal découpée, les guillemets (qui ne comptent
  // qu'en début de champ) ne protègent plus rien, et « note;=cmd|… » donne une
  // cellule qui commence par « = ». Tout séparateur suivi d'une formule est
  // donc neutralisé à l'intérieur du texte aussi.
  text = text.replace(/([;,\t])(?=[=+\-@])/g, "$1'");
  // Toujours entre guillemets : un séparateur entre guillemets n'en est jamais un.
  return `"${text.replace(/"/g, '""')}"`;
}
