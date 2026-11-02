import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  './20261102134854_backfill_separate_payment_mls_rows.sql',
  import.meta.url
)), 'utf8');

describe('separate payment MLS audit backfill migration', () => {
  it('backfills exactly one durable audit parent for every historical payment', () => {
    expect(migration).toContain("SELECT 'payment', payment.id");
    expect(migration).toContain('ON CONFLICT (source_type, source_id) DO UPDATE');
    expect(migration).toContain("audit.source_type = 'payment'");
    expect(migration).toContain('WHERE audit.id IS NULL');
  });

  it('creates future payment audit parents automatically and securely', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.sync_payment_mls_audit_log()');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = public, pg_temp');
    expect(migration).toContain('AFTER INSERT OR UPDATE OF location_id, patient_id, treatment_ids');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.sync_payment_mls_audit_log() FROM PUBLIC');
  });

  it('does not duplicate old treatment-linked costs across payment rows', () => {
    expect(migration).not.toContain('INSERT INTO public.patient_material_costs');
  });
});
