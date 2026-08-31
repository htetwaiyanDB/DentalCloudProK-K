import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('./20260813030000_secure_doctor_correction_rpc.sql', import.meta.url)),
  'utf8'
);

describe('doctor correction RPC security repair', () => {
  it('runs the correction RPC with its owner permissions', () => {
    expect(migration).toContain(') SECURITY DEFINER;');
    expect(migration).toContain(') SET search_path = public, pg_temp;');
  });

  it('only exposes RPC execution to the API roles', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.correct_visit_doctor_atomic');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.correct_visit_doctor_atomic');
  });
});
