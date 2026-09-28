import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  './20260928000000_payment_based_mls_costs.sql',
  import.meta.url
)), 'utf8');

describe('payment-based MLS costs migration', () => {
  it('accepts payment audit rows while retaining legacy treatment support', () => {
    expect(migration).toContain("v_source_type NOT IN ('treatment', 'payment')");
    expect(migration).toContain("IF v_source_type = 'payment' THEN");
    expect(migration).toContain('FROM public.payments pay');
    expect(migration).toContain('FROM public.treatments treatment');
  });

  it('keeps the cost replacement transactional and permission protected', () => {
    expect(migration).toContain('BEGIN;');
    expect(migration).toContain("users.allowed_tabs ? 'material-cost'");
    expect(migration).toContain('session.revoked_at IS NULL');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.replace_treatment_costs');
    expect(migration).toMatch(/NOTIFY pgrst, 'reload schema';\s*COMMIT;/);
  });
});
