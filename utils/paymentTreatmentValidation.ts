import type { ClinicalRecord, PaymentRecord } from '../types';
import { allocateCommissionablePayments } from './doctorCommissionLedger';
import { getPaymentTreatmentIds, getPaymentTreatmentShare } from './paymentTreatmentAllocation';

export const validateAuthoritativePaymentTreatments = (
  selected: ClinicalRecord[],
  authoritative: ClinicalRecord[],
  patientId: string,
  locationId: string
): ClinicalRecord[] => {
  const selectedIds = selected.map((treatment) => treatment.id);
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new Error('The payment contains duplicate treatments. Reload the patient and review the payment items.');
  }

  const authoritativeById = new Map(authoritative.map((treatment) => [treatment.id, treatment]));
  const resolved = selectedIds.map((id) => authoritativeById.get(id));
  if (resolved.some((treatment) => !treatment)) {
    throw new Error('One or more selected treatments were undone or changed. Reload the patient and review the payment items.');
  }

  const valid = resolved as ClinicalRecord[];
  if (valid.some((treatment) => treatment.patient_id !== patientId || treatment.location_id !== locationId)) {
    throw new Error('One or more selected treatments do not belong to this patient and branch. Reload and review the payment items.');
  }

  return valid;
};

export const resolvePaymentTreatmentsForCollection = ({
  selected,
  authoritative,
  previousPayments,
  patientId,
  locationId,
  paymentDate,
  treatmentAmount
}: {
  selected: ClinicalRecord[];
  authoritative: ClinicalRecord[];
  previousPayments: PaymentRecord[];
  patientId: string;
  locationId: string;
  paymentDate: string;
  treatmentAmount: number;
}): ClinicalRecord[] => {
  if (selected.length > 0) {
    return validateAuthoritativePaymentTreatments(selected, authoritative, patientId, locationId);
  }

  const safeTreatmentAmount = Math.max(0, Number(treatmentAmount || 0));
  if (safeTreatmentAmount <= 0) return [];

  const eligibleTreatments = authoritative.filter((treatment) => (
    treatment.patient_id === patientId &&
    treatment.location_id === locationId &&
    treatment.date <= paymentDate &&
    Math.max(0, Number(treatment.cost || 0)) > 0
  ));
  const currentPaymentId = '__pending_collection__';
  const allocations = allocateCommissionablePayments(
    eligibleTreatments.map((treatment) => ({
      id: treatment.id,
      patientId: treatment.patient_id,
      doctorId: treatment.doctor_id,
      treatmentTypeId: treatment.treatment_type_id,
      date: treatment.date,
      cost: Math.max(0, Number(treatment.cost || 0))
    })),
    [
      ...previousPayments
        .filter((payment) => payment.patientId === patientId && !payment.voidedAt)
        .map((payment) => ({
          id: payment.id,
          patientId: payment.patientId,
          date: payment.date,
          createdAt: payment.createdAt,
          commissionableAmount: getPaymentTreatmentShare(payment),
          treatmentIds: getPaymentTreatmentIds(payment)
        })),
      {
        id: currentPaymentId,
        patientId,
        date: paymentDate,
        createdAt: '9999-12-31T23:59:59.999Z',
        commissionableAmount: safeTreatmentAmount,
        treatmentIds: []
      }
    ]
  );
  const allocatedIds = new Set(
    allocations
      .filter((allocation) => allocation.paymentId === currentPaymentId && allocation.amount > 0)
      .map((allocation) => allocation.treatmentId)
  );

  return eligibleTreatments.filter((treatment) => allocatedIds.has(treatment.id));
};
