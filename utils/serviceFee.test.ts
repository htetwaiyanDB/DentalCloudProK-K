import { describe, expect, it } from 'vitest';
import type { PaymentRecord } from '../types';
import { hasRecordedServiceFeeForVisit } from './serviceFee';

const payment = (overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: 'payment-1',
  patientId: 'patient-1',
  amount: 10_000,
  date: '2026-07-16',
  type: 'FULL',
  remainingBalance: 0,
  receiptSnapshot: {
    payment: {
      amountPaid: 10_000,
      method: 'CASH',
      status: 'FULL',
      balanceBefore: 10_000,
      balanceAfter: 0,
      serviceFeeAmount: 10_000,
      serviceFeeCategory: 'RETURNING'
    }
  } as PaymentRecord['receiptSnapshot'],
  ...overrides
});

describe('patient service fee visit checks', () => {
  it('detects an already-recorded fee for the same patient visit date', () => {
    expect(hasRecordedServiceFeeForVisit([payment()], 'patient-1', '2026-07-16')).toBe(true);
  });

  it('does not reuse another patient or date service fee', () => {
    expect(hasRecordedServiceFeeForVisit([payment()], 'patient-2', '2026-07-16')).toBe(false);
    expect(hasRecordedServiceFeeForVisit([payment()], 'patient-1', '2026-07-17')).toBe(false);
  });

  it('ignores payment rows without a positive service fee', () => {
    expect(hasRecordedServiceFeeForVisit([
      payment({ receiptSnapshot: undefined })
    ], 'patient-1', '2026-07-16')).toBe(false);
  });

  it('does not treat a voided payment as a recorded service fee', () => {
    expect(hasRecordedServiceFeeForVisit([
      payment({ amount: 0, clearedAmount: 0, voidedAt: '2026-07-16T09:30:00Z', voidedAmount: 10_000 })
    ], 'patient-1', '2026-07-16')).toBe(false);
  });
});
