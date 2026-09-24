import { describe, expect, it } from 'vitest';
import { csvCell } from './csv-export';

describe('csvCell — export du journal', () => {
  it('neutralise une formule venue d’une session partagée', () => {
    expect(csvCell('=HYPERLINK("https://evil.tld","x")')).toBe(`"'=HYPERLINK(""https://evil.tld"",""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('laisse les nombres négatifs intacts', () => {
    expect(csvCell(-12.5)).toBe('-12.5');
  });
});
