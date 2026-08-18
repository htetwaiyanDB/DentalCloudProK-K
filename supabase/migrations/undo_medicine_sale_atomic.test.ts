import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('./20260808100000_undo_medicine_sale_atomic.sql', import.meta.url)), 'utf8');

describe('atomic medicine sale undo migration', () => {
  it('locks authoritative patient, sale, and inventory rows', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.undo_medicine_sale_atomic');
    expect(migration.match(/FOR UPDATE;/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration).toContain('v_sale.loyalty_points_earned IS NULL');
  });

  it('blocks direct receipt capture and paid linked treatments', () => {
    expect(migration).toContain("payment.receipt_snapshot -> 'medicines'");
    expect(migration).toContain("v_sale.treatment_id = ANY(COALESCE(payment.treatment_ids, '{}'::UUID[]))");
    expect(migration).toContain("payment.receipt_snapshot -> 'treatments'");
    expect(migration).toContain('Paid or receipted medicine records cannot be undone');
  });

  it('restores stock and reverses the final charge and exact loyalty points atomically', () => {
    expect(migration).toContain('SET stock = COALESCE(stock, 0) + v_sale.quantity');
    expect(migration).toContain('COALESCE(balance, 0) - COALESCE(v_sale.total_price, 0)');
    expect(migration).not.toContain('COALESCE(balance, 0) - COALESCE(v_sale.standard_total, 0)');
    expect(migration).toContain("'REVERSED'");
    expect(migration).toContain('DELETE FROM public.medicine_sales WHERE id = p_medicine_sale_id;');
  });

  it('uses invoker rights and explicit execute privileges', () => {
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.undo_medicine_sale_atomic(UUID) FROM PUBLIC;');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.undo_medicine_sale_atomic(UUID) TO anon, authenticated;');
  });
});