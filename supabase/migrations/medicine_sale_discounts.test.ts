import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('./20260808000000_add_medicine_sale_discounts.sql', import.meta.url)), 'utf8');

describe('medicine sale discounts migration', () => {
  it('adds constrained discount metadata with a legacy backfill', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS standard_total');
    expect(migration).toContain('SET standard_total = COALESCE(standard_total, total_price)');
    expect(migration).toContain('medicine_sales_total_consistency_check');
    expect(migration).toContain("pricing_note IN ('FOC', 'DISCOUNT')");
  });

  it('calculates discount, patient balance, and loyalty from the validated final total', () => {
    expect(migration).toContain('v_total := ROUND(COALESCE(p_final_total, v_standard_total), 2)');
    expect(migration).toContain("WHEN v_total = 0 THEN 'FOC'");
    expect(migration).toContain('SET balance = COALESCE(balance, 0) + v_total');
    expect(migration).toContain('FLOOR(v_total * COALESCE(v_rule.points_per_unit, 0.001))');
  });

  it('uses invoker rights and explicit grants for the seven-argument overload', () => {
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.sell_medicine_atomic(UUID, UUID, UUID, NUMERIC, UUID, DATE, NUMERIC) FROM PUBLIC');
    expect(migration).toContain('TO anon, authenticated;');
  });

  it('keeps full-price treatment and AI callers compatible through the six-argument wrapper', () => {
    expect(migration).toContain('p_treatment_id, p_sale_date, NULL::NUMERIC');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.sell_medicine_atomic(UUID, UUID, UUID, NUMERIC, UUID, DATE) FROM PUBLIC');
  });
});