import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('./20260813020000_fix_doctor_correction_audit_rls.sql', import.meta.url)),
  'utf8'
);

describe('doctor correction audit RLS repair', () => {
  it('allows the secured correction RPC to append its immutable audit record', () => {
    expect(migration).toContain('CREATE POLICY doctor_assignment_corrections_insert_via_rpc');
    expect(migration).toContain('FOR INSERT');
    expect(migration).toContain('WITH CHECK (true)');
  });

  it('keeps direct client table access revoked', () => {
    const originalMigration = readFileSync(
      fileURLToPath(new URL('./20260809000000_visit_doctor_correction.sql', import.meta.url)),
      'utf8'
    );
    expect(originalMigration).toContain('REVOKE ALL ON public.doctor_assignment_corrections FROM anon, authenticated;');
  });
});
