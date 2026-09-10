import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(fileURLToPath(new URL('./20260905000004_add_special_doctor_treatment_costs.sql', import.meta.url)), 'utf8');

describe('Special Doctor treatment costs migration', () => {
  it('is transactional, rerunnable, and preserves existing RPC identities', () => {
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
    expect(sql).toContain("SET LOCAL statement_timeout = '120s';");
    expect(sql).toContain("to_regclass('public.pending_commission_recalculations')");
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS patient_material_costs_cost_type_check');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS material_lab_cost_presets_cost_type_check');
    expect(sql.match(/NOT VALID/g)?.length).toBe(2);
    expect(sql.match(/VALIDATE CONSTRAINT/g)?.length).toBe(2);
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.replace_treatment_costs(');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.replace_material_lab_cost_presets(');
    expect(sql).toMatch(/NOTIFY pgrst, 'reload schema';\s*COMMIT;/);
  });

  it('accepts, totals, and synchronizes the special doctor category', () => {
    expect(sql.match(/'special_doctor'/g)?.length).toBeGreaterThan(5);
    expect(sql).toContain("FILTER (WHERE cost_type = 'special_doctor')");
    expect(sql).toContain("'Special Doctor Cost'");
    expect(sql).toContain("'special_doctor_cost'");
    expect(sql).toContain("source_type IN ('material_cost', 'lab_cost', 'special_doctor_cost')");
  });

  it('retains staff-session, branch, permission, and function-grant protections', () => {
    expect(sql).toContain("u.allowed_tabs ? 'material-cost'");
    expect(sql).toContain('u.doctor_id IS NULL');
    expect(sql).toContain('u.location_id = v_location_id');
    expect(sql).toContain('s.revoked_at IS NULL');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.replace_treatment_costs');
  });
});