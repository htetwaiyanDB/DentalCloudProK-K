import { describe, expect, it } from 'vitest';
import type { ClinicalRecord, Patient, PaymentRecord } from '../types';
import {
  buildLegacyPaymentReceiptSnapshot,
  buildPaymentReceiptSnapshot,
  getReceiptTreatmentAllocationAmount,
  getUncapturedMedicineSalesForReceipt,
  mergeTreatmentRecordsById,
  normalizePaymentReceiptSnapshot,
  removePatientTreatmentRecords,
  removeTreatmentRecordById
} from './paymentReceipt';

describe('paymentReceipt', () => {
  const clinic = {
    appName: 'My Dentist',
    receiptHeaderTitle: 'Official Payment Receipt',
    receiptInfo: {
      email: 'clinic@example.com',
      phone: '09-123456789'
    },
    currency: 'MMK' as const
  };

  it('builds an immutable payment receipt snapshot from payment facts', () => {
    const patient: Patient = {
      id: 'patient-1',
      location_id: 'branch-1',
      name: 'Aye Aye',
      email: 'aye@example.com',
      phone: '091111111',
      balance: 15000,
      loyalty_points: 0,
      patient_unique_id: 'P-1001'
    };

    expect(
      buildPaymentReceiptSnapshot({
        patient,
        amountPaid: 5000,
        paymentMethod: 'CASH',
        paymentDate: '2026-06-19',
        receiptNumber: 'REC-20260619-000001',
        balanceBefore: 20000,
        balanceAfter: 15000,
        paymentStatus: 'PARTIAL',
        createdAt: '2026-06-19T08:30:00Z',
        recordedByUserName: 'Nurse May',
        treatments: [
          {
            id: 'tr-1',
            location_id: 'branch-1',
            patient_id: 'patient-1',
            teeth: [11],
            description: 'Composite Filling',
            cost: 12000,
            standardCost: 15000,
            discountAmount: 3000,
            pricingNote: 'DISCOUNT',
            date: '2026-06-19'
          }
        ],
        medicines: [
          {
            id: 'med-sale-1',
            location_id: 'branch-1',
            patient_id: 'patient-1',
            medicine_id: 'med-1',
            medicine_name: 'Pain Killer',
            quantity: 2,
            unit_price: 1500,
            total_price: 3000,
            date: '2026-06-19'
          }
        ],
        clinic
      })
    ).toEqual({
      version: 1,
      receiptType: 'PAYMENT',
      receiptNumber: 'REC-20260619-000001',
      receiptDate: '2026-06-19',
      createdAt: '2026-06-19T08:30:00Z',
      currency: 'MMK',
      clinic: {
        appName: 'My Dentist',
        headerTitle: 'Official Payment Receipt',
        email: 'clinic@example.com',
        phone: '09-123456789'
      },
      patient: {
        id: 'patient-1',
        name: 'Aye Aye',
        email: 'aye@example.com',
        phone: '091111111',
        patientUniqueId: 'P-1001'
      },
      payment: {
        amountPaid: 5000,
        method: 'CASH',
        status: 'PARTIAL',
        balanceBefore: 20000,
        balanceAfter: 15000,
        serviceFeeAmount: 0,
        serviceFeeCategory: null,
        recordedByUserName: 'Nurse May'
      },
      treatments: [
        {
          id: 'tr-1',
          date: '2026-06-19',
          description: 'Composite Filling',
          teeth: [11],
          finalCost: 12000,
          standardCost: 15000,
          discountAmount: 3000,
          pricingNote: 'DISCOUNT'
        }
      ],
      medicines: [
        {
          id: 'med-sale-1',
          date: '2026-06-19',
          medicineName: 'Pain Killer',
          quantity: 2,
          unitPrice: 1500,
          totalPrice: 3000,
          standardTotal: 3000,
          discountAmount: 0,
          pricingNote: null
        }
      ]
    });
  });

  it('keeps separately saved treatments and replaces duplicates by treatment ID', () => {
    const record = (id: string, cost: number): ClinicalRecord => ({
      id, location_id: 'branch-1', patient_id: 'patient-1', teeth: [], description: id, cost, date: '2026-08-04'
    });

    expect(mergeTreatmentRecordsById(
      [record('treatment-a', 100_000)],
      [record('treatment-b', 200_000), record('treatment-a', 110_000)]
    ).map(({ id, cost }) => ({ id, cost }))).toEqual([
      { id: 'treatment-a', cost: 110_000 },
      { id: 'treatment-b', cost: 200_000 }
    ]);
  });

  it('removes an undone treatment from the pending payment batch', () => {
    const records = [
      { id: 'undone', location_id: 'branch-1', patient_id: 'patient-a', teeth: [], description: 'Old crown', cost: 100, date: '2026-08-13' },
      { id: 'replacement', location_id: 'branch-1', patient_id: 'patient-a', teeth: [], description: 'New crown', cost: 100, date: '2026-08-13' }
    ] as ClinicalRecord[];

    expect(removeTreatmentRecordById(records, 'undone').map((record) => record.id)).toEqual(['replacement']);
  });

  it('clears only the patient whose payment succeeded', () => {
    const records = [
      { id: 'a', location_id: 'branch-1', patient_id: 'patient-a', teeth: [], description: 'A', cost: 100, date: '2026-08-04' },
      { id: 'b', location_id: 'branch-1', patient_id: 'patient-b', teeth: [], description: 'B', cost: 200, date: '2026-08-04' }
    ] as ClinicalRecord[];

    expect(removePatientTreatmentRecords(records, 'patient-a').map((record) => record.id)).toEqual(['b']);
  });

  it('does not capture the same medicine sale on a later same-day receipt', () => {
    const sale = { id: 'medicine-1', location_id: 'branch-1', patient_id: 'patient-1', medicine_id: 'm1', medicine_name: 'Medicine', quantity: 1, unit_price: 80, total_price: 80, date: '2026-08-04' };
    const priorPayment = {
      id: 'payment-1', patientId: 'patient-1', amount: 80, date: '2026-08-04', type: 'FULL' as const, remainingBalance: 0,
      receiptSnapshot: buildPaymentReceiptSnapshot({
        patient: { id: 'patient-1', location_id: 'branch-1', name: 'Patient', email: '', phone: '', balance: 0, loyalty_points: 0 },
        amountPaid: 80, paymentMethod: 'CASH', paymentDate: '2026-08-04', receiptNumber: 'REC-1', balanceBefore: 80, balanceAfter: 0,
        paymentStatus: 'FULL', medicines: [sale], clinic
      })
    };

    expect(getUncapturedMedicineSalesForReceipt([sale], [priorPayment], 'patient-1', [], '2026-08-04')).toEqual([]);
  });

  it('preserves discounted and FOC medicine pricing in immutable snapshots', () => {
    const snapshot = buildPaymentReceiptSnapshot({
      patient: { id: 'patient-1', location_id: 'branch-1', name: 'Patient', email: '', phone: '', balance: 0, loyalty_points: 0 },
      amountPaid: 8000, paymentMethod: 'CASH', paymentDate: '2026-08-04', receiptNumber: 'REC-DISCOUNT',
      balanceBefore: 8000, balanceAfter: 0, paymentStatus: 'FULL', clinic,
      medicines: [
        { id: 'discounted', location_id: 'branch-1', patient_id: 'patient-1', medicine_id: 'm1', medicine_name: 'Medicine', quantity: 2, unit_price: 5000, total_price: 8000, standard_total: 10000, discount_amount: 2000, pricing_note: 'DISCOUNT', date: '2026-08-04' },
        { id: 'foc', location_id: 'branch-1', patient_id: 'patient-1', medicine_id: 'm2', medicine_name: 'Gift Item', quantity: 1, unit_price: 1000, total_price: 0, standard_total: 1000, discount_amount: 1000, pricing_note: 'FOC', date: '2026-08-04' }
      ]
    });

    expect(snapshot.medicines).toEqual([
      { id: 'discounted', date: '2026-08-04', medicineName: 'Medicine', quantity: 2, unitPrice: 5000, totalPrice: 8000, standardTotal: 10000, discountAmount: 2000, pricingNote: 'DISCOUNT' },
      { id: 'foc', date: '2026-08-04', medicineName: 'Gift Item', quantity: 1, unitPrice: 1000, totalPrice: 0, standardTotal: 1000, discountAmount: 1000, pricingNote: 'FOC' }
    ]);
    expect(normalizePaymentReceiptSnapshot(snapshot)).toEqual(snapshot);
  });

  it('allocates only treatment money after medicine and service fee', () => {
    const snapshot = buildPaymentReceiptSnapshot({
      patient: { id: 'patient-1', location_id: 'branch-1', name: 'Patient', email: '', phone: '', balance: 0, loyalty_points: 0 },
      amountPaid: 397_000,
      paymentMethod: 'CASH',
      paymentDate: '2026-08-04',
      receiptNumber: 'PENDING',
      balanceBefore: 397_000,
      balanceAfter: 0,
      paymentStatus: 'FULL',
      serviceFeeAmount: 10_000,
      treatments: [
        { id: 'treatment-a', location_id: 'branch-1', patient_id: 'patient-1', teeth: [], description: 'A', cost: 100_000, date: '2026-08-04' },
        { id: 'treatment-b', location_id: 'branch-1', patient_id: 'patient-1', teeth: [], description: 'B', cost: 200_000, date: '2026-08-04' }
      ],
      medicines: [{ id: 'medicine-1', location_id: 'branch-1', patient_id: 'patient-1', medicine_id: 'm1', medicine_name: 'Medicine', quantity: 1, unit_price: 87_000, total_price: 87_000, date: '2026-08-04' }],
      clinic
    });

    expect(snapshot.allocationReconciled).toBe(true);
    expect(getReceiptTreatmentAllocationAmount(397_000, snapshot)).toBe(300_000);
  });

  it('deducts service fee and medicine before treatment on a partial mixed payment', () => {
    const snapshot = buildPaymentReceiptSnapshot({
      patient: { id: 'patient-1', location_id: 'branch-1', name: 'Patient', email: '', phone: '', balance: 100, loyalty_points: 0 },
      amountPaid: 100, paymentMethod: 'CASH', paymentDate: '2026-08-04', receiptNumber: 'REC-PARTIAL', balanceBefore: 200,
      balanceAfter: 100, paymentStatus: 'PARTIAL', serviceFeeAmount: 20,
      treatments: [{ id: 'treatment-1', location_id: 'branch-1', patient_id: 'patient-1', teeth: [], description: 'Treatment', cost: 100, date: '2026-08-04' }],
      medicines: [{ id: 'medicine-1', location_id: 'branch-1', patient_id: 'patient-1', medicine_id: 'm1', medicine_name: 'Medicine', quantity: 1, unit_price: 80, total_price: 80, date: '2026-08-04' }],
      clinic
    });

    expect(snapshot.allocationReconciled).toBeUndefined();
    expect(getReceiptTreatmentAllocationAmount(100, snapshot)).toBe(0);
  });

  it('builds a safe legacy payment receipt snapshot when stored snapshot is unavailable', () => {
    const payment: PaymentRecord = {
      id: 'payment-1',
      patientId: 'patient-1',
      patient_name: 'Aye Aye',
      amount: 8000,
      date: '2026-06-19',
      type: 'FULL',
      balanceBefore: 8000,
      remainingBalance: 0,
      paymentMethod: 'KPAY',
      receiptNumber: 'REC-20260619-000002',
      createdByUserName: 'Nurse Hla'
    };

    expect(buildLegacyPaymentReceiptSnapshot(payment, clinic).payment).toEqual({
      amountPaid: 8000,
      method: 'KPAY',
      status: 'FULL',
      balanceBefore: 8000,
      balanceAfter: 0,
      serviceFeeAmount: 0,
      serviceFeeCategory: null,
      recordedByUserName: 'Nurse Hla'
    });
  });

  it('normalizes persisted receipt snapshot JSON', () => {
    expect(
      normalizePaymentReceiptSnapshot({
        version: 1,
        receiptType: 'PAYMENT',
        receiptNumber: 'REC-20260619-000003',
        receiptDate: '2026-06-19',
        currency: 'MMK',
        clinic: {
          appName: ' My Dentist ',
          headerTitle: ' Receipt ',
          email: ' clinic@example.com ',
          phone: ' 09-222222 '
        },
        patient: {
          id: 'patient-2',
          name: '  Ko Ko  '
        },
        payment: {
          amountPaid: '12000',
          method: 'cash',
          status: 'PARTIAL',
          balanceBefore: '20000',
          balanceAfter: 8000
        },
        treatments: [
          {
            id: 'tr-2',
            date: '2026-06-19',
            description: 'Extraction',
            teeth: [21],
            finalCost: 10000,
            standardCost: 10000,
            discountAmount: 0
          }
        ],
        medicines: [
          {
            id: 'med-sale-2',
            date: '2026-06-19',
            medicineName: 'Antibiotic',
            quantity: '3',
            unitPrice: 2000,
            totalPrice: '6000'
          }
        ]
      })
    ).toEqual({
      version: 1,
      receiptType: 'PAYMENT',
      receiptNumber: 'REC-20260619-000003',
      receiptDate: '2026-06-19',
      createdAt: null,
      currency: 'MMK',
      clinic: {
        appName: 'My Dentist',
        headerTitle: 'Receipt',
        email: 'clinic@example.com',
        phone: '09-222222'
      },
      patient: {
        id: 'patient-2',
        name: 'Ko Ko',
        email: '',
        phone: '',
        patientUniqueId: ''
      },
      payment: {
        amountPaid: 12000,
        method: 'CASH',
        status: 'PARTIAL',
        balanceBefore: 20000,
        balanceAfter: 8000,
        serviceFeeAmount: 0,
        serviceFeeCategory: null,
        recordedByUserName: null
      },
      treatments: [
        {
          id: 'tr-2',
          date: '2026-06-19',
          description: 'Extraction',
          teeth: [21],
          finalCost: 10000,
          standardCost: 10000,
          discountAmount: 0,
          pricingNote: null
        }
      ],
      medicines: [
        {
          id: 'med-sale-2',
          date: '2026-06-19',
          medicineName: 'Antibiotic',
          quantity: 3,
          unitPrice: 2000,
          totalPrice: 6000,
          standardTotal: 6000,
          discountAmount: 0,
          pricingNote: null
        }
      ]
    });
  });

  it('stores and normalizes a version 2 split-payment breakdown', () => {
    const patient: Patient = {
      id: 'patient-split', location_id: 'branch-1', name: 'Split Patient', email: '', phone: '', balance: 0, loyalty_points: 0
    };
    const snapshot = buildPaymentReceiptSnapshot({
      patient,
      amountPaid: 10000,
      paymentMethod: 'MIXED',
      allocations: [{ method: 'CASH', amount: 4000 }, { method: 'KPAY', amount: 6000 }],
      paymentDate: '2026-07-18',
      receiptNumber: 'REC-SPLIT-1',
      balanceBefore: 10000,
      balanceAfter: 0,
      paymentStatus: 'FULL',
      clinic
    });
    expect(snapshot.version).toBe(2);
    expect(snapshot.payment.method).toBe('MIXED');
    expect(snapshot.payment.allocations).toEqual([{ method: 'CASH', amount: 4000 }, { method: 'KPAY', amount: 6000 }]);
    expect(normalizePaymentReceiptSnapshot(snapshot)).toEqual(snapshot);
  });
});
