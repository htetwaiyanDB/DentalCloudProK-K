import type { PaymentRecord } from '../types';

const paymentSortKey = (payment: PaymentRecord): string =>
  String(payment.createdAt || payment.receiptSnapshot?.createdAt || payment.date || '');

export const getPatientPaymentHistory = (
  payments: PaymentRecord[],
  patientId: string
): PaymentRecord[] => payments
  .filter((payment) => payment.patientId === patientId)
  .sort((a, b) => {
    const dateComparison = paymentSortKey(b).localeCompare(paymentSortKey(a));
    return dateComparison !== 0 ? dateComparison : b.id.localeCompare(a.id);
  });

export const getPaymentReceiptNumber = (payment: PaymentRecord): string =>
  payment.receiptNumber || payment.receiptSnapshot?.receiptNumber || 'Not recorded';

const nonNegativeNumber = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
};

export const getPaymentReceivedAmount = (payment: PaymentRecord): number =>
  nonNegativeNumber(payment.clearedAmount ?? payment.amount);

export const getPaymentBalanceAfter = (payment: PaymentRecord): number =>
  nonNegativeNumber(payment.patientCurrentBalance ?? payment.remainingBalance);

export const formatPaymentTime = (value?: string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};