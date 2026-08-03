import { describe, expect, it } from 'vitest';
import {
  allocateCommissionablePayments,
  calculateCommissionLedgerEntries,
  type CommissionTreatmentInput
} from './doctorCommissionLedger';

const treatment = (overrides: Partial<CommissionTreatmentInput> = {}): CommissionTreatmentInput => ({
  id: 'treatment-1',
  patientId: 'patient-1',
  doctorId: 'doctor-1',
  treatmentTypeId: 'type-1',
  date: '2026-06-15',
  cost: 500_000,
  specialization: 'General',
  commissionPercentage: 10,
  materialCost: 0,
  ...overrides
});

describe('doctor commission ledger', () => {
  it('earns 20,000 Ks from a 200,000 Ks partial payment at 10%', () => {
    const treatments = [treatment()];
    const allocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-1',
      patientId: 'patient-1',
      date: '2026-07-01',
      commissionableAmount: 200_000,
      treatmentIds: ['treatment-1']
    }]);

    expect(allocations).toEqual([expect.objectContaining({ amount: 200_000 })]);
    expect(calculateCommissionLedgerEntries(treatments, allocations)[0]).toMatchObject({
      paymentDate: '2026-07-01',
      commissionBase: 200_000,
      commissionRate: 10,
      earnings: 20_000
    });
  });

  it('applies an unlinked later payment to the oldest outstanding treatment', () => {
    const treatments = [
      treatment({ id: 'old', date: '2026-05-01', cost: 100_000 }),
      treatment({ id: 'new', date: '2026-06-01', cost: 100_000 })
    ];
    const allocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-1',
      patientId: 'patient-1',
      date: '2026-07-01',
      commissionableAmount: 150_000,
      treatmentIds: []
    }]);

    expect(allocations).toEqual([
      expect.objectContaining({ treatmentId: 'old', amount: 100_000 }),
      expect.objectContaining({ treatmentId: 'new', amount: 50_000 })
    ]);
  });

  it('caps commissionable allocation at treatment debt', () => {
    const allocations = allocateCommissionablePayments([treatment({ cost: 100_000 })], [{
      id: 'payment-1',
      patientId: 'patient-1',
      date: '2026-07-01',
      commissionableAmount: 130_000,
      treatmentIds: ['treatment-1']
    }]);

    expect(allocations.reduce((sum, row) => sum + row.amount, 0)).toBe(100_000);
  });

  it('pays the new selected treatment first and applies the remainder to old treatment debt', () => {
    const treatments = [
      treatment({ id: 'old', doctorId: 'old-doctor', date: '2026-05-01', cost: 300_000 }),
      treatment({ id: 'new', doctorId: 'new-doctor', date: '2026-07-01', cost: 200_000 })
    ];
    const allocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-1',
      patientId: 'patient-1',
      date: '2026-07-01',
      commissionableAmount: 500_000,
      treatmentIds: ['new']
    }]);

    expect(allocations).toEqual([
      expect.objectContaining({ treatmentId: 'new', amount: 200_000 }),
      expect.objectContaining({ treatmentId: 'old', amount: 300_000 })
    ]);
    expect(calculateCommissionLedgerEntries(treatments, allocations)).toEqual([
      expect.objectContaining({ treatmentId: 'new', doctorId: 'new-doctor', earnings: 20_000 }),
      expect.objectContaining({ treatmentId: 'old', doctorId: 'old-doctor', earnings: 30_000 })
    ]);
  });

  it('does not allocate a selected-treatment payment remainder twice', () => {
    const treatments = [
      treatment({ id: 'old', date: '2026-05-01', cost: 300_000 }),
      treatment({ id: 'new', date: '2026-07-01', cost: 200_000 })
    ];
    const allocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-1',
      patientId: 'patient-1',
      date: '2026-07-01',
      commissionableAmount: 250_000,
      treatmentIds: ['new']
    }]);

    expect(allocations).toEqual([
      expect.objectContaining({ treatmentId: 'new', amount: 200_000 }),
      expect.objectContaining({ treatmentId: 'old', amount: 50_000 })
    ]);
    expect(allocations.reduce((sum, allocation) => sum + allocation.amount, 0)).toBe(250_000);
  });

  it('uses a custom treatment percentage and preserves its historical snapshot', () => {
    const treatments = [treatment({ customCommissionPercentage: 15 })];
    const allocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-1',
      patientId: 'patient-1',
      date: '2026-07-01',
      commissionableAmount: 100_000,
      treatmentIds: ['treatment-1']
    }]);
    const initial = calculateCommissionLedgerEntries(treatments, allocations);
    expect(initial[0].earnings).toBe(15_000);

    const afterRateChange = calculateCommissionLedgerEntries(
      [treatment({ customCommissionPercentage: 25 })],
      allocations,
      [{
        paymentId: 'payment-1',
        treatmentId: 'treatment-1',
        calculationMode: 'percentage',
        commissionRate: initial[0].commissionRate
      }]
    );
    expect(afterRateChange[0].commissionRate).toBe(15);
    expect(afterRateChange[0].earnings).toBe(15_000);
  });

  it('deducts material cost once across partial payments', () => {
    const treatments = [treatment({ cost: 300_000, materialCost: 50_000 })];
    const allocations = allocateCommissionablePayments(treatments, [
      { id: 'p1', patientId: 'patient-1', date: '2026-07-01', commissionableAmount: 30_000, treatmentIds: ['treatment-1'] },
      { id: 'p2', patientId: 'patient-1', date: '2026-07-02', commissionableAmount: 100_000, treatmentIds: ['treatment-1'] }
    ]);
    const entries = calculateCommissionLedgerEntries(treatments, allocations);

    expect(entries.map((entry) => entry.earnings)).toEqual([0, 8_000]);
  });

  it('pays flat commission only once for multiple treatment rows in one visit', () => {
    const treatments = [
      treatment({ id: 't1', specialization: 'Surgery', commissionPerVisit: 15_000, cost: 100_000 }),
      treatment({ id: 't2', specialization: 'Surgery', commissionPerVisit: 15_000, cost: 100_000 })
    ];
    const allocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-1',
      patientId: 'patient-1',
      date: '2026-07-01',
      commissionableAmount: 200_000,
      treatmentIds: ['t1', 't2']
    }]);
    const entries = calculateCommissionLedgerEntries(treatments, allocations);

    expect(entries).toHaveLength(1);
    expect(entries[0].earnings).toBe(15_000);
  });

  it('uses the selected mode independently of specialization', () => {
    const fixedGeneral = treatment({ commissionType: 'fixed', specialization: 'General', commissionPerVisit: 12_000 });
    const percentageSurgery = treatment({ id: 'treatment-2', commissionType: 'percentage', specialization: 'Surgery', commissionPercentage: 10 });
    const allocations = allocateCommissionablePayments([fixedGeneral, percentageSurgery], [{
      id: 'payment-1', patientId: 'patient-1', date: '2026-07-01', commissionableAmount: 1_000_000,
      treatmentIds: ['treatment-1', 'treatment-2']
    }]);

    expect(calculateCommissionLedgerEntries([fixedGeneral, percentageSurgery], allocations)).toEqual([
      expect.objectContaining({ treatmentId: 'treatment-1', calculationMode: 'flat_visit', earnings: 12_000 }),
      expect.objectContaining({ treatmentId: 'treatment-2', calculationMode: 'percentage', earnings: 50_000 })
    ]);
  });

  it('preserves a percentage snapshot after the doctor changes to fixed mode', () => {
    const treatments = [treatment({ commissionType: 'fixed', commissionPerVisit: 25_000, commissionPercentage: 20 })];
    const allocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-1', patientId: 'patient-1', date: '2026-07-01', commissionableAmount: 100_000,
      treatmentIds: ['treatment-1']
    }]);

    expect(calculateCommissionLedgerEntries(treatments, allocations, [{
      paymentId: 'payment-1', treatmentId: 'treatment-1', calculationMode: 'percentage', commissionRate: 10
    }])[0]).toMatchObject({ calculationMode: 'percentage', commissionRate: 10, earnings: 10_000 });
  });

  it('preserves an existing flat snapshot but uses percentage for a new payment after the mode changes', () => {
    const treatments = [treatment({ cost: 200_000, commissionType: 'percentage', commissionPercentage: 20 })];
    const allocations = allocateCommissionablePayments(treatments, [
      { id: 'payment-1', patientId: 'patient-1', date: '2026-07-01', commissionableAmount: 100_000, treatmentIds: ['treatment-1'] },
      { id: 'payment-2', patientId: 'patient-1', date: '2026-07-02', commissionableAmount: 100_000, treatmentIds: ['treatment-1'] }
    ]);

    expect(calculateCommissionLedgerEntries(treatments, allocations, [{
      paymentId: 'payment-1', treatmentId: 'treatment-1', calculationMode: 'flat_visit', commissionRate: 15_000,
      visitKey: 'doctor-1|patient-1|2026-06-15'
    }])).toEqual([
      expect.objectContaining({ paymentId: 'payment-1', calculationMode: 'flat_visit', commissionRate: 15_000, earnings: 15_000 }),
      expect.objectContaining({ paymentId: 'payment-2', calculationMode: 'percentage', commissionRate: 20, earnings: 20_000 })
    ]);
  });

  it('recalculates a corrected payment amount without changing the snapshotted rate', () => {
    const treatments = [treatment({ commissionPercentage: 25 })];
    const correctedAllocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-1',
      patientId: 'patient-1',
      date: '2026-07-01',
      commissionableAmount: 100_000,
      treatmentIds: ['treatment-1']
    }]);
    const entries = calculateCommissionLedgerEntries(treatments, correctedAllocations, [{
      paymentId: 'payment-1',
      treatmentId: 'treatment-1',
      calculationMode: 'percentage',
      commissionRate: 10
    }]);

    expect(entries[0]).toMatchObject({ commissionRate: 10, earnings: 10_000 });
  });

  it('preserves the flat visit snapshot if correction moves the earning to another payment', () => {
    const treatments = [treatment({ specialization: 'Surgery', commissionPerVisit: 25_000 })];
    const allocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-2',
      patientId: 'patient-1',
      date: '2026-07-02',
      commissionableAmount: 100_000,
      treatmentIds: ['treatment-1']
    }]);
    const entries = calculateCommissionLedgerEntries(treatments, allocations, [{
      paymentId: 'payment-1',
      treatmentId: 'treatment-1',
      calculationMode: 'flat_visit',
      commissionRate: 15_000,
      visitKey: 'doctor-1|patient-1|2026-06-15'
    }]);

    expect(entries[0]).toMatchObject({ paymentId: 'payment-2', commissionRate: 15_000, earnings: 15_000 });
  });
});
