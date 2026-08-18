import { describe, expect, it } from 'vitest';
import { resolveMedicineSalePricing } from './medicineSalePricing';

describe('resolveMedicineSalePricing', () => {
  it('resolves a discounted medicine sale', () => {
    expect(resolveMedicineSalePricing({
      quantity: 2, unit_price: 5000, total_price: 8000,
      standard_total: 10000, discount_amount: 2000, pricing_note: 'DISCOUNT'
    })).toEqual({ finalTotal: 8000, standardTotal: 10000, discountAmount: 2000, note: 'Discount' });
  });

  it('preserves FOC pricing', () => {
    expect(resolveMedicineSalePricing({
      quantity: 2, unit_price: 5000, total_price: 0,
      standard_total: 10000, discount_amount: 10000, pricing_note: 'FOC'
    })).toEqual({ finalTotal: 0, standardTotal: 10000, discountAmount: 10000, note: 'FOC' });
  });

  it('keeps legacy full-price sales undiscounted', () => {
    expect(resolveMedicineSalePricing({ quantity: 3, unit_price: 2000, total_price: 6000 }))
      .toEqual({ finalTotal: 6000, standardTotal: 6000, discountAmount: 0, note: '' });
  });

  it('repairs inconsistent and invalid metadata without changing the final charge', () => {
    expect(resolveMedicineSalePricing({
      quantity: Number.NaN, unit_price: Number.POSITIVE_INFINITY, total_price: 4500,
      standard_total: 4500, discount_amount: 500
    })).toEqual({ finalTotal: 4500, standardTotal: 5000, discountAmount: 500, note: 'Discount' });
  });
});