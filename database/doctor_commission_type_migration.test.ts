import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260803000000_add_doctor_commission_type.sql'),
  'utf8'
);

describe('doctor commission type migration', () => {
  it('is a forward migration with safe legacy backfill and constrained modes', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS commission_type TEXT');
    expect(migration).toContain("IN ('Ortho', 'Implant', 'Surgery')");
    expect(migration).toContain("CHECK (commission_type IN ('percentage', 'flat_visit'))");
    expect(migration).toContain('ALTER COLUMN commission_type SET NOT NULL');
  });

  it('reconciles the existing flat amount column before replacing the RPC', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS commission_per_visit NUMERIC(12,2)');
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.get_applicable_commission_rate(UUID, UUID)');
    expect(migration).toContain('RETURNS DECIMAL(12,2)');
  });

  it('restores least-privilege execution and reloads the Data API schema', () => {
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain('SET search_path = public, pg_temp');
    expect(migration).toContain('REVOKE ALL ON FUNCTION');
    expect(migration).toContain('TO anon, authenticated');
    expect(migration).toContain("NOTIFY pgrst, 'reload schema'");
  });
});