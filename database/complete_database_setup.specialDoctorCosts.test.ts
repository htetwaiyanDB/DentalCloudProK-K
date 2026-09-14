import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const setup = readFileSync(fileURLToPath(new URL('./complete_database_setup.sql', import.meta.url)), 'utf8');

describe('complete database setup special doctor costs', () => {
  it('accepts special doctor rows in tables, treatment replacement, and presets', () => {
    expect(setup.match(/CHECK \(cost_type IN \('material', 'lab', 'special_doctor'\)\)/g)?.length).toBe(2);
    expect(setup.match(/item\.cost_type NOT IN \('material', 'lab', 'special_doctor'\)/g)?.length).toBe(2);
  });

  it('keeps special doctor rows out of automatically generated expenses', () => {
    expect(setup).not.toContain('IF v_special_doctor_total > 0');
    expect(setup).not.toContain("'Special Doctor Cost', v_treatment_date");
    expect(setup).toContain("source_type IN ('material_cost', 'lab_cost', 'special_doctor_cost')");
  });
});
