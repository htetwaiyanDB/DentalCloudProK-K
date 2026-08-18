import type { MedicineSale, PaymentReceiptMedicineLine } from '../types';

export interface MedicineSalePricing {
  finalTotal: number;
  standardTotal: number;
  discountAmount: number;
  note: '' | 'FOC' | 'Discount';
}

const finiteNonNegative = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric * 100) / 100) : 0;
};

export const resolveMedicineSalePricing = (
  sale: Partial<MedicineSale & PaymentReceiptMedicineLine> & Record<string, unknown>
): MedicineSalePricing => {
  const finalTotal = finiteNonNegative(sale.total_price ?? sale.totalPrice);
  const explicitStandard = Number(sale.standard_total ?? sale.standardTotal);
  const explicitDiscount = finiteNonNegative(sale.discount_amount ?? sale.discountAmount);
  const calculatedStandard = finiteNonNegative(sale.unit_price ?? sale.unitPrice)
    * finiteNonNegative(sale.quantity);
  const standardTotal = Number.isFinite(explicitStandard) && explicitStandard >= 0
    ? Math.max(finalTotal, explicitStandard, finalTotal + explicitDiscount)
    : explicitDiscount > 0
      ? finalTotal + explicitDiscount
      : Math.max(finalTotal, calculatedStandard);
  const discountAmount = Math.max(0, Math.round((standardTotal - finalTotal) * 100) / 100);
  const pricingNote = sale.pricing_note ?? sale.pricingNote;
  const note = discountAmount > 0
    ? (pricingNote === 'FOC' || finalTotal === 0 ? 'FOC' : 'Discount')
    : '';

  return { finalTotal, standardTotal, discountAmount, note };
};