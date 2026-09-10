import type { ClinicalRecord, PaymentRecord, TreatmentCostSummary } from '../types';
import type { Currency } from './currency';
import { allocateCommissionablePayments } from './doctorCommissionLedger';
import {
  dedupePaymentRecords,
  getPaymentTreatmentIds,
  getPaymentTreatmentShare
} from './paymentTreatmentAllocation';
import { chunkUniqueIds, REPORT_URL_BATCH_SIZE } from './reportBatching';

export interface MonthlyReportSourceRecord extends ClinicalRecord {
  patient_age?: number | null;
  patient_phone?: string | null;
  patient_city?: string | null;
  patient_township?: string | null;
}

export interface MonthlyReportData {
  records: MonthlyReportSourceRecord[];
  allocationRecords?: MonthlyReportSourceRecord[];
  payments: PaymentRecord[];
  costSummaries: Record<string, TreatmentCostSummary>;
}

export interface MonthlyReportRow {
  treatmentId: string;
  date: string;
  patientId: string;
  patientName: string;
  age: number | null;
  phone: string;
  city: string;
  township: string;
  patientType: string;
  treatment: string;
  doctor: string;
  cost: number;
  payment: number;
  balance: number;
  labCost: number;
  materialCost: number;
  specialDoctorCost: number;
  doctorCost: number;
  totalCost: number;
  netProfit: number;
  netMargin: number;
}

export interface MonthlyReportDetailRow extends MonthlyReportRow {
  treatmentIds: string[];
  treatmentCount: number;
}

export interface MonthlyReportSummary {
  treatmentCount: number;
  patientCount: number;
  production: number;
  payment: number;
  balance: number;
  labCost: number;
  materialCost: number;
  specialDoctorCost: number;
  doctorCost: number;
  totalCost: number;
  netProfit: number;
  netMargin: number;
  collectionRate: number;
}

export interface MonthlyReportGroup {
  name: string;
  treatments: number;
  patients: number;
  production: number;
  payment: number;
  totalCost: number;
  netProfit: number;
  netMargin: number;
}

export interface MonthlyReport {
  rows: MonthlyReportRow[];
  summary: MonthlyReportSummary;
  byTreatment: MonthlyReportGroup[];
  byDoctor: MonthlyReportGroup[];
  byPatientType: MonthlyReportGroup[];
}

export interface MonthlyReportMetadata {
  dateFrom: string;
  dateTo: string;
  locationName: string;
  currency: Currency;
  generatedAt?: Date;
}

export interface MonthlyReportProgress {
  percent: number;
  label: string;
}

export type MonthlyReportProgressCallback = (progress: MonthlyReportProgress) => void;

// Keep PostgREST `in.(...)` URLs below production proxy limits. Larger UUID batches can
// be rejected by the gateway before CORS headers are added, which browsers report as a
// misleading CORS failure rather than an HTTP 414/502 response.
export const MONTHLY_REPORT_PATIENT_BATCH_SIZE = REPORT_URL_BATCH_SIZE;

export const chunkMonthlyReportPatientIds = (patientIds: string[]): string[][] => chunkUniqueIds(patientIds);

const money = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : 0;
};

const positiveMoney = (value: unknown): number => Math.max(0, money(value));

const combineLabels = (labels: string[]): string => {
  const counts = new Map<string, number>();
  labels.forEach(label => counts.set(label, (counts.get(label) || 0) + 1));
  return Array.from(counts, ([label, count]) => count > 1 ? `${label} ×${count}` : label).join('; ');
};

const combineDistinctLabels = (labels: string[]): string => Array.from(new Set(labels)).join('; ');

const isValidLocalDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export const groupMonthlyReportDetailRows = (rows: MonthlyReportRow[]): MonthlyReportDetailRow[] => {
  const groups = new Map<string, MonthlyReportRow[]>();

  rows.forEach((row, index) => {
    const hasPatientId = Boolean(row.patientId?.trim());
    const hasLocalDate = isValidLocalDate(row.date || '');
    const key = hasPatientId && hasLocalDate
      ? `${row.patientId.trim()}|${row.date}`
      : `treatment:${row.treatmentId || index}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  });

  return Array.from(groups.values()).map(group => {
    const sortedGroup = [...group].sort((a, b) => a.treatmentId.localeCompare(b.treatmentId));
    const first = sortedGroup[0];
    const sum = (selector: (row: MonthlyReportRow) => number) => money(sortedGroup.reduce((total, row) => total + selector(row), 0));
    const cost = sum(row => row.cost);
    const payment = sum(row => row.payment);
    const balance = sum(row => row.balance);
    const labCost = sum(row => row.labCost);
    const materialCost = sum(row => row.materialCost);
    const specialDoctorCost = sum(row => row.specialDoctorCost);
    const doctorCost = sum(row => row.doctorCost);
    const totalCost = sum(row => row.totalCost);
    const netProfit = sum(row => row.netProfit);

    return {
      ...first,
      treatmentId: sortedGroup.map(row => row.treatmentId).join('|'),
      treatmentIds: sortedGroup.map(row => row.treatmentId),
      treatmentCount: sortedGroup.length,
      treatment: combineLabels(sortedGroup.map(row => row.treatment)),
      doctor: combineDistinctLabels(sortedGroup.map(row => row.doctor)),
      cost,
      payment,
      balance,
      labCost,
      materialCost,
      specialDoctorCost,
      doctorCost,
      totalCost,
      netProfit,
      netMargin: cost > 0 ? netProfit / cost : 0
    };
  }).sort((a, b) => (
    a.date.localeCompare(b.date)
    || a.patientName.localeCompare(b.patientName)
    || a.patientId.localeCompare(b.patientId)
    || a.treatmentIds[0].localeCompare(b.treatmentIds[0])
  ));
};

const buildPaymentByTreatment = (records: MonthlyReportSourceRecord[], payments: PaymentRecord[]): Map<string, number> => {
  const uniquePayments = dedupePaymentRecords(payments);
  const allocations = allocateCommissionablePayments(
    records.map(record => ({
      id: record.id,
      patientId: record.patient_id,
      date: record.date,
      cost: positiveMoney(record.cost)
    })),
    uniquePayments.map(payment => ({
      id: payment.id,
      patientId: payment.patientId,
      date: payment.date,
      createdAt: payment.createdAt,
      commissionableAmount: getPaymentTreatmentShare(payment),
      treatmentIds: getPaymentTreatmentIds(payment)
    }))
  );

  return allocations.reduce((map, allocation) => {
    map.set(allocation.treatmentId, money((map.get(allocation.treatmentId) || 0) + allocation.amount));
    return map;
  }, new Map<string, number>());
};

const summarizeRows = (rows: MonthlyReportRow[]): MonthlyReportSummary => {
  const total = (selector: (row: MonthlyReportRow) => number) => money(rows.reduce((sum, row) => sum + selector(row), 0));
  const production = total(row => row.cost);
  const payment = total(row => row.payment);
  const netProfit = total(row => row.netProfit);
  return {
    treatmentCount: rows.length,
    patientCount: new Set(rows.map(row => row.patientId).filter(Boolean)).size,
    production,
    payment,
    balance: total(row => row.balance),
    labCost: total(row => row.labCost),
    materialCost: total(row => row.materialCost),
    specialDoctorCost: total(row => row.specialDoctorCost),
    doctorCost: total(row => row.doctorCost),
    totalCost: total(row => row.totalCost),
    netProfit,
    netMargin: production > 0 ? netProfit / production : 0,
    collectionRate: production > 0 ? payment / production : 0
  };
};

const groupRows = (rows: MonthlyReportRow[], key: (row: MonthlyReportRow) => string): MonthlyReportGroup[] => {
  const groups = new Map<string, MonthlyReportRow[]>();
  rows.forEach(row => {
    const name = key(row) || 'Not recorded';
    groups.set(name, [...(groups.get(name) || []), row]);
  });
  return Array.from(groups, ([name, group]) => {
    const summary = summarizeRows(group);
    return {
      name,
      treatments: summary.treatmentCount,
      patients: summary.patientCount,
      production: summary.production,
      payment: summary.payment,
      totalCost: summary.totalCost,
      netProfit: summary.netProfit,
      netMargin: summary.netMargin
    };
  }).sort((a, b) => b.production - a.production || a.name.localeCompare(b.name));
};

export const buildMonthlyReport = (data: MonthlyReportData): MonthlyReport => {
  const paymentByTreatment = buildPaymentByTreatment(data.allocationRecords || data.records, data.payments);
  const rows = data.records.map((record): MonthlyReportRow => {
    const cost = positiveMoney(record.cost);
    const payment = Math.min(cost, positiveMoney(paymentByTreatment.get(record.id)));
    const costs = data.costSummaries[record.id];
    const labCost = positiveMoney(costs?.labTotal);
    const materialCost = positiveMoney(costs?.materialTotal);
    const specialDoctorCost = positiveMoney(costs?.specialDoctorTotal);
    const doctorCost = positiveMoney(record.doctorEarnings);
    const totalCost = money(labCost + materialCost + specialDoctorCost + doctorCost);
    const netProfit = money(cost - totalCost);
    return {
      treatmentId: record.id,
      date: record.date,
      patientId: record.patient_id,
      patientName: record.patient_name?.trim() || 'Unknown patient',
      age: record.patient_age !== null && record.patient_age !== undefined && Number.isFinite(Number(record.patient_age))
        ? Number(record.patient_age)
        : null,
      phone: record.patient_phone?.trim() || 'Not recorded',
      city: record.patient_city?.trim() || 'Not recorded',
      township: record.patient_township?.trim() || 'Not recorded',
      patientType: record.patient_type?.trim() || 'Not assigned',
      treatment: record.description?.trim() || 'Treatment',
      doctor: record.doctor_name?.trim() || 'Unassigned',
      cost,
      payment,
      balance: money(Math.max(0, cost - payment)),
      labCost,
      materialCost,
      specialDoctorCost,
      doctorCost,
      totalCost,
      netProfit,
      netMargin: cost > 0 ? netProfit / cost : 0
    };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.patientName.localeCompare(b.patientName) || a.treatmentId.localeCompare(b.treatmentId));

  return {
    rows,
    summary: summarizeRows(rows),
    byTreatment: groupRows(rows, row => row.treatment),
    byDoctor: groupRows(rows, row => row.doctor),
    byPatientType: groupRows(rows, row => row.patientType)
  };
};

export const monthlyReportFilename = (metadata: MonthlyReportMetadata, extension: 'pdf' | 'xlsx'): string => {
  const scope = metadata.locationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report';
  return `monthly-report-${metadata.dateFrom}-to-${metadata.dateTo}-${scope}.${extension}`;
};
