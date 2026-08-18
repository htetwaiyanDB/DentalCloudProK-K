import type { PaymentRecord } from '../types';

export const getPaymentServiceFeeAmount = (payment: PaymentRecord): number => {
  const snapshotAmount = Number(payment.receiptSnapshot?.payment?.serviceFeeAmount || 0);
  if (Number.isFinite(snapshotAmount) && snapshotAmount > 0) return snapshotAmount;

  const legacyAmount = Number((payment as PaymentRecord & { serviceFeeAmount?: number }).serviceFeeAmount || 0);
  return Number.isFinite(legacyAmount) && legacyAmount > 0 ? legacyAmount : 0;
};

/** Returns whether this grouped patient/date visit already has a recorded fee. */
export const hasRecordedServiceFeeForVisit = (
  payments: PaymentRecord[],
  patientId: string,
  visitDate: string
): boolean => payments.some((payment) => (
  payment.patientId === patientId
  && payment.date === visitDate
  && getPaymentServiceFeeAmount(payment) > 0
));
