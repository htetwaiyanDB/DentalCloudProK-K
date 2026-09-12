import type { PaymentRecord } from '../types';
import { getPaymentServiceFeeAmount } from './serviceFee';

const roundMoney = (amount: number): number => Math.round(amount * 100) / 100;

const positiveMoney = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
};

export const getPaymentTreatmentIds = (payment: PaymentRecord): string[] => Array.from(new Set([
  ...(payment.treatmentIds || []),
  ...(payment.receiptSnapshot?.treatments || []).map((item) => item.id)
].filter(Boolean)));

export const getPaymentDedupeKey = (payment: PaymentRecord): string => {
  const receiptNumber = payment.receiptNumber || payment.receiptSnapshot?.receiptNumber;
  if (receiptNumber) return `receipt:${payment.patientId}|${receiptNumber}`;
  if (payment.id) return `id:${payment.id}`;
  return `legacy:${[
    payment.patientId,
    payment.date,
    payment.clearedAmount ?? payment.amount,
    payment.createdAt || '',
    payment.paymentMethod || ''
  ].join('|')}`;
};

export const dedupePaymentRecords = (payments: PaymentRecord[]): PaymentRecord[] => (
  Array.from(new Map(payments.map((payment) => [getPaymentDedupeKey(payment), payment])).values())
);

export const getPaymentAvailableTreatmentAmount = (payment: PaymentRecord): number => {
  const collected = positiveMoney(payment.clearedAmount ?? payment.amount);
  const snapshot = payment.receiptSnapshot;
  if (!snapshot) return roundMoney(Math.max(0, collected - getPaymentServiceFeeAmount(payment)));

  const medicineValue = (snapshot.medicines || []).reduce(
    (sum, item) => sum + positiveMoney(item.totalPrice),
    0
  );
  const serviceFee = positiveMoney(snapshot.payment.serviceFeeAmount);
  return roundMoney(Math.max(0, collected - serviceFee - medicineValue));
};

export const getPaymentTreatmentShare = (payment: PaymentRecord): number => {
  const snapshot = payment.receiptSnapshot;
  const availableAfterNonTreatmentCharges = getPaymentAvailableTreatmentAmount(payment);
  if (!snapshot) return availableAfterNonTreatmentCharges;

  const treatmentValue = (snapshot.treatments || []).reduce(
    (sum, item) => sum + positiveMoney(item.finalCost),
    0
  );

  // Explicit treatment lines cap the commissionable share. Some legacy mixed
  // receipts saved medicine lines but omitted their treatment lines; in that
  // case the amount left after medicines and service fees is still the paid
  // treatment balance. A medicine-only receipt naturally leaves zero here.
  return treatmentValue > 0
    ? roundMoney(Math.min(treatmentValue, availableAfterNonTreatmentCharges))
    : roundMoney(availableAfterNonTreatmentCharges);
};
