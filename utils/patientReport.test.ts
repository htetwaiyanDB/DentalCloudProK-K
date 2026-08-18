import { describe, expect, it } from 'vitest';
import type { Appointment, ClinicalRecord, MedicineSale, Patient, PaymentRecord } from '../types';
import { buildPatientReport } from './patientReport';

const patient: Patient = {
  id: 'patient-1', location_id: 'location-1', name: 'Mya Mya', email: '', phone: '091234', balance: 250, loyalty_points: 0
};
const appointment = (overrides: Partial<Appointment>): Appointment => ({
  id: 'appointment-1', location_id: 'location-1', patient_id: patient.id, date: '2026-07-10', time: '09:00',
  type: 'Checkup', status: 'Completed', doctor_id: 'doctor-1', doctor_name: 'Aung', ...overrides
});
const treatment = (overrides: Partial<ClinicalRecord>): ClinicalRecord => ({
  id: 'treatment-1', location_id: 'location-1', patient_id: patient.id, doctor_id: 'doctor-1', doctor_name: 'Aung',
  treatment_type_id: null, teeth: [11], description: 'Filling', cost: 1000, date: '2026-07-10', ...overrides
});
const medicine = (overrides: Partial<MedicineSale>): MedicineSale => ({
  id: 'medicine-sale-1', location_id: 'location-1', patient_id: patient.id, medicine_id: 'medicine-1',
  medicine_name: 'Amoxicillin', medicine_unit: 'capsules', quantity: 2, unit_price: 100, total_price: 200,
  date: '2026-07-11', ...overrides
});
const payment = (overrides: Partial<PaymentRecord>): PaymentRecord => ({
  id: 'payment-1', location_id: 'location-1', patientId: patient.id, amount: 500, date: '2026-07-11',
  type: 'PARTIAL', remainingBalance: 700, ...overrides
});

describe('buildPatientReport', () => {
  it('counts unique care dates as visits and excludes scheduled or cancelled-only dates', () => {
    const report = buildPatientReport({
      patient,
      appointments: [
        appointment({ id: 'complete', date: '2026-07-10' }),
        appointment({ id: 'scheduled', date: '2026-07-20', status: 'Scheduled' }),
        appointment({ id: 'cancelled', date: '2026-07-21', status: 'Cancelled' })
      ],
      treatments: [treatment({ date: '2026-07-10' })],
      medicineSales: [medicine({ date: '2026-07-11' })],
      payments: [], doctors: [], currency: 'USD'
    });

    expect(report.visitDates).toEqual(['2026-07-11', '2026-07-10']);
    expect(report.firstVisitDate).toBe('2026-07-10');
    expect(report.lastVisitDate).toBe('2026-07-11');
    expect(report.appointmentStatus).toEqual([
      { name: 'Completed', value: 1 }, { name: 'Scheduled', value: 1 }, { name: 'Cancelled', value: 1 }
    ]);
  });

  it('separates paid money, care value, applied service fees, and current debt', () => {
    const report = buildPatientReport({
      patient,
      appointments: [appointment({ clinical_fee_status: 'APPLIED', clinical_fee_amount: 50 })],
      treatments: [treatment({ cost: 1000 })], medicineSales: [medicine({ total_price: 200 })],
      payments: [payment({ amount: 500 }), payment({ id: 'payment-2', amount: 300 })], doctors: [], currency: 'USD'
    });

    expect(report.totalPaid).toBe(800);
    expect(report.treatmentValue).toBe(1000);
    expect(report.medicineValue).toBe(200);
    expect(report.serviceFeeValue).toBe(50);
    expect(report.careValue).toBe(1250);
    expect(report.currentDebt).toBe(250);
  });

  it('does not present restricted payment history as zero', () => {
    const report = buildPatientReport({
      patient, appointments: [], treatments: [treatment({})], medicineSales: [], payments: [payment({})], doctors: [], currency: 'MMK', paymentsAvailable: false
    });
    expect(report.totalPaid).toBeNull();
    expect(report.paymentHistory).toBeNull();
    expect(report.treatmentLedger).toEqual([expect.objectContaining({ amount: 1000, paid: null, balance: null, payments: [] })]);
  });

  it('shows treatment amounts, linked payment details, and remaining balances', () => {
    const report = buildPatientReport({
      patient, appointments: [],
      treatments: [treatment({ id: 'treatment-1', cost: 1000 }), treatment({ id: 'treatment-2', cost: 500 })],
      medicineSales: [],
      payments: [
        payment({ id: 'payment-1', date: '2026-07-11', amount: 600, clearedAmount: 600, treatmentIds: ['treatment-1', 'treatment-2'], paymentMethod: 'CASH', receiptNumber: 'REC-1' }),
        payment({ id: 'payment-2', date: '2026-07-12', amount: 400, clearedAmount: 400, treatmentIds: ['treatment-1'], paymentMethod: 'KPAY', receiptNumber: 'REC-2' })
      ], doctors: [], currency: 'USD'
    });

    expect(report.treatmentLedger).toEqual([
      expect.objectContaining({ id: 'treatment-2', amount: 500, paid: 200, balance: 300 }),
      expect.objectContaining({ id: 'treatment-1', amount: 1000, paid: 800, balance: 200 })
    ]);
    expect(report.treatmentLedger[1].payments).toEqual([
      expect.objectContaining({ id: 'payment-2', date: '2026-07-12', amount: 400, paymentMethod: 'KPAY', receiptNumber: 'REC-2' }),
      expect.objectContaining({ id: 'payment-1', date: '2026-07-11', amount: 400, paymentMethod: 'CASH', receiptNumber: 'REC-1' })
    ]);
  });

  it('uses receipt treatment links, falls back to same-date legacy links, and caps overpayment at the fee', () => {
    const report = buildPatientReport({
      patient, appointments: [], treatments: [treatment({ id: 'receipt-linked', cost: 100, date: '2026-07-10' })], medicineSales: [],
      payments: [
        payment({ id: 'legacy', amount: 80, date: '2026-07-10', treatmentIds: [] }),
        payment({
          id: 'snapshot', amount: 80, date: '2026-07-11', treatmentIds: [],
          receiptSnapshot: {
            version: 1, receiptType: 'PAYMENT', receiptNumber: 'SNAP-1', receiptDate: '2026-07-11', currency: 'USD',
            clinic: { appName: 'Clinic', headerTitle: 'Receipt', email: '', phone: '' },
            patient: { id: patient.id, name: patient.name },
            payment: { amountPaid: 80, method: 'CASH', status: 'PARTIAL', balanceBefore: 100, balanceAfter: 20 },
            treatments: [{ id: 'receipt-linked', date: '2026-07-10', description: 'Filling', teeth: [11], finalCost: 100, standardCost: 100, discountAmount: 0 }]
          }
        })
      ], doctors: [], currency: 'USD'
    });

    expect(report.treatmentLedger[0]).toMatchObject({ paid: 100, balance: 0 });
    expect(report.treatmentLedger[0].payments.reduce((sum, item) => sum + item.amount, 0)).toBe(100);
    expect(report.paymentHistory?.map((item) => item.id)).toEqual(['snapshot', 'legacy']);
  });

  it('deducts service fee and medicine before treatment on a partial mixed receipt', () => {
    const report = buildPatientReport({
      patient, appointments: [], treatments: [treatment({ id: 'mixed-treatment', cost: 100 })], medicineSales: [],
      payments: [payment({
        id: 'mixed-payment', amount: 100, clearedAmount: 100, treatmentIds: ['mixed-treatment'],
        receiptSnapshot: {
          version: 1, receiptType: 'PAYMENT', receiptNumber: 'MIXED-1', receiptDate: '2026-07-11', currency: 'USD',
          clinic: { appName: 'Clinic', headerTitle: 'Receipt', email: '', phone: '' },
          patient: { id: patient.id, name: patient.name },
          payment: { amountPaid: 100, method: 'CASH', status: 'PARTIAL', balanceBefore: 200, balanceAfter: 100, serviceFeeAmount: 20 },
          treatments: [{ id: 'mixed-treatment', date: '2026-07-10', description: 'Filling', teeth: [11], finalCost: 100, standardCost: 100, discountAmount: 0 }],
          medicines: [{ id: 'medicine-1', date: '2026-07-10', medicineName: 'Medicine', quantity: 1, unitPrice: 80, totalPrice: 80 }]
        }
      })], doctors: [], currency: 'USD'
    });

    expect(report.treatmentLedger[0]).toMatchObject({ paid: 0, balance: 100 });
  });

  it('allocates later partial payments against remaining treatment amounts and deduplicates payment records', () => {
    const sharedPayment = payment({ id: 'shared', amount: 150, clearedAmount: 150, treatmentIds: ['treatment-1', 'treatment-2'] });
    const report = buildPatientReport({
      patient, appointments: [],
      treatments: [treatment({ id: 'treatment-1', cost: 100 }), treatment({ id: 'treatment-2', cost: 100 })], medicineSales: [],
      payments: [
        sharedPayment,
        { ...sharedPayment },
        payment({ id: 'final', amount: 100, clearedAmount: 100, date: '2026-07-12', treatmentIds: ['treatment-1', 'treatment-2'] })
      ], doctors: [], currency: 'USD'
    });

    expect(report.paymentHistory).toHaveLength(2);
    expect(report.totalPaid).toBe(250);
    expect(report.treatmentLedger.map((item) => ({ paid: item.paid, balance: item.balance }))).toEqual([
      { paid: 100, balance: 0 }, { paid: 100, balance: 0 }
    ]);
    expect(report.treatmentLedger.flatMap((item) => item.payments).reduce((sum, item) => sum + item.amount, 0)).toBe(200);
  });

  it('keeps minor-unit rounding consistent across attributed payment details', () => {
    const report = buildPatientReport({
      patient, appointments: [],
      treatments: [
        treatment({ id: 'treatment-1', cost: 1 }),
        treatment({ id: 'treatment-2', cost: 1 }),
        treatment({ id: 'treatment-3', cost: 1 })
      ], medicineSales: [],
      payments: [payment({ amount: 1, clearedAmount: 1, treatmentIds: ['treatment-1', 'treatment-2', 'treatment-3'] })],
      doctors: [], currency: 'USD'
    });

    const details = report.treatmentLedger.flatMap((item) => item.payments);
    expect(details.map((item) => item.amount)).toEqual([0.34, 0.33, 0.33]);
    expect(details.reduce((sum, item) => sum + item.amount, 0)).toBe(1);
  });

  it('does not attribute hidden receipt treatment value to a visible treatment', () => {
    const report = buildPatientReport({
      patient, appointments: [], treatments: [treatment({ id: 'visible', cost: 100 })], medicineSales: [],
      payments: [payment({
        amount: 200, clearedAmount: 200, treatmentIds: ['visible', 'hidden'],
        receiptSnapshot: {
          version: 1, receiptType: 'PAYMENT', receiptNumber: 'SCOPED-1', receiptDate: '2026-07-11', currency: 'USD',
          clinic: { appName: 'Clinic', headerTitle: 'Receipt', email: '', phone: '' }, patient: { id: patient.id, name: patient.name },
          payment: { amountPaid: 200, method: 'CASH', status: 'FULL', balanceBefore: 200, balanceAfter: 0 },
          treatments: [
            { id: 'visible', date: '2026-07-10', description: 'Visible', teeth: [11], finalCost: 100, standardCost: 100, discountAmount: 0 },
            { id: 'hidden', date: '2026-07-10', description: 'Hidden', teeth: [12], finalCost: 100, standardCost: 100, discountAmount: 0 }
          ]
        }
      })], doctors: [], currency: 'USD'
    });

    expect(report.treatmentLedger[0]).toMatchObject({ paid: 100, balance: 0 });
  });

  it('filters other patients and aggregates repeated treatments, medicines, and doctor activity', () => {
    const report = buildPatientReport({
      patient,
      appointments: [appointment({}), appointment({ id: 'other-appointment', patient_id: 'patient-2' })],
      treatments: [treatment({}), treatment({ id: 'treatment-2', description: 'filling', date: '2026-07-12', cost: 500 })],
      medicineSales: [medicine({}), medicine({ id: 'sale-2', quantity: 1, total_price: 100, date: '2026-07-12' })],
      payments: [payment({}), payment({ id: 'other-payment', patientId: 'patient-2', amount: 999 })],
      doctors: [], currency: 'USD'
    });

    expect(report.treatments).toEqual([{ name: 'Filling', count: 2, total: 1500, dates: ['2026-07-12', '2026-07-10'] }]);
    expect(report.medicines).toEqual([{ id: 'medicine-1', name: 'Amoxicillin', unit: 'capsules', quantity: 3, total: 300, dates: ['2026-07-12', '2026-07-11'] }]);
    expect(report.doctors[0]).toMatchObject({ name: 'Aung', appointmentCount: 1, treatmentCount: 2 });
    expect(report.totalPaid).toBe(500);
    expect(report.timeline).toHaveLength(5);
  });
});
