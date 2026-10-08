import { describe, expect, it } from 'vitest';
import { csvCell } from './csv-export';

describe('csvCell — export du journal', () => {
  it('neutralise une formule venue d’une session partagée', () => {
    expect(csvCell('=HYPERLINK("https://evil.tld","x")')).toBe(`"'=HYPERLINK(""https://evil.tld"",""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
  });

  it('neutralise une formule cachée derrière un séparateur régional', () => {
    // Excel en français découpe sur « ; » : la seconde moitié serait évaluée.
    expect(csvCell("Bon trade;=cmd|' /C calc'!A0")).toBe(`"Bon trade;'=cmd|' /C calc'!A0"`);
    expect(csvCell('x,+1')).toBe(`"x,'+1"`);
    expect(csvCell('1 - 2 = -1')).toBe('"1 - 2 = -1"');
  });

  it('met tout texte entre guillemets', () => {
    expect(csvCell('EURUSD')).toBe('"EURUSD"');
    expect(csvCell('a "b"')).toBe('"a ""b"""');
  });

  it('laisse les nombres négatifs intacts', () => {
    expect(csvCell(-12.5)).toBe('-12.5');
  });
});
