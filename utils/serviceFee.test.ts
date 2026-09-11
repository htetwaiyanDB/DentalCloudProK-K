import { describe, expect, it } from 'vitest';
import type { PaymentRecord } from '../types';
import { getSuggestedServiceFeeAmount, hasRecordedServiceFeeForVisit } from './serviceFee';

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

describe('automatic patient service-fee suggestions', () => {
  it.each([
    { enabled: true, configuredAmount: 5_000, hasRecordedFeeForVisit: false, expected: 5_000 },
    { enabled: false, configuredAmount: 5_000, hasRecordedFeeForVisit: false, expected: 0 },
    { enabled: true, configuredAmount: 0, hasRecordedFeeForVisit: false, expected: 0 },
    { enabled: true, configuredAmount: 5_000, hasRecordedFeeForVisit: true, expected: 0 }
  ])('returns $expected when enabled=$enabled, configuredAmount=$configuredAmount, and prior fee=$hasRecordedFeeForVisit', ({ expected, ...params }) => {
    expect(getSuggestedServiceFeeAmount(params)).toBe(expected);
  });
});
