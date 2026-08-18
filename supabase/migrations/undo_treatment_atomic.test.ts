import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  './20260807044648_undo_treatment_atomic.sql',
  import.meta.url
)), 'utf8');

describe('atomic treatment undo migration', () => {
  it('captures exact treatment and medicine loyalty values when records are created', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS loyalty_points_earned INTEGER');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.capture_clinical_loyalty_points()');
    expect(migration).toContain('BEFORE INSERT ON public.treatments');
    expect(migration).toContain('BEFORE INSERT ON public.medicine_sales');
    expect(migration).toContain('FOR SHARE;');
  });

  it('locks authoritative rows and refuses unsafe legacy or paid treatment undo', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.undo_treatment_atomic');
    expect(migration.match(/FOR UPDATE;/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration).toContain('v_treatment.loyalty_points_earned IS NULL');
    expect(migration).toContain("p_treatment_id = ANY(COALESCE(payment.treatment_ids, '{}'::UUID[]))");
    expect(migration).toContain("Paid or reconciled treatments cannot be undone");
  });

  it('reverses balance, loyalty, medicine stock, linked sales, and treatment in one function', () => {
    expect(migration).toContain('SET stock = COALESCE(stock, 0) + v_stock.quantity');
    expect(migration).toContain('SET balance = ROUND((COALESCE(balance, 0) - v_total_reversal)::NUMERIC, 2)');
    expect(migration).toContain("'REVERSED'");
    expect(migration).toContain('DELETE FROM public.medicine_sales WHERE treatment_id = p_treatment_id;');
    expect(migration).toContain('DELETE FROM public.treatments WHERE id = p_treatment_id;');
  });

  it('uses invoker rights and explicit execute privileges', () => {
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.undo_treatment_atomic(UUID) FROM PUBLIC;');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.undo_treatment_atomic(UUID) TO anon, authenticated;');
  });
});
