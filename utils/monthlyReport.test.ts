import { describe, expect, it } from 'vitest';
import type { PaymentRecord, TreatmentCostSummary } from '../types';
import { buildMonthlyReport, chunkMonthlyReportPatientIds, groupMonthlyReportDetailRows, MONTHLY_REPORT_PATIENT_BATCH_SIZE, monthlyReportFilename, type MonthlyReportSourceRecord } from './monthlyReport';

const record = (overrides: Partial<MonthlyReportSourceRecord> = {}): MonthlyReportSourceRecord => ({
  id: 'treatment-1', location_id: 'location-1', patient_id: 'patient-1', patient_name: 'Aye Aye',
  patient_age: 35, patient_phone: '0912345', patient_city: 'Yangon', patient_township: 'Bahan', patient_type: 'Walk-in',
  doctor_name: 'Doctor One', teeth: [], description: 'Crown', cost: 100, doctorEarnings: 20, date: '2026-07-10',
  ...overrides
});

const payment = (overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: 'payment-1', patientId: 'patient-1', amount: 60, clearedAmount: 60, treatmentIds: ['treatment-1'],
  date: '2026-07-10', type: 'PARTIAL', remainingBalance: 40, ...overrides
});

const costs = (overrides: Partial<TreatmentCostSummary> = {}): TreatmentCostSummary => ({
  auditLogId: 'audit-1', materialTotal: 10, materialItemCount: 1, labTotal: 5, labItemCount: 1,
  specialDoctorTotal: 0, specialDoctorItemCount: 0, assignedSpecialDoctorTotal: 0, assignedSpecialDoctorItemCount: 0,
  totalAmount: 15, itemCount: 2, ...overrides
});

describe('monthly report', () => {
  it('treats an empty dated ledger as authoritative while retaining legacy behavior when absent', () => {
    const data = { records: [record()], payments: [payment()], costSummaries: { 'treatment-1': costs() },
      paymentCostSummaries: { 'payment-1': costs() } };
    expect(buildMonthlyReport(data).summary.mlsTotal).toBe(30);
    expect(buildMonthlyReport({ ...data, costItems: [] }).summary).toMatchObject({ mlsTotal: 0, totalCost: 20, netProfit: 80 });
  });

  it('includes both range boundaries and all cost categories without repeating same-treatment revenue', () => {
    const base = { patientId: 'patient-1', patientName: 'Aye Aye', treatmentLabel: 'Crown', treatmentDate: '2026-07-10',
      doctorName: 'Doctor One', patientType: 'Walk-in', sourceType: 'treatment' as const, sourceId: 'treatment-1' };
    const report = buildMonthlyReport({ records: [record()], payments: [], costSummaries: {},
      dateFrom: '2026-07-01', dateTo: '2026-07-31', costItems: [
        { ...base, id: 'm', expenseDate: '2026-07-01', costType: 'material', amount: 10 },
        { ...base, id: 'l', expenseDate: '2026-07-31', costType: 'lab', amount: 20 },
        { ...base, id: 's', expenseDate: '2026-07-15', costType: 'special_doctor', amount: 30 },
        { ...base, id: 'old', expenseDate: '2026-06-30', costType: 'lab', amount: 999 }
      ] });
    expect(report.summary).toMatchObject({ treatmentCount: 1, production: 100, materialCost: 10, labCost: 20,
      specialDoctorCost: 30, mlsTotal: 60, totalCost: 80, netProfit: 20, netMargin: 0.2 });
    expect(report.byTreatment).toEqual([expect.objectContaining({ name: 'Crown', treatments: 1, patients: 1,
      totalRevenue: 100, mlsTotal: 60, totalCost: 80, netProfit: 20, netMargin: 0.2 })]);
  });

  it('uses dated MLS independently of treatment production and legacy summaries', () => {
    const item = { id: 'cost-1', expenseDate: '2026-07-01', costType: 'lab' as const, amount: 30,
      patientId: 'old-patient', patientName: 'Old Patient', treatmentLabel: 'Old Crown', treatmentDate: '2026-06-10',
      doctorName: 'Old Doctor', patientType: 'Referral', sourceType: 'payment' as const, sourceId: 'old-payment' };
    const report = buildMonthlyReport({ records: [record()], payments: [payment()],
      costSummaries: { 'treatment-1': costs() }, paymentCostSummaries: { 'payment-1': costs() },
      dateFrom: '2026-07-01', dateTo: '2026-07-31',
      costItems: [item, { ...item, id: 'outside', expenseDate: '2026-08-01', amount: 999 }] });
    expect(report.costItems).toEqual([item]);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ mlsTotal: 0, totalRevenue: 100, totalCost: 20 });
    expect(report.summary).toMatchObject({ treatmentCount: 1, patientCount: 1, production: 100, payment: 60,
      labCost: 30, materialCost: 0, mlsTotal: 30, totalCost: 50, netProfit: 50 });
    for (const groups of [report.byTreatment, report.byDoctor, report.byPatientType]) {
      expect(groups.reduce((sum, group) => sum + group.mlsTotal, 0)).toBe(30);
      expect(groups.reduce((sum, group) => sum + group.treatments, 0)).toBe(1);
      expect(groups.find(group => group.mlsTotal === 30)).toMatchObject({ treatments: 0, patients: 0, totalRevenue: 0, netProfit: -30 });
    }
  });

  it('deduplicates and limits patient batches to production-safe request sizes', () => {
    const ids = [...Array.from({ length: 45 }, (_, index) => `patient-${index}`), 'patient-0', ''];
    const batches = chunkMonthlyReportPatientIds(ids);
    expect(batches.map(batch => batch.length)).toEqual([20, 20, 5]);
    expect(Math.max(...batches.map(batch => batch.length))).toBe(MONTHLY_REPORT_PATIENT_BATCH_SIZE);
    expect(batches.flat()).toHaveLength(45);
  });

  it('calculates payment, treatment balance, total cost, and production-based net profit', () => {
    const report = buildMonthlyReport({ records: [record()], payments: [payment()], costSummaries: { 'treatment-1': costs({ specialDoctorTotal: 15, specialDoctorItemCount: 1, totalAmount: 30, itemCount: 3 }) } });
    expect(report.rows[0]).toMatchObject({ city: 'Yangon', township: 'Bahan', cost: 100, payment: 60, balance: 40, materialCost: 10, labCost: 5, specialDoctorCost: 15, doctorCost: 20, totalCost: 50, netProfit: 50, netMargin: 0.5 });
    expect(report.summary).toMatchObject({ treatmentCount: 1, patientCount: 1, production: 100, payment: 60, balance: 40, specialDoctorCost: 15, totalCost: 50, netProfit: 50, collectionRate: 0.6 });
  });

  it('includes discounts, service charges, medicine sales, MLS totals, and operating expenses', () => {
    const report = buildMonthlyReport({
      records: [record({ standardCost: 120, discountAmount: 20 })],
      payments: [payment()],
      costSummaries: { 'treatment-1': costs({ specialDoctorTotal: 15, specialDoctorItemCount: 1, totalAmount: 30, itemCount: 3 }) },
      appointments: [{
        id: 'appointment-1', location_id: 'location-1', patient_id: 'patient-1', date: '2026-07-10', time: '09:00',
        type: 'Checkup', status: 'Completed', clinical_fee_status: 'APPLIED', clinical_fee_amount: 10
      }],
      medicineSales: [{
        id: 'sale-1', location_id: 'location-1', patient_id: 'patient-1', medicine_id: 'medicine-1', quantity: 1,
        unit_price: 30, total_price: 30, date: '2026-07-10', treatment_id: 'treatment-1'
      }],
      expenses: [{ id: 'expense-1', location_id: 'location-1', description: 'Rent', category: 'Rent', amount: 20, date: '2026-07-10' }]
    });

    expect(report.rows[0]).toMatchObject({
      standardCost: 120, discount: 20, serviceCharges: 10, medicineSales: 30, totalRevenue: 140,
      mlsTotal: 30, totalCost: 50, netProfit: 90
    });
    expect(report.summary).toMatchObject({
      standardProduction: 120, discount: 20, serviceCharges: 10, medicineSales: 30, totalRevenue: 140,
      mlsTotal: 30, operatingExpenses: 20, totalCost: 70, netProfit: 70, netMargin: 0.5
    });
    expect(report.byDoctor[0]).toMatchObject({ mlsTotal: 30, totalRevenue: 140 });
    expect(report.expenses).toHaveLength(1);
  });

  it('includes a manual service fee stored in the payment receipt snapshot', () => {
    const manualFeePayment = payment({
      receiptSnapshot: {
        version: 1,
        receiptType: 'PAYMENT',
        receiptNumber: 'REC-001',
        receiptDate: '2026-07-10',
        currency: 'MMK',
        createdAt: '2026-07-10T10:00:00.000Z',
        patient: { id: 'patient-1', patientUniqueId: 'P-001', name: 'Aye Aye', phone: '0912345' },
        payment: {
          amountPaid: 70,
          method: 'CASH',
          status: 'FULL',
          balanceBefore: 70,
          balanceAfter: 0,
          serviceFeeAmount: 10,
          serviceFeeCategory: 'RETURNING'
        },
        treatments: [],
        medicines: [],
        clinic: { appName: 'DentalCloudPro', headerTitle: '', email: '', phone: '' }
      }
    });
    const report = buildMonthlyReport({
      records: [record()],
      payments: [manualFeePayment, { ...manualFeePayment, id: 'payment-retry' }],
      costSummaries: {},
      appointments: [{
        id: 'appointment-1', location_id: 'location-1', patient_id: 'patient-1', date: '2026-07-10', time: '09:00',
        type: 'Checkup', status: 'Completed', clinical_fee_status: 'APPLIED', clinical_fee_amount: 5
      }]
    });

    expect(report.rows[0]).toMatchObject({ serviceCharges: 10, totalRevenue: 110 });
    expect(report.summary.serviceCharges).toBe(10);
  });

  it('keeps an unlinked manual service fee visible in performance groups', () => {
    const manualFeePayment = payment({
      treatmentIds: [],
      date: '2026-07-11',
      receiptSnapshot: {
        version: 1,
        receiptType: 'PAYMENT',
        receiptNumber: 'REC-SERVICE-ONLY',
        receiptDate: '2026-07-11',
        currency: 'MMK',
        patient: { id: 'patient-1', name: 'Aye Aye' },
        payment: {
          amountPaid: 10,
          method: 'CASH',
          status: 'FULL',
          balanceBefore: 10,
          balanceAfter: 0,
          serviceFeeAmount: 10,
          serviceFeeCategory: 'RETURNING'
        },
        treatments: [],
        medicines: [],
        clinic: { appName: 'DentalCloudPro', headerTitle: '', email: '', phone: '' }
      }
    });
    const report = buildMonthlyReport({
      records: [record()],
      payments: [manualFeePayment],
      costSummaries: {},
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31'
    });

    expect(report.summary.serviceCharges).toBe(10);
    expect(report.byTreatment).toContainEqual(expect.objectContaining({
      name: 'Service fee only / No treatment',
      serviceCharges: 10,
      totalRevenue: 10,
      netProfit: 10
    }));
    expect(report.byTreatment.reduce((sum, group) => sum + group.serviceCharges, 0)).toBe(10);
  });

  it('allocates a shared payment proportionally and never overpays a treatment', () => {
    const report = buildMonthlyReport({
      records: [record(), record({ id: 'treatment-2', cost: 300, description: 'Implant' })],
      payments: [payment({ amount: 200, clearedAmount: 200, treatmentIds: ['treatment-1', 'treatment-2'] })],
      costSummaries: {}
    });
    expect(report.rows.map(row => row.payment)).toEqual([50, 150]);
    expect(report.summary.balance).toBe(200);
  });

  it('excludes voided collections and their service fees', () => {
    const voidedPayment = payment({
      amount: 100,
      clearedAmount: 100,
      treatmentIds: ['treatment-1'],
      voidedAt: '2026-07-12T10:00:00Z',
      receiptSnapshot: {
        version: 1,
        receiptType: 'PAYMENT',
        receiptNumber: 'VOID-1',
        receiptDate: '2026-07-10',
        currency: 'MMK',
        clinic: { appName: 'Clinic', headerTitle: 'Receipt', email: '', phone: '' },
        patient: { id: 'patient-1', name: 'Aye Aye' },
        payment: { amountPaid: 100, method: 'CASH', status: 'FULL', balanceBefore: 100, balanceAfter: 0, serviceFeeAmount: 10 },
        treatments: [],
        medicines: []
      }
    });
    const report = buildMonthlyReport({ records: [record()], payments: [voidedPayment], costSummaries: {} });

    expect(report.summary.payment).toBe(0);
    expect(report.summary.serviceCharges).toBe(0);
  });

  it('uses the authoritative current patient balance once instead of duplicating it per treatment', () => {
    const report = buildMonthlyReport({
      records: [
        record({ patient_balance: 75 }),
        record({ id: 'treatment-2', date: '2026-07-11', patient_balance: 75 })
      ],
      payments: [payment({ amount: 200, clearedAmount: 200, treatmentIds: ['treatment-1', 'treatment-2'] })],
      costSummaries: {}
    });

    expect(report.rows.map((row) => row.balance)).toEqual([0, 75]);
    expect(report.summary.balance).toBe(75);
  });

  it('loads payment-linked MLS costs and allocates every category across linked treatments', () => {
    const report = buildMonthlyReport({
      records: [record(), record({ id: 'treatment-2', cost: 300, description: 'Implant' })],
      payments: [payment({ amount: 400, clearedAmount: 400, treatmentIds: ['treatment-1', 'treatment-2'] })],
      costSummaries: {},
      paymentCostSummaries: {
        'payment-1': costs({
          materialTotal: 40,
          labTotal: 20,
          specialDoctorTotal: 20,
          totalAmount: 80,
          itemCount: 3
        })
      }
    });

    expect(report.rows[0]).toMatchObject({ materialCost: 10, labCost: 5, specialDoctorCost: 5, mlsTotal: 20 });
    expect(report.rows[1]).toMatchObject({ materialCost: 30, labCost: 15, specialDoctorCost: 15, mlsTotal: 60 });
    expect(report.summary).toMatchObject({ materialCost: 40, labCost: 20, specialDoctorCost: 20, mlsTotal: 80 });
  });

  it('deduplicates repeated payments and supports legacy oldest-balance allocation', () => {
    const shared = payment({ treatmentIds: [], date: '2026-07-12' });
    const report = buildMonthlyReport({ records: [record()], payments: [shared, { ...shared }], costSummaries: {} });
    expect(report.rows[0].payment).toBe(60);
  });

  it('does not reassign explicitly linked payments outside the report scope', () => {
    const report = buildMonthlyReport({
      records: [record()],
      payments: [payment({ treatmentIds: ['treatment-outside-report'] })],
      costSummaries: {}
    });

    expect(report.rows[0].payment).toBe(0);
  });

  it('reports losses and normalizes missing demographic data', () => {
    const report = buildMonthlyReport({
      records: [record({ patient_age: null, patient_phone: '', patient_city: '', patient_township: '', patient_type: null, doctor_name: '', doctorEarnings: 120 })],
      payments: [], costSummaries: {},
    });
    expect(report.rows[0]).toMatchObject({ age: null, phone: 'Not recorded', city: 'Not recorded', township: 'Not recorded', patientType: 'Not assigned', doctor: 'Unassigned', netProfit: -20 });
  });

  it('uses the report-scoped doctor earning supplied by the loader', () => {
    const report = buildMonthlyReport({ records: [record({ doctorEarnings: 12.5 })], payments: [], costSummaries: {} });
    expect(report.rows[0]).toMatchObject({ doctorCost: 12.5, totalCost: 12.5, netProfit: 87.5 });
  });

  it('builds ranked analysis groups and safe filenames', () => {
    const report = buildMonthlyReport({ records: [record(), record({ id: 'treatment-2', patient_id: 'patient-2', cost: 200 })], payments: [], costSummaries: {} });
    expect(report.byTreatment[0]).toMatchObject({ name: 'Crown', treatments: 2, patients: 2, production: 300 });
    expect(monthlyReportFilename({ dateFrom: '2026-07-01', dateTo: '2026-07-31', locationName: 'Yangon / Main', currency: 'MMK' }, 'xlsx'))
      .toBe('monthly-report-2026-07-01-to-2026-07-31-yangon-main.xlsx');
  });

  it('groups same-patient same-day treatment details without changing financial totals', () => {
    const report = buildMonthlyReport({
      records: [
        record(),
        record({ id: 'treatment-2', description: 'Filling', doctor_name: 'Doctor Two', cost: 200, doctorEarnings: 30 }),
        record({ id: 'treatment-3', description: 'Crown', cost: 50, doctorEarnings: 5 }),
        record({ id: 'treatment-4', description: 'Scaling', doctor_name: 'Doctor Two', cost: 150, doctorEarnings: 10 })
      ],
      payments: [payment({ amount: 250, clearedAmount: 250, treatmentIds: ['treatment-1', 'treatment-2', 'treatment-3', 'treatment-4'] })],
      costSummaries: {
        'treatment-1': costs(),
        'treatment-2': costs({ materialTotal: 20, labTotal: 0, totalAmount: 20 }),
        'treatment-3': costs({ materialTotal: 0, labTotal: 25, totalAmount: 25 }),
        'treatment-4': costs({ materialTotal: 5, labTotal: 0, totalAmount: 5 })
      }
    });

    const grouped = groupMonthlyReportDetailRows(report.rows);

    expect(report.rows).toHaveLength(4);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      treatmentIds: ['treatment-1', 'treatment-2', 'treatment-3', 'treatment-4'],
      treatmentCount: 4,
      treatment: 'Crown ×2; Filling; Scaling',
      doctor: 'Doctor One; Doctor Two',
      cost: 500,
      payment: 250,
      balance: 250,
      materialCost: 35,
      labCost: 30,
      doctorCost: 65,
      totalCost: 130,
      netProfit: 370,
      netMargin: 0.74
    });
    expect(grouped[0].cost).toBe(report.summary.production);
    expect(grouped[0].payment).toBe(report.summary.payment);
    expect(grouped[0].balance).toBe(report.summary.balance);
    expect(grouped[0].totalCost).toBe(report.summary.totalCost);
    expect(grouped[0].netProfit).toBe(report.summary.netProfit);
  });

  it('separates different patients with the same name and the same patient on different days', () => {
    const rows = buildMonthlyReport({
      records: [
        record(),
        record({ id: 'treatment-2', patient_id: 'patient-2', patient_name: 'Aye Aye' }),
        record({ id: 'treatment-3', date: '2026-07-11' })
      ],
      payments: [],
      costSummaries: {}
    }).rows;

    expect(groupMonthlyReportDetailRows(rows)).toHaveLength(3);
  });

  it('never merges rows with missing identity or malformed dates', () => {
    const rows = buildMonthlyReport({
      records: [
        record({ id: 'treatment-1', patient_id: '', date: '' }),
        record({ id: 'treatment-2', patient_id: 'patient-1', date: '2026-02-30' })
      ],
      payments: [],
      costSummaries: {}
    }).rows;

    expect(groupMonthlyReportDetailRows(rows).map(row => row.treatmentIds)).toEqual([
      ['treatment-1'],
      ['treatment-2']
    ]);
  });

  it('produces stable grouped labels and identifiers regardless of input order', () => {
    const rows = buildMonthlyReport({
      records: [
        record({ id: 'treatment-b', description: 'Filling', doctor_name: 'Doctor Two' }),
        record({ id: 'treatment-a', description: 'Crown', doctor_name: 'Doctor One' })
      ],
      payments: [],
      costSummaries: {}
    }).rows;

    expect(groupMonthlyReportDetailRows([...rows].reverse())[0]).toMatchObject({
      treatmentIds: ['treatment-a', 'treatment-b'],
      treatment: 'Crown; Filling',
      doctor: 'Doctor One; Doctor Two'
    });
  });
});
