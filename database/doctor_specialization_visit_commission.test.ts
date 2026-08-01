import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(new URL('./add_doctor_specialization_visit_commission.sql', import.meta.url));
const migration = readFileSync(migrationPath, 'utf8');
const completeSetupPath = fileURLToPath(new URL('./complete_database_setup.sql', import.meta.url));
const completeSetup = readFileSync(completeSetupPath, 'utf8');

describe('Doctor specialization visit commission schema', () => {
  it('keeps fresh installations aligned with the additive migration', () => {
    expect(completeSetup).toMatch(/commission_per_visit DECIMAL\(12,2\) DEFAULT 0/);
    expect(completeSetup).toContain('doctors_commission_per_visit_check');
    expect(completeSetup).toContain("v_specialization IN ('Ortho', 'Implant', 'Surgery')");
    expect(completeSetup).toContain('RETURN COALESCE(v_commission_per_visit, 0);');
  });

  it('reloads the PostgREST schema cache after the additive migration', () => {
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
    expect(migration).toMatch(/NOTIFY pgrst, 'reload schema';\r?\n\r?\nCOMMIT;/);
  });
});
