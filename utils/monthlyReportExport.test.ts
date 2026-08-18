import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx-js-style';
import type { MonthlyReport, MonthlyReportMetadata } from './monthlyReport';
import { buildMonthlyReportExcelWorkbook } from './monthlyReportExport';

const metadata: MonthlyReportMetadata = {
  dateFrom: '2026-07-01',
  dateTo: '2026-07-31',
  locationName: 'Yangon Main',
  currency: 'MMK',
  generatedAt: new Date('2026-08-01T09:30:00Z')
};

const report: MonthlyReport = {
  rows: [{
    treatmentId: 'treatment-1', date: '2026-07-10', patientId: 'patient-1', patientName: 'Aye Aye', age: 35,
    phone: '0912345', city: 'Yangon', township: 'Bahan', patientType: 'Walk-in', treatment: 'Crown', doctor: 'Doctor One',
    cost: 100000, payment: 60000, balance: 40000, materialCost: 10000, labCost: 5000, doctorCost: 20000,
    totalCost: 35000, netProfit: 65000, netMargin: 0.65
  }],
  summary: {
    treatmentCount: 1, patientCount: 1, production: 100000, payment: 60000, balance: 40000,
    materialCost: 10000, labCost: 5000, doctorCost: 20000, totalCost: 35000, netProfit: 65000,
    netMargin: 0.65, collectionRate: 0.6
  },
  byTreatment: [{ name: 'Crown', treatments: 1, patients: 1, production: 100000, payment: 60000, totalCost: 35000, netProfit: 65000, netMargin: 0.65 }],
  byDoctor: [{ name: 'Doctor One', treatments: 1, patients: 1, production: 100000, payment: 60000, totalCost: 35000, netProfit: 65000, netMargin: 0.65 }],
  byPatientType: [{ name: 'Walk-in', treatments: 1, patients: 1, production: 100000, payment: 60000, totalCost: 35000, netProfit: 65000, netMargin: 0.65 }]
};

describe('monthly report Excel workbook', () => {
  it('builds a structured, readable workbook with professional report sections', async () => {
    const workbook = await buildMonthlyReportExcelWorkbook(report, metadata);

    expect(workbook.SheetNames).toEqual([
      'Executive Summary', 'Treatment Detail', 'By Treatment', 'By Clinician', 'By Patient Type'
    ]);

    const summary = workbook.Sheets['Executive Summary'];
    expect(summary.A1.v).toBe('MONTHLY TREATMENT & PROFITABILITY REPORT');
    expect(summary.A5.v).toBe('REPORT VOLUME');
    expect(summary.D5.v).toBe('REVENUE & COLLECTIONS');
    expect(summary.G5.v).toBe('COSTS & PROFITABILITY');
    expect(summary.E6.z).toBe('#,##0" Ks"');
    expect(summary.E9.z).toBe('0.0%');
    expect(summary.H11.z).toBe('0.0%');
    expect(summary.A1.s).toMatchObject({
      fill: { patternType: 'solid', fgColor: { rgb: '0F172A' } },
      font: { bold: true, color: { rgb: 'FFFFFF' } }
    });
    expect(summary.A5.s).toMatchObject({
      fill: { patternType: 'solid', fgColor: { rgb: '4F46E5' } },
      border: { bottom: { style: 'medium' } }
    });
    expect(summary.H10.s).toMatchObject({
      fill: { patternType: 'solid', fgColor: { rgb: 'DCFCE7' } },
      font: { color: { rgb: '166534' } }
    });
    expect(summary['!merges']).toHaveLength(8);
    expect(summary['!freeze']).toMatchObject({ ySplit: 4, topLeftCell: 'A5' });

    const detail = workbook.Sheets['Treatment Detail'];
    expect(detail.A4.v).toBe('Treatment Date');
    expect(detail.B4.v).toBe('Patient Name');
    expect(detail.F4.v).toBe('Township');
    expect(detail.F5.v).toBe('Bahan');
    expect(detail.J4.v).toBe('Treatment Production');
    expect(detail.A6.v).toBe('REPORT TOTAL');
    expect(detail.J5.z).toBe('#,##0" Ks"');
    expect(detail.R5.z).toBe('0.0%');
    expect(detail.A4.s).toMatchObject({
      fill: { patternType: 'solid', fgColor: { rgb: '4F46E5' } },
      border: { left: { style: 'medium' } }
    });
    expect(detail.A5.s).toMatchObject({ border: { bottom: { style: 'thin' } } });
    expect(detail.Q5.s).toMatchObject({ fill: { fgColor: { rgb: 'DCFCE7' } } });
    expect(detail.B6.s).toMatchObject({
      fill: { patternType: 'solid', fgColor: { rgb: 'E2E8F0' } },
      border: { top: { style: 'medium' }, bottom: { style: 'medium' } }
    });
    expect(detail.A6.s).toMatchObject({
      fill: { patternType: 'solid', fgColor: { rgb: 'E2E8F0' } },
      border: { top: { style: 'medium' } }
    });
    expect(detail['!autofilter']).toEqual({ ref: 'A4:R5' });
    expect(detail['!freeze']).toMatchObject({ ySplit: 4, topLeftCell: 'A5' });
    expect(detail['!cols'][7].wch).toBe(32);

    const clinician = workbook.Sheets['By Clinician'];
    expect(clinician.A1.v).toBe('CLINICIAN PERFORMANCE');
    expect(clinician.A4.v).toBe('Clinician');
    expect(clinician.A6.v).toBe('REPORT TOTAL');
  });

  it('preserves report labels and numeric formats in the written XLSX file', async () => {
    const workbook = await buildMonthlyReportExcelWorkbook(report, metadata);
    const file = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true, cellStyles: true });
    const reopened = XLSX.read(file, { type: 'buffer', cellNF: true, cellStyles: true });
    const detail = reopened.Sheets['Treatment Detail'];

    expect(detail.B5.v).toBe('Aye Aye');
    expect(detail.F5.v).toBe('Bahan');
    expect(detail.J5.v).toBe(100000);
    expect(detail.J5.z).toBe('#,##0" Ks"');
    expect(detail.R5.v).toBe(0.65);
    expect(detail.R5.z).toBe('0.0%');
    expect(detail.A4.s?.fgColor?.rgb).toBe('4F46E5');
    expect(detail.Q5.s?.fgColor?.rgb).toBe('DCFCE7');
    expect(detail.A6.v).toBe('REPORT TOTAL');
    expect(reopened.Props?.Title).toBe('Monthly Treatment & Profitability Report');

    const uncompressed = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: false, cellStyles: true });
    const openXml = uncompressed.toString('utf8');
    expect(openXml).toContain('<borders count=');
    expect(openXml).toContain('style="medium"');
    expect(openXml).toContain('4F46E5');
    expect(openXml).toContain('CBD5E1');
  });

  it('keeps empty reporting periods structured and filterable', async () => {
    const emptyReport: MonthlyReport = {
      rows: [],
      summary: {
        treatmentCount: 0, patientCount: 0, production: 0, payment: 0, balance: 0, materialCost: 0,
        labCost: 0, doctorCost: 0, totalCost: 0, netProfit: 0, netMargin: 0, collectionRate: 0
      },
      byTreatment: [],
      byDoctor: [],
      byPatientType: []
    };
    const workbook = await buildMonthlyReportExcelWorkbook(emptyReport, metadata);
    const detail = workbook.Sheets['Treatment Detail'];

    expect(detail.A4.v).toBe('Treatment Date');
    expect(detail.A5.v).toBe('REPORT TOTAL');
    expect(detail.J5.v).toBe(0);
    expect(detail.J5.z).toBe('#,##0" Ks"');
    expect(detail['!autofilter']).toEqual({ ref: 'A4:R4' });
  });

  it('uses an explicit loss treatment without changing the underlying numeric value', async () => {
    const lossReport: MonthlyReport = {
      ...report,
      rows: [{ ...report.rows[0], netProfit: -5000, netMargin: -0.05 }],
      summary: { ...report.summary, netProfit: -5000, netMargin: -0.05 },
      byTreatment: [{ ...report.byTreatment[0], netProfit: -5000, netMargin: -0.05 }],
      byDoctor: [{ ...report.byDoctor[0], netProfit: -5000, netMargin: -0.05 }],
      byPatientType: [{ ...report.byPatientType[0], netProfit: -5000, netMargin: -0.05 }]
    };
    const workbook = await buildMonthlyReportExcelWorkbook(lossReport, metadata);
    const detail = workbook.Sheets['Treatment Detail'];

    expect(detail.Q5.v).toBe(-5000);
    expect(detail.Q5.s).toMatchObject({
      fill: { patternType: 'solid', fgColor: { rgb: 'FEE2E2' } },
      font: { color: { rgb: 'B91C1C' } }
    });
    expect(workbook.Sheets['Executive Summary'].H10.s?.fill?.fgColor?.rgb).toBe('FEE2E2');
  });

  it('exports same-patient same-day treatments as one detail row without changing treatment analysis', async () => {
    const groupedReport: MonthlyReport = {
      ...report,
      rows: [
        report.rows[0],
        { ...report.rows[0], treatmentId: 'treatment-2', treatment: 'Filling', doctor: 'Doctor Two', cost: 50000, payment: 30000, balance: 20000, materialCost: 5000, labCost: 0, doctorCost: 10000, totalCost: 15000, netProfit: 35000, netMargin: 0.7 },
        { ...report.rows[0], treatmentId: 'treatment-3', treatment: 'Crown', cost: 25000, payment: 10000, balance: 15000, materialCost: 0, labCost: 5000, doctorCost: 5000, totalCost: 10000, netProfit: 15000, netMargin: 0.6 },
        { ...report.rows[0], treatmentId: 'treatment-4', treatment: 'Scaling', doctor: 'Doctor Two', cost: 25000, payment: 0, balance: 25000, materialCost: 0, labCost: 0, doctorCost: 5000, totalCost: 5000, netProfit: 20000, netMargin: 0.8 }
      ],
      summary: {
        treatmentCount: 4, patientCount: 1, production: 200000, payment: 100000, balance: 100000,
        materialCost: 15000, labCost: 10000, doctorCost: 40000, totalCost: 65000, netProfit: 135000,
        netMargin: 0.675, collectionRate: 0.5
      },
      byTreatment: [
        { name: 'Crown', treatments: 2, patients: 1, production: 125000, payment: 70000, totalCost: 45000, netProfit: 80000, netMargin: 0.64 },
        { name: 'Filling', treatments: 1, patients: 1, production: 50000, payment: 30000, totalCost: 15000, netProfit: 35000, netMargin: 0.7 },
        { name: 'Scaling', treatments: 1, patients: 1, production: 25000, payment: 0, totalCost: 5000, netProfit: 20000, netMargin: 0.8 }
      ]
    };

    const workbook = await buildMonthlyReportExcelWorkbook(groupedReport, metadata);
    const detail = workbook.Sheets['Treatment Detail'];
    const byTreatment = workbook.Sheets['By Treatment'];

    expect(detail.H5.v).toBe('Crown ×2; Filling; Scaling');
    expect(detail.I5.v).toBe('Doctor One; Doctor Two');
    expect(detail.J5.v).toBe(200000);
    expect(detail.Q5.v).toBe(135000);
    expect(detail.R5.v).toBe(0.675);
    expect(detail.A6.v).toBe('REPORT TOTAL');
    expect(detail['!autofilter']).toEqual({ ref: 'A4:R5' });
    expect(byTreatment.A5.v).toBe('Crown');
    expect(byTreatment.B5.v).toBe(2);
    expect(byTreatment.A8.v).toBe('REPORT TOTAL');
  });
});
