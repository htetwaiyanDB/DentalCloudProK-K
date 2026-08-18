import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  './20260806213848_atomic_treatment_sales_patient_delete.sql',
  import.meta.url
)), 'utf8');

describe('atomic clinical workflows migration', () => {
  it('locks patient and medicine rows before changing balances or stock', () => {
    expect(migration.match(/FOR UPDATE;/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration).toContain('SET stock = stock - p_quantity');
    expect(migration).toContain('SET balance = COALESCE(balance, 0) + v_total');
  });

  it('keeps treatment side effects in one database function', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.record_treatment_atomic');
    expect(migration).toContain('public.sell_medicine_atomic(');
    expect(migration).toContain("SET status = 'Completed'");
    expect(migration).toContain("INSERT INTO public.loyalty_transactions");
  });

  it('preserves every appointment and deletes the patient within one call', () => {
    expect(migration).toContain('UPDATE public.appointments');
    expect(migration).toContain('WHERE patient_id = p_patient_id;');
    expect(migration).toContain('DELETE FROM public.payments WHERE patient_id = p_patient_id;');
    expect(migration).toContain('DELETE FROM public.patients WHERE id = p_patient_id;');
  });

  it('uses invoker rights and explicit function grants', () => {
    expect(migration.match(/SECURITY INVOKER/g)?.length).toBe(3);
    expect(migration.match(/REVOKE ALL ON FUNCTION/g)?.length).toBe(3);
    expect(migration.match(/TO anon, authenticated;/g)?.length).toBe(3);
  });
});
