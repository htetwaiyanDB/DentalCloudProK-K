import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  './20260804033408_validate_reconciled_payment_allocations.sql',
  import.meta.url
)), 'utf8');
const followUpMigration = readFileSync(fileURLToPath(new URL(
  './20260804044527_enforce_two_way_reconciled_treatment_links.sql',
  import.meta.url
)), 'utf8');

describe('reconciled payment allocation guard migration', () => {
  it('keeps old clients compatible and validates only marked snapshots', () => {
    expect(migration).toContain("receipt_snapshot ->> 'allocationReconciled'");
    expect(migration).toContain('IS NOT TRUE THEN');
  });

  it('rejects unexplained amounts and linked treatments missing from the snapshot', () => {
    expect(migration).toContain('NEW.amount > v_treatment_total + v_medicine_total + v_service_fee');
    expect(migration).toContain('Linked treatment is missing from reconciled receipt snapshot');
    expect(migration).toContain('treatment.patient_id <> NEW.patient_id');
  });

  it('runs before insert/update and atomically replaces the pending receipt number', () => {
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF amount, treatment_ids, receipt_snapshot');
    expect(migration).toContain("'{receiptNumber}'");
    expect(migration).toContain('to_jsonb(NEW.receipt_number::TEXT)');
  });

  it('tightens marked receipts to exact totals and two-way treatment links', () => {
    expect(followUpMigration).toContain('IS DISTINCT FROM \'array\'');
    expect(followUpMigration).toContain('ABS(NEW.amount - (v_treatment_total + v_medicine_total + v_service_fee)) > 0.005');
    expect(followUpMigration).toContain('Receipt snapshot treatment is missing from linked treatment IDs');
    expect(followUpMigration).toContain('IS NOT TRUE THEN');
  });
});
