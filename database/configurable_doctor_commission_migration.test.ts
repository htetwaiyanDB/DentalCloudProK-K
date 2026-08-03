import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('./configurable_doctor_commission_migration.sql', import.meta.url)), 'utf8');
const completeSetup = readFileSync(fileURLToPath(new URL('./complete_database_setup.sql', import.meta.url)), 'utf8');

describe('configurable doctor commission schema', () => {
  it('backfills legacy doctors without overwriting explicit selections', () => {
    expect(migration).toContain("WHEN TRIM(COALESCE(specialization, '')) IN ('Ortho', 'Implant', 'Surgery') THEN 'fixed'");
    expect(migration).toMatch(/WHERE commission_type IS NULL;/);
    expect(migration).toContain("CHECK (commission_type IN ('percentage', 'fixed'))");
  });

  it('uses the selected mode in the commission RPC and reloads PostgREST after commit', () => {
    expect(migration).toContain("IF v_commission_type = 'fixed' THEN");
    expect(migration).not.toContain("IF v_specialization IN");
    expect(migration).toMatch(/COMMIT;\s+NOTIFY pgrst, 'reload schema';/);
  });

  it('keeps old-client inserts compatible during a rolling deployment', () => {
    expect(migration).toContain('IF NEW.commission_type IS NULL THEN');
    expect(migration).toContain('BEFORE INSERT ON public.doctors');
    expect(migration).toContain('trg_set_legacy_doctor_commission_type');
  });

  it('keeps fresh installations aligned with the additive migration', () => {
    expect(completeSetup).toMatch(/commission_type TEXT NOT NULL DEFAULT 'percentage'/);
    expect(completeSetup).toContain('doctors_commission_type_check');
    expect(completeSetup).toContain("IF v_commission_type = 'fixed' THEN");
    expect(completeSetup).toContain('FUNCTION public.configure_doctor_commission');
  });

  it('replaces custom treatment rates transactionally after validating the full list', () => {
    expect(migration).toContain('FUNCTION public.configure_doctor_commission');
    expect(migration).toMatch(/FOR v_item IN[\s\S]*DELETE FROM public\.doctor_treatment_commissions[\s\S]*INSERT INTO public\.doctor_treatment_commissions/);
    expect(migration).toContain('A valid staff session with Doctor permission is required.');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON public.doctor_treatment_commissions');
    expect(migration).toContain('REVOKE INSERT, UPDATE ON public.doctors');
    expect(migration).toContain('GRANT UPDATE (location_id, name, email, phone, specialization, password) ON public.doctors');
  });

  it('checks prerequisites before mutation and safely recreates the legacy rate RPC', () => {
    expect(migration.indexOf("to_regclass('public.doctor_treatment_commissions')")).toBeLessThan(migration.indexOf('ALTER TABLE public.doctors'));
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.get_applicable_commission_rate(UUID, UUID);');
  });
});