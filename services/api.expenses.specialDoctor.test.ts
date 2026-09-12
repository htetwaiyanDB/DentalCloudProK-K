import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiSource = readFileSync(fileURLToPath(new URL('./api.ts', import.meta.url)), 'utf8');

describe('Special Doctor expense visibility', () => {
  it('does not synthesize Special Doctor MLS rows into the Expenses list', () => {
    expect(apiSource).toContain("return (['material', 'lab'] as TreatmentCostType[]).flatMap");
    expect(apiSource).not.toContain("return (['material', 'lab', 'special_doctor'] as TreatmentCostType[]).flatMap");
  });
});
