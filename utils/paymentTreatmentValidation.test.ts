import { describe, expect, it } from 'vitest';
import type { ClinicalRecord, PaymentRecord } from '../types';
import { resolvePaymentTreatmentsForCollection, validateAuthoritativePaymentTreatments } from './paymentTreatmentValidation';

const treatment = (id: string, overrides: Partial<ClinicalRecord> = {}): ClinicalRecord => ({
  id,
  location_id: 'location-1',
  patient_id: 'patient-1',
  teeth: [],
  description: 'PEEK Denture',
  cost: 3_000_000,
  date: '2026-08-13',
  ...overrides
});

describe('resolvePaymentTreatmentsForCollection', () => {
  it('links a later balance payment to the treatment that still has an outstanding amount', () => {
    const balanceTreatment = treatment('treatment-300k', { cost: 300_000, date: '2026-10-20' });
    const firstPayment: PaymentRecord = {
      id: 'payment-200k',
      patientId: 'patient-1',
      amount: 200_000,
      clearedAmount: 200_000,
      treatmentIds: ['treatment-300k'],
      date: '2026-10-20',
      type: 'PARTIAL',
      remainingBalance: 100_000
    };

    expect(resolvePaymentTreatmentsForCollection({
      selected: [],
      authoritative: [balanceTreatment],
      previousPayments: [firstPayment],
      patientId: 'patient-1',
      locationId: 'location-1',
      paymentDate: '2026-10-21',
      treatmentAmount: 100_000
    })).toEqual([balanceTreatment]);
  });

  it('does not link service-fee-only collections to a treatment', () => {
    expect(resolvePaymentTreatmentsForCollection({
      selected: [],
      authoritative: [treatment('service-fee-candidate', { cost: 300_000 })],
      previousPayments: [],
      patientId: 'patient-1',
      locationId: 'location-1',
      paymentDate: '2026-10-21',
      treatmentAmount: 0
    })).toEqual([]);
  });
});

describe('validateAuthoritativePaymentTreatments', () => {
  it('returns current database rows for a valid selection', () => {
    const staleClientCopy = treatment('treatment-1', { description: 'old label' });
    const databaseCopy = treatment('treatment-1', { description: 'current label' });
    expect(validateAuthoritativePaymentTreatments(
      [staleClientCopy], [databaseCopy], 'patient-1', 'location-1'
    )).toEqual([databaseCopy]);
  });

  it('rejects an undone treatment before payment', () => {
    expect(() => validateAuthoritativePaymentTreatments(
      [treatment('deleted')], [treatment('replacement')], 'patient-1', 'location-1'
    )).toThrow(/undone or changed/i);
  });

  it('rejects duplicate and cross-patient treatment references', () => {
    expect(() => validateAuthoritativePaymentTreatments(
      [treatment('one'), treatment('one')], [treatment('one')], 'patient-1', 'location-1'
    )).toThrow(/duplicate/i);
    expect(() => validateAuthoritativePaymentTreatments(
      [treatment('one')], [treatment('one', { patient_id: 'patient-2' })], 'patient-1', 'location-1'
    )).toThrow(/patient and branch/i);
  });
});
