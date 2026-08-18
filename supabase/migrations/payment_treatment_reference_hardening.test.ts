import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  './20260813010000_harden_payment_treatment_references.sql',
  import.meta.url
)), 'utf8');

describe('payment treatment reference hardening', () => {
  it('always validates duplicate, existence, patient, and branch ownership', () => {
    expect(migration).toContain('guard_payment_treatment_references');
    expect(migration).toContain('Payment contains duplicate treatment references');
    expect(migration).toContain('treatment.patient_id = NEW.patient_id');
    expect(migration).toContain('treatment.location_id = NEW.location_id');
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF patient_id, location_id, treatment_ids');
  });

  it('locks referenced treatments against concurrent atomic undo', () => {
    expect(migration).toContain('FOR KEY SHARE');
    expect(migration).toContain('v_locked_count <> v_link_count');
    expect(migration).toContain('SET search_path = pg_catalog, public, pg_temp');
    expect(migration).not.toContain('pending_payment_commission_recalculations');
  });
});
