import { describe, expect, it } from 'vitest';

import type { PaymentRecord } from '../types';
import {
  getPatientPaymentHistory,
  formatPaymentTime,
  getPaymentBalanceAfter,
  getPaymentReceiptNumber,
  getPaymentReceivedAmount
} from './paymentHistory';

const payment = (overrides: Partial<PaymentRecord>): PaymentRecord => ({
  id: 'payment-1',
  location_id: 'branch-1',
  patientId: 'patient-1',
  amount: 500,
  date: '2026-08-01',
  type: 'PARTIAL',
  remainingBalance: 1000,
  ...overrides
});

describe('patient payment history', () => {
  it('keeps only the selected patient payments and sorts newest first', () => {
    const result = getPatientPaymentHistory([
      payment({ id: 'older', date: '2026-07-01' }),
      payment({ id: 'other-patient', patientId: 'patient-2', date: '2026-08-09' }),
      payment({ id: 'newer', date: '2026-08-01' })
    ], 'patient-1');

    expect(result.map((item) => item.id)).toEqual(['newer', 'older']);
  });

  it('uses the creation timestamp to order same-day payments', () => {
    const result = getPatientPaymentHistory([
      payment({ id: 'morning', createdAt: '2026-08-01T08:00:00Z' }),
      payment({ id: 'afternoon', createdAt: '2026-08-01T14:00:00Z' })
    ], 'patient-1');

    expect(result.map((item) => item.id)).toEqual(['afternoon', 'morning']);
  });

  it('uses corrected financial values and stored receipt metadata when available', () => {
    const record = payment({
      amount: 500,
      clearedAmount: 450,
      remainingBalance: 1000,
      patientCurrentBalance: 1050,
      receiptSnapshot: {
        version: 1,
        receiptType: 'PAYMENT',
        receiptNumber: 'REC-1001',
        receiptDate: '2026-08-01',
        currency: 'MMK',
        clinic: { appName: 'Clinic', headerTitle: 'Receipt', email: '', phone: '' },
        patient: { id: 'patient-1', name: 'Patient' },
        payment: { amountPaid: 500, method: 'CASH', status: 'PARTIAL', balanceBefore: 1500, balanceAfter: 1000 }
      }
    });

    expect(getPaymentReceivedAmount(record)).toBe(450);
    expect(getPaymentBalanceAfter(record)).toBe(1050);
    expect(getPaymentReceiptNumber(record)).toBe('REC-1001');
  });

  it('does not display invalid legacy payment times', () => {
    expect(formatPaymentTime(undefined)).toBeNull();
    expect(formatPaymentTime('not-a-date')).toBeNull();
  });

  it('does not render malformed legacy financial values as NaN', () => {
    const record = payment({ amount: Number.NaN, remainingBalance: Number.NaN });
    expect(getPaymentReceivedAmount(record)).toBe(0);
    expect(getPaymentBalanceAfter(record)).toBe(0);
  });
});