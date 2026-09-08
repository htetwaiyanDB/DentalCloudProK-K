import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  './20260908110000_treatment_commission_snapshot.sql',
  import.meta.url
)), 'utf8');

describe('treatment commission snapshot migration', () => {
  it('stores mode, effective rate, source, and snapshot time on treatments', () => {
    expect(migration).toContain('commission_type_snapshot');
    expect(migration).toContain('commission_percentage_snapshot');
    expect(migration).toContain('commission_per_visit_snapshot');
    expect(migration).toContain('commission_source_snapshot');
    expect(migration).toContain('commission_snapshot_at');
  });

  it('prefers historical ledger evidence when backfilling existing treatments', () => {
    expect(migration).toContain('ledger.calculation_mode');
    expect(migration).toContain("THEN 'ledger_history'");
    expect(migration).toContain('ORDER BY entry.payment_date, entry.created_at, entry.id');
  });

  it('captures new treatment defaults and custom overrides in the database', () => {
    expect(migration).toContain('capture_treatment_commission_snapshot');
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON public.treatments');
    expect(migration).toContain("THEN 'treatment_override'");
  });

  it('preserves the snapshot during unrelated treatment and earnings updates', () => {
    expect(migration).toContain('NEW.doctor_id IS NOT DISTINCT FROM OLD.doctor_id');
    expect(migration).toContain('NEW.commission_type_snapshot := OLD.commission_type_snapshot');
    expect(migration).toContain('NEW.commission_snapshot_at := OLD.commission_snapshot_at');
  });
});
