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
  commissionType: 'percentage',
  commissionPercentage: 10,
  materialCost: 0,
  ...overrides
});

describe('doctor commission ledger', () => {
  it('calculates the clinic-rule commission from a mixed partial payment', () => {
    const treatments = [treatment({ cost: 6_130_000, materialCost: 20_000, commissionPercentage: 40 })];
    const allocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-1', patientId: 'patient-1', date: '2026-07-01',
      commissionableAmount: 3_130_000, treatmentIds: ['treatment-1']
    }]);

    expect(allocations).toEqual([expect.objectContaining({ amount: 3_130_000 })]);
    expect(calculateCommissionLedgerEntries(treatments, allocations)[0]).toMatchObject({
      materialDeduction: 20_000, commissionBase: 3_110_000, commissionRate: 40, earnings: 1_244_000
    });
  });

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

  it('does not reassign a payment when its explicit treatment is unavailable', () => {
    const allocations = allocateCommissionablePayments([
      treatment({ id: 'visible-treatment', cost: 100_000 })
    ], [{
      id: 'payment-1',
      patientId: 'patient-1',
      date: '2026-07-01',
      commissionableAmount: 100_000,
      treatmentIds: ['treatment-outside-current-scope']
    }]);

    expect(allocations).toEqual([]);
  });

  it('does not over-allocate the visible part of a partially unavailable explicit payment', () => {
    const allocations = allocateCommissionablePayments([
      treatment({ id: 'visible-treatment', cost: 100_000 })
    ], [{
      id: 'payment-1',
      patientId: 'patient-1',
      date: '2026-07-01',
      commissionableAmount: 100_000,
      treatmentIds: ['visible-treatment', 'treatment-outside-current-scope']
    }]);

    expect(allocations).toEqual([]);
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

  it('deducts material cost once and distributes the base across partial payments', () => {
    const treatments = [treatment({ cost: 300_000, materialCost: 50_000 })];
    const allocations = allocateCommissionablePayments(treatments, [
      { id: 'p1', patientId: 'patient-1', date: '2026-07-01', commissionableAmount: 30_000, treatmentIds: ['treatment-1'] },
      { id: 'p2', patientId: 'patient-1', date: '2026-07-02', commissionableAmount: 100_000, treatmentIds: ['treatment-1'] }
    ]);
    const entries = calculateCommissionLedgerEntries(treatments, allocations);

    expect(entries).toEqual([
      expect.objectContaining({
        paymentId: 'p1',
        materialDeduction: 11_538.46,
        commissionBase: 18_461.54,
        earnings: 1_846.15
      }),
      expect.objectContaining({
        paymentId: 'p2',
        materialDeduction: 38_461.54,
        commissionBase: 61_538.46,
        earnings: 6_153.85
      })
    ]);
    expect(entries.reduce((sum, entry) => sum + entry.materialDeduction, 0)).toBe(50_000);
    expect(entries.reduce((sum, entry) => sum + entry.earnings, 0)).toBe(8_000);
  });

  it('falls back to zero instead of producing non-finite commission values', () => {
    const treatments = [treatment({ commissionPercentage: Number.NaN })];
    const allocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-1',
      patientId: 'patient-1',
      date: '2026-07-01',
      commissionableAmount: 100_000,
      treatmentIds: ['treatment-1']
    }]);

    expect(calculateCommissionLedgerEntries(treatments, allocations)[0]).toMatchObject({
      commissionRate: 0,
      commissionBase: 100_000,
      earnings: 0
    });
  });

  it('caps percentage rates at the database-supported maximum', () => {
    const treatments = [treatment({ commissionPercentage: 150 })];
    const allocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-1',
      patientId: 'patient-1',
      date: '2026-07-01',
      commissionableAmount: 100_000,
      treatmentIds: ['treatment-1']
    }]);

    expect(calculateCommissionLedgerEntries(treatments, allocations)[0]).toMatchObject({
      commissionRate: 100,
      earnings: 100_000
    });
  });

  it('pays 85,080 Ks from a 240,000 Ks payment after 27,300 Ks material and lab cost at 40%', () => {
    const treatments = [treatment({
      cost: 240_000,
      materialCost: 27_300,
      commissionPercentage: 40
    })];
    const allocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-1',
      patientId: 'patient-1',
      date: '2026-07-01',
      commissionableAmount: 240_000,
      treatmentIds: ['treatment-1']
    }]);

    expect(calculateCommissionLedgerEntries(treatments, allocations)[0]).toMatchObject({
      amount: 240_000,
      materialDeduction: 27_300,
      commissionBase: 212_700,
      commissionRate: 40,
      earnings: 85_080
    });
  });

  it('pools material costs once across treatments in a same-rate visit', () => {
    const treatments = [
      treatment({ id: 't1', cost: 100_000, materialCost: 80_000 }),
      treatment({ id: 't2', cost: 100_000, materialCost: 0 })
    ];
    const allocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-1',
      patientId: 'patient-1',
      date: '2026-07-01',
      commissionableAmount: 200_000,
      treatmentIds: ['t1', 't2']
    }]);
    const entries = calculateCommissionLedgerEntries(treatments, allocations);

    expect(entries.reduce((sum, entry) => sum + entry.commissionBase, 0)).toBe(120_000);
    expect(entries.reduce((sum, entry) => sum + entry.earnings, 0)).toBe(12_000);
    expect(entries).toEqual([
      expect.objectContaining({ treatmentId: 't1', commissionBase: 60_000, earnings: 6_000 }),
      expect.objectContaining({ treatmentId: 't2', commissionBase: 60_000, earnings: 6_000 })
    ]);
  });

  it('keeps material deductions treatment-specific when visit rates differ', () => {
    const treatments = [
      treatment({ id: 't1', cost: 100_000, materialCost: 80_000, commissionPercentage: 10 }),
      treatment({ id: 't2', cost: 100_000, materialCost: 0, commissionPercentage: 20 })
    ];
    const allocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-1',
      patientId: 'patient-1',
      date: '2026-07-01',
      commissionableAmount: 200_000,
      treatmentIds: ['t1', 't2']
    }]);

    expect(calculateCommissionLedgerEntries(treatments, allocations)).toEqual([
      expect.objectContaining({ treatmentId: 't1', commissionBase: 20_000, earnings: 2_000 }),
      expect.objectContaining({ treatmentId: 't2', commissionBase: 100_000, earnings: 20_000 })
    ]);
  });

  it('assigns rounding residue to the final same-rate visit entry', () => {
    const treatments = [
      treatment({ id: 't1', cost: 1, commissionPercentage: 10 }),
      treatment({ id: 't2', cost: 1, commissionPercentage: 10 }),
      treatment({ id: 't3', cost: 1, commissionPercentage: 10 })
    ];
    const allocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-1', patientId: 'patient-1', date: '2026-07-01',
      commissionableAmount: 3, treatmentIds: ['t1', 't2', 't3']
    }]);
    const entries = calculateCommissionLedgerEntries(treatments, allocations);

    expect(Math.round(entries.reduce((sum, entry) => sum + entry.earnings, 0) * 100) / 100).toBe(0.3);
    expect(entries.map((entry) => entry.earnings)).toEqual([0.1, 0.1, 0.1]);
  });

  it('pays flat commission only once for multiple treatment rows in one visit', () => {
    const treatments = [
      treatment({ id: 't1', specialization: 'General', commissionType: 'flat_visit', commissionPerVisit: 15_000, cost: 100_000 }),
      treatment({ id: 't2', specialization: 'General', commissionType: 'flat_visit', commissionPerVisit: 15_000, cost: 100_000 })
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
    const treatments = [treatment({ specialization: 'General', commissionType: 'flat_visit', commissionPerVisit: 25_000 })];
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

  it('keeps an existing percentage visit in percentage mode after the doctor switches to fixed', () => {
    const treatments = [treatment({
      commissionType: 'flat_visit',
      commissionPercentage: 25,
      commissionPerVisit: 30_000,
      materialCost: 20_000
    })];
    const allocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-1',
      patientId: 'patient-1',
      date: '2026-07-01',
      commissionableAmount: 100_000,
      treatmentIds: ['treatment-1']
    }]);

    const entries = calculateCommissionLedgerEntries(treatments, allocations, [{
      paymentId: 'payment-1',
      treatmentId: 'treatment-1',
      calculationMode: 'percentage',
      commissionRate: 10,
      visitKey: 'doctor-1|patient-1|2026-06-15'
    }]);

    expect(entries[0]).toMatchObject({
      calculationMode: 'percentage',
      commissionRate: 10,
      commissionBase: 80_000,
      earnings: 8_000
    });
  });

  it('keeps an existing fixed visit in fixed mode after the doctor switches to percentage', () => {
    const treatments = [treatment({
      commissionType: 'percentage',
      commissionPercentage: 25,
      commissionPerVisit: 30_000
    })];
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

    expect(entries[0]).toMatchObject({
      calculationMode: 'flat_visit',
      commissionRate: 15_000,
      earnings: 15_000
    });
  });

  it('preserves a percentage snapshot when a correction moves it to another payment', () => {
    const treatments = [treatment({ commissionPercentage: 25 })];
    const allocations = allocateCommissionablePayments(treatments, [{
      id: 'payment-2', patientId: 'patient-1', date: '2026-07-02',
      commissionableAmount: 100_000, treatmentIds: ['treatment-1']
    }]);
    const entries = calculateCommissionLedgerEntries(treatments, allocations, [{
      paymentId: 'payment-1', treatmentId: 'treatment-1', calculationMode: 'percentage',
      commissionRate: 10, visitKey: 'doctor-1|patient-1|2026-06-15'
    }]);

    expect(entries[0]).toMatchObject({
      paymentId: 'payment-2', calculationMode: 'percentage', commissionRate: 10, earnings: 10_000
    });
  });

  it('rejects conflicting historical modes for one visit', () => {
    expect(() => calculateCommissionLedgerEntries([treatment()], [], [
      { paymentId: 'p1', treatmentId: 't1', calculationMode: 'percentage', commissionRate: 10, visitKey: 'visit-1' },
      { paymentId: 'p2', treatmentId: 't2', calculationMode: 'flat_visit', commissionRate: 10_000, visitKey: 'visit-1' }
    ])).toThrow('Conflicting historical commission modes for visit visit-1.');
  });
});
