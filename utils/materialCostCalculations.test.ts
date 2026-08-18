import { describe, expect, it } from 'vitest';

import type { ClinicalRecord, PaymentRecord } from '../types';
import {
  calculateCollectedByTreatmentId,
  calculateMaterialAdjustedDoctorEarnings,
  calculateMaterialNetProfit
} from './materialCostCalculations';

const treatment = (overrides: Partial<ClinicalRecord> = {}): ClinicalRecord => ({
  id: 'treatment-1',
  location_id: 'location-1',
  patient_id: 'patient-1',
  teeth: [],
  description: 'Scaling',
  cost: 100_000,
  date: '2026-07-13',
  doctorEarnings: 40_000,
  ...overrides
});

const payment = (overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: 'payment-1',
  patientId: 'patient-1',
  amount: 100_000,
  clearedAmount: 100_000,
  treatmentIds: ['treatment-1'],
  date: '2026-07-13',
  type: 'FULL',
  remainingBalance: 0,
  ...overrides
});

describe('material cost calculations', () => {
  it('excludes service fees from collected treatment amounts', () => {
    const receiptSnapshot = {
      payment: { serviceFeeAmount: 10_000 }
    } as PaymentRecord['receiptSnapshot'];

    expect(calculateCollectedByTreatmentId(
      [treatment()],
      [payment({ receiptSnapshot })]
    )).toEqual({ 'treatment-1': 90_000 });
  });

  it('caps collected treatment amounts at treatment debt', () => {
    expect(calculateCollectedByTreatmentId(
      [treatment({ cost: 100_000 })],
      [payment({ amount: 130_000, clearedAmount: 130_000 })]
    )).toEqual({ 'treatment-1': 100_000 });
  });

  it('allocates unlinked payments to the oldest outstanding treatment debt', () => {
    const records = [
      treatment({ id: 'old', date: '2026-05-01', cost: 100_000 }),
      treatment({ id: 'new', date: '2026-06-01', cost: 100_000 })
    ];

    expect(calculateCollectedByTreatmentId(records, [payment({
      date: '2026-07-01',
      amount: 150_000,
      clearedAmount: 150_000,
      treatmentIds: []
    })])).toEqual({ old: 100_000, new: 50_000 });
  });

  it('does not count duplicate copies of the same payment twice', () => {
    const duplicate = payment({ amount: 60_000, clearedAmount: 60_000 });

    expect(calculateCollectedByTreatmentId([treatment()], [duplicate, { ...duplicate }]))
      .toEqual({ 'treatment-1': 60_000 });
  });

  it('deduplicates legacy and persisted copies by receipt number', () => {
    const persisted = payment({ id: 'persisted-id', receiptNumber: 'REC-100', amount: 60_000, clearedAmount: 60_000 });
    const legacy = payment({ id: 'legacy-id', receiptNumber: 'REC-100', amount: 60_000, clearedAmount: 60_000 });

    expect(calculateCollectedByTreatmentId([treatment()], [persisted, legacy]))
      .toEqual({ 'treatment-1': 60_000 });
  });

  it('deducts service fee and medicine before mixed receipt treatment collection', () => {
    const receiptSnapshot = {
      receiptNumber: 'REC-MIXED',
      payment: { serviceFeeAmount: 10_000 },
      treatments: [{ id: 'treatment-1', finalCost: 60_000 }],
      medicines: [{ id: 'medicine-sale-1', totalPrice: 30_000 }]
    } as PaymentRecord['receiptSnapshot'];

    expect(calculateCollectedByTreatmentId(
      [treatment()],
      [payment({ amount: 50_000, clearedAmount: 50_000, receiptSnapshot })]
    )).toEqual({ 'treatment-1': 10_000 });
  });

  it('does not reassign an explicitly linked payment outside the loaded scope', () => {
    expect(calculateCollectedByTreatmentId(
      [treatment({ id: 'visible-treatment' })],
      [payment({ treatmentIds: ['hidden-treatment'] })]
    )).toEqual({});
  });

  it('uses persisted payment-based doctor earnings for material cost reporting', () => {
    const record = treatment({
      doctor_specialization: 'General',
      doctor_commission_percentage: 40,
      doctorEarnings: 18_000
    });
    const materialCost = () => 10_000;

    expect(calculateMaterialAdjustedDoctorEarnings([record])).toBe(18_000);
    expect(calculateMaterialNetProfit([record], materialCost)).toBe(72_000);
  });

  it('keeps flat per-visit commission unchanged', () => {
    const record = treatment({
      doctor_specialization: 'Ortho',
      doctor_commission_percentage: 40,
      doctor_commission_per_visit: 15_000
    });

    expect(calculateMaterialAdjustedDoctorEarnings([record])).toBe(40_000);
    expect(calculateMaterialNetProfit([record], () => 10_000)).toBe(50_000);
  });

  it('uses the stored flat earning after payment recalculation', () => {
    const record = treatment({
      doctor_specialization: 'Ortho',
      doctor_commission_percentage: 40,
      doctor_commission_per_visit: 15_000,
      doctorEarnings: 15_000
    });

    expect(calculateMaterialAdjustedDoctorEarnings([record])).toBe(15_000);
    expect(calculateMaterialNetProfit([record], () => 10_000)).toBe(75_000);
  });

  it('uses stored earnings even when commission settings are unavailable', () => {
    const record = treatment({ doctor_commission_percentage: null });

    expect(calculateMaterialAdjustedDoctorEarnings([record])).toBe(40_000);
    expect(calculateMaterialNetProfit([record], () => 25_000)).toBe(35_000);
  });

  it('supports zero stored earnings after core recalculation clamps a negative commission base', () => {
    const record = treatment({
      doctor_specialization: 'General',
      doctor_commission_percentage: 40,
      doctorEarnings: 0
    });

    expect(calculateMaterialAdjustedDoctorEarnings([record])).toBe(0);
    expect(calculateMaterialNetProfit([record], () => 120_000)).toBe(-20_000);
  });

  it('prevents non-finite values from escaping financial report calculations', () => {
    const record = treatment({ cost: Number.POSITIVE_INFINITY, doctorEarnings: Number.NaN });

    expect(calculateMaterialAdjustedDoctorEarnings([record])).toBe(0);
    expect(calculateMaterialNetProfit([record], () => Number.NEGATIVE_INFINITY)).toBe(0);
  });
});
