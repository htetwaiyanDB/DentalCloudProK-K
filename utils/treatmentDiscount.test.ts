import { describe, expect, it } from 'vitest';
import { distributeOverallDiscount, distributeOverallTreatmentDiscount } from './treatmentDiscount';

it('allocates inventory discounts while preserving quantities and free items', () => {
  const result = distributeOverallDiscount([
    { medicineId: 'a', quantity: 2, cost: 100 },
    { medicineId: 'b', quantity: 1, cost: 200 },
    { medicineId: 'free', quantity: 3, cost: 0 }
  ], 100);
  expect(result).toEqual([
    { medicineId: 'a', quantity: 2, cost: 66.67 },
    { medicineId: 'b', quantity: 1, cost: 133.33 },
    { medicineId: 'free', quantity: 3, cost: 0 }
  ]);
});

describe('distributeOverallTreatmentDiscount', () => {
  const lines = [
    { teeth: [11], cost: 350000, standardCost: 350000 },
    { teeth: [12], cost: 350000, standardCost: 350000 }
  ];

  it('distributes an overall discount without changing the exact combined total', () => {
    const result = distributeOverallTreatmentDiscount(lines, 20000);
    expect(result.map((line) => line.cost)).toEqual([340000, 340000]);
    expect(result.reduce((sum, line) => sum + line.cost, 0)).toBe(680000);
  });

  it('applies the overall discount after existing per-line discounts', () => {
    const result = distributeOverallTreatmentDiscount([
      { ...lines[0], cost: 300000 },
      lines[1]
    ], 65000);
    expect(result.reduce((sum, line) => sum + line.cost, 0)).toBe(585000);
  });

  it('caps the discount at the current subtotal and never creates negative charges', () => {
    const result = distributeOverallTreatmentDiscount(lines, 9999999);
    expect(result.map((line) => line.cost)).toEqual([0, 0]);
  });

  it('preserves cent-level totals when proportional shares need rounding', () => {
    const result = distributeOverallTreatmentDiscount([
      { teeth: [11], cost: 100, standardCost: 100 },
      { teeth: [12], cost: 100, standardCost: 100 },
      { teeth: [13], cost: 100, standardCost: 100 }
    ], 100);

    expect(result.map((line) => line.cost)).toEqual([66.67, 66.66, 66.67]);
    expect(result.reduce((sum, line) => sum + line.cost, 0)).toBe(200);
  });

  it('normalizes invalid monetary values instead of producing NaN or Infinity', () => {
    const result = distributeOverallTreatmentDiscount([
      { teeth: [11], cost: Number.POSITIVE_INFINITY, standardCost: 100 },
      { teeth: [12], cost: Number.NaN, standardCost: 100 },
      { teeth: [13], cost: 100, standardCost: 100 }
    ], Number.POSITIVE_INFINITY);

    expect(result.map((line) => line.cost)).toEqual([0, 0, 100]);
    expect(result.every((line) => Number.isFinite(line.cost))).toBe(true);
  });
});
