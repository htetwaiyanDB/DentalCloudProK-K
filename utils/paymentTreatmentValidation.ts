import type { ClinicalRecord } from '../types';

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