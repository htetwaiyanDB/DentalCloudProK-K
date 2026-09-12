import { describe, expect, it } from 'vitest';
import type { PaymentRecord, PaymentReceiptSnapshot } from '../types';
import { getPaymentTreatmentShare } from './paymentTreatmentAllocation';

const receipt = (amountPaid: number, medicineTotal: number): PaymentReceiptSnapshot => ({
  version: 1,
  receiptType: 'PAYMENT',
  receiptNumber: 'REC-LEGACY-MIXED',
  receiptDate: '2026-09-05',
  currency: 'MMK',
  clinic: { appName: 'Clinic', headerTitle: 'Receipt', email: '', phone: '' },
  patient: { id: 'patient-1', name: 'Patient One' },
  payment: {
    amountPaid,
    method: 'CASH',
    status: 'FULL',
    balanceBefore: amountPaid,
    balanceAfter: 0,
    serviceFeeAmount: 0
  },
  treatments: [],
  medicines: medicineTotal > 0 ? [{
    id: 'medicine-1',
    date: '2026-09-05',
    medicineName: 'Medicine',
    quantity: 1,
    unitPrice: medicineTotal,
    totalPrice: medicineTotal
  }] : []
});

const payment = (amount: number, medicineTotal: number): PaymentRecord => ({
  id: 'payment-1',
  patientId: 'patient-1',
  amount,
  clearedAmount: amount,
  date: '2026-09-05',
  type: 'FULL',
  remainingBalance: 0,
  receiptSnapshot: receipt(amount, medicineTotal)
});

describe('payment treatment allocation', () => {
  it('infers the treatment share when a legacy mixed receipt omitted treatment lines', () => {
    expect(getPaymentTreatmentShare(payment(88_000, 13_000))).toBe(75_000);
  });

  it('does not make a medicine-only receipt commissionable', () => {
    expect(getPaymentTreatmentShare(payment(13_000, 13_000))).toBe(0);
  });
});
