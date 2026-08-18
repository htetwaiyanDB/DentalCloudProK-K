import type { ClinicalRecord, PaymentRecord } from '../types';
import { allocateCommissionablePayments } from './doctorCommissionLedger';
import {
  dedupePaymentRecords,
  getPaymentTreatmentIds,
  getPaymentTreatmentShare
} from './paymentTreatmentAllocation';

const roundMoney = (amount: number): number => Math.round(amount * 100) / 100;

const toNonNegativeFiniteNumber = (value: unknown): number => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;
};

export const calculateCollectedByTreatmentId = (
  records: ClinicalRecord[],
  payments: PaymentRecord[]
): Record<string, number> => {
  const uniquePayments = dedupePaymentRecords(payments);
  const allocations = allocateCommissionablePayments(
    records.map((record) => ({
      id: record.id,
      patientId: record.patient_id,
      date: record.date,
      cost: toNonNegativeFiniteNumber(record.cost)
    })),
    uniquePayments.map((payment) => ({
      id: payment.id,
      patientId: payment.patientId,
      date: payment.date,
      createdAt: payment.createdAt,
      commissionableAmount: getPaymentTreatmentShare(payment),
      treatmentIds: getPaymentTreatmentIds(payment)
    }))
  );

  return allocations.reduce((summary, allocation) => {
    summary[allocation.treatmentId] = roundMoney(
      (summary[allocation.treatmentId] || 0) + allocation.amount
    );
    return summary;
  }, {} as Record<string, number>);
};

export const calculateMaterialAdjustedDoctorEarnings = (
  records: ClinicalRecord[]
): number => {
  const total = records.reduce((sum, record) => {
    return sum + toNonNegativeFiniteNumber(record.doctorEarnings);
  }, 0);

  return roundMoney(total);
};

export const calculateMaterialNetProfit = (
  records: ClinicalRecord[],
  getMaterialCost: (treatmentId: string) => number
): number => {
  const treatmentAmount = records.reduce((sum, record) => sum + toNonNegativeFiniteNumber(record.cost), 0);
  const materialCost = records.reduce((sum, record) => sum + toNonNegativeFiniteNumber(getMaterialCost(record.id)), 0);
  const doctorEarnings = calculateMaterialAdjustedDoctorEarnings(records);
  return roundMoney(treatmentAmount - materialCost - doctorEarnings);
};
