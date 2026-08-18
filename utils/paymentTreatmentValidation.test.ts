import { describe, expect, it } from 'vitest';
import type { ClinicalRecord } from '../types';
import { validateAuthoritativePaymentTreatments } from './paymentTreatmentValidation';

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