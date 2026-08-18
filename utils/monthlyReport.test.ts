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
  totalAmount: 15, itemCount: 2, ...overrides
});

describe('monthly report', () => {
  it('deduplicates and limits patient batches to production-safe request sizes', () => {
    const ids = [...Array.from({ length: 45 }, (_, index) => `patient-${index}`), 'patient-0', ''];
    const batches = chunkMonthlyReportPatientIds(ids);
    expect(batches.map(batch => batch.length)).toEqual([20, 20, 5]);
    expect(Math.max(...batches.map(batch => batch.length))).toBe(MONTHLY_REPORT_PATIENT_BATCH_SIZE);
    expect(batches.flat()).toHaveLength(45);
  });

  it('calculates payment, treatment balance, total cost, and production-based net profit', () => {
    const report = buildMonthlyReport({ records: [record()], payments: [payment()], costSummaries: { 'treatment-1': costs() } });
    expect(report.rows[0]).toMatchObject({ city: 'Yangon', township: 'Bahan', cost: 100, payment: 60, balance: 40, materialCost: 10, labCost: 5, doctorCost: 20, totalCost: 35, netProfit: 65, netMargin: 0.65 });
    expect(report.summary).toMatchObject({ treatmentCount: 1, patientCount: 1, production: 100, payment: 60, balance: 40, totalCost: 35, netProfit: 65, collectionRate: 0.6 });
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
