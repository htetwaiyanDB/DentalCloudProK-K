import { describe, expect, it } from 'vitest';
import {
  calculateDoctorEarnings,
  resolveDoctorCommissionType,
  usesFlatVisitCommission,
  validateDoctorCommissionPercentage,
  validateDoctorCommissionPerVisit,
  validateDoctorCommissionType
} from './doctorCommission';

describe('doctor commission mode', () => {
  it('uses the explicit percentage mode regardless of specialization', () => {
    expect(resolveDoctorCommissionType({
      commissionType: 'percentage',
      specialization: 'Surgery'
    })).toBe('percentage');
  });

  it('uses the explicit fixed mode for any custom specialization', () => {
    expect(usesFlatVisitCommission({
      commissionType: 'fixed',
      specialization: 'Pediatric Dentistry'
    })).toBe(true);
  });

  it('treats the upstream flat_visit vocabulary as fixed (K&K DB compatibility)', () => {
    expect(resolveDoctorCommissionType({
      commissionType: 'flat_visit',
      specialization: 'General'
    })).toBe('fixed');
    expect(usesFlatVisitCommission({
      commissionType: 'flat_visit',
      specialization: 'General'
    })).toBe(true);
  });

  it('preserves legacy behavior only when commission_type is unavailable', () => {
    expect(resolveDoctorCommissionType({ specialization: 'Ortho' })).toBe('fixed');
    expect(resolveDoctorCommissionType({ specialization: 'General' })).toBe('percentage');
  });

  it('does not infer fixed mode from a custom specialization', () => {
    expect(resolveDoctorCommissionType({ specialization: 'Orthodontics' })).toBe('percentage');
  });

  it('rejects invalid supplied methods instead of silently inferring one', () => {
    expect(() => validateDoctorCommissionType('hourly')).toThrow('Commission method');
    expect(validateDoctorCommissionType('flat_visit')).toBe('fixed');
    expect(validateDoctorCommissionType('fixed')).toBe('fixed');
  });

  it('calculates flat per-visit earnings only after payment is collected', () => {
    expect(calculateDoctorEarnings({
      collectedPayment: 1000,
      commissionType: 'fixed',
      specialization: 'General',
      commissionPercentage: 50,
      commissionPerVisit: 120
    })).toBe(120);
    expect(calculateDoctorEarnings({
      collectedPayment: 1000,
      specialization: 'Ortho',
      commissionPercentage: 50,
      commissionPerVisit: 120
    })).toBe(120);
    expect(calculateDoctorEarnings({
      collectedPayment: 0,
      commissionType: 'fixed',
      commissionPercentage: 50,
      commissionPerVisit: 120
    })).toBe(0);
  });

  it('uses collected payment minus material cost as the percentage commission base', () => {
    expect(calculateDoctorEarnings({
      collectedPayment: 200_000,
      materialCost: 20_000,
      specialization: 'General',
      commissionPercentage: 10
    })).toBe(18_000);
    expect(calculateDoctorEarnings({
      collectedPayment: 1000,
      commissionType: 'percentage',
      specialization: 'Surgery',
      commissionPercentage: 50,
      commissionPerVisit: 120
    })).toBe(500);
  });

  it('validates commission amount boundaries', () => {
    expect(validateDoctorCommissionPercentage(100)).toBe(100);
    expect(() => validateDoctorCommissionPercentage(100.01)).toThrow('between 0 and 100');
    expect(validateDoctorCommissionPerVisit(0)).toBe(0);
    expect(() => validateDoctorCommissionPerVisit(-1)).toThrow('non-negative');
    expect(() => validateDoctorCommissionPerVisit(Number.POSITIVE_INFINITY)).toThrow('non-negative');
  });
});
