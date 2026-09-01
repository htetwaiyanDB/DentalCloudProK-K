import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  './20260901000000_optimize_clinical_focus_history.sql',
  import.meta.url
)), 'utf8');

describe('Clinical Focus history index migration', () => {
  it('adds idempotent indexes matching patient filters and newest-first ordering', () => {
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS idx_treatments_patient_date_id');
    expect(migration).toContain('ON public.treatments (patient_id, date DESC, id)');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS idx_medicine_sales_patient_date_id');
    expect(migration).toContain('ON public.medicine_sales (patient_id, date DESC, id)');
  });

  it('uses a short lock timeout for production-safe failure instead of indefinite waiting', () => {
    expect(migration).toContain("SET lock_timeout = '5s'");
  });
});