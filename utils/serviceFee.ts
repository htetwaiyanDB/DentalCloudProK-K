import type { PaymentRecord } from '../types';

export const getPaymentServiceFeeAmount = (payment: PaymentRecord): number => {
  if (payment.voidedAt) return 0;
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

/** A service fee is charged once per patient visit, even if a receipt snapshot
 * is repeated across partial or retried payments. */
export const getTotalPaymentServiceFees = (payments: PaymentRecord[]): number => {
  const feeByVisit = new Map<string, number>();
  payments.forEach((payment) => {
    const amount = getPaymentServiceFeeAmount(payment);
    if (amount <= 0) return;
    const visitKey = `${payment.patientId}|${payment.date}`;
    feeByVisit.set(visitKey, Math.max(feeByVisit.get(visitKey) || 0, amount));
  });
  return Array.from(feeByVisit.values()).reduce((sum, amount) => sum + amount, 0);
};

/** Returns the automatic suggestion only; staff may still enter a manual fee. */
export const getSuggestedServiceFeeAmount = ({
  enabled,
  configuredAmount,
  hasRecordedFeeForVisit
}: {
  enabled: boolean;
  configuredAmount: number;
  hasRecordedFeeForVisit: boolean;
}): number => {
  if (!enabled || hasRecordedFeeForVisit) return 0;

  const amount = Number(configuredAmount);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};
