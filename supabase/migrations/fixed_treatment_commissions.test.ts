import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('./20260829000000_add_fixed_treatment_commissions.sql', import.meta.url)),
  'utf8'
);
const followUpMigration = readFileSync(
  fileURLToPath(new URL('./20260829010000_preserve_commission_override_modes.sql', import.meta.url)),
  'utf8'
);

describe('fixed treatment commission migration', () => {
  it('adds a non-negative fixed override field without changing percentage rates', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS fixed_amount NUMERIC(12,2)');
    expect(migration).toContain('CHECK (fixed_amount IS NULL OR fixed_amount >= 0)');
  });

  it('uses a fixed treatment override before the doctor default and keeps percentage resolution intact', () => {
    expect(migration).toContain("IF v_commission_type IN ('fixed', 'flat_visit') THEN");
    expect(migration).toContain('RETURN COALESCE(v_custom_fixed_amount, v_commission_per_visit, 0);');
    expect(migration).toContain('RETURN COALESCE(v_custom_rate, v_default_rate, 0);');
  });

  it('replaces fixed and percentage treatment overrides through the authorized RPC', () => {
    expect(migration).toContain('INSERT INTO public.doctor_treatment_commissions (doctor_id, treatment_id, commission_rate, fixed_amount)');
    expect(migration).toContain('A valid staff session with Doctor permission is required.');
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
  });

  it('keeps irrelevant override fields null so changing commission methods does not create a zero override', () => {
    expect(followUpMigration).toContain('SET fixed_amount = NULL');
    expect(followUpMigration).toContain("CASE WHEN p_commission_type = 'percentage' THEN (value->>'commission_rate')::DECIMAL(5,2) ELSE 0 END");
    expect(followUpMigration).toContain("CASE WHEN p_commission_type = 'fixed' THEN (value->>'fixed_amount')::DECIMAL(12,2) ELSE NULL END");
  });
});