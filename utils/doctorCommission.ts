export const DOCTOR_SPECIALIZATIONS = ['General', 'Ortho', 'Implant', 'Surgery', 'Specialists'] as const;

export const FLAT_VISIT_COMMISSION_SPECIALIZATIONS: readonly string[] = ['Ortho', 'Implant', 'Surgery'];

export type DoctorCommissionType = 'percentage' | 'fixed';

export const resolveDoctorCommissionType = (
  commissionType?: DoctorCommissionType | string | null,
  specialization?: string | null
): DoctorCommissionType => {
  if (commissionType === 'fixed' || commissionType === 'percentage') return commissionType;

  // Backward-compatible fallback for rows/API responses created before
  // doctors.commission_type was deployed.
  const legacySpecialization = specialization ?? commissionType;
  return FLAT_VISIT_COMMISSION_SPECIALIZATIONS.includes((legacySpecialization || '').trim())
    ? 'fixed'
    : 'percentage';
};

export const usesFlatVisitCommission = (
  commissionType?: DoctorCommissionType | string | null,
  specialization?: string | null
) => resolveDoctorCommissionType(commissionType, specialization) === 'fixed';

export const calculateDoctorEarnings = (params: {
  collectedPayment?: number | null;
  materialCost?: number | null;
  commissionType?: DoctorCommissionType | string | null;
  specialization?: string | null;
  commissionPercentage?: number | null;
  commissionPerVisit?: number | null;
}) => {
  const collectedPayment = Math.max(0, Number(params.collectedPayment || 0));
  const materialCost = Math.max(0, Number(params.materialCost || 0));
  const commissionBase = Math.max(0, collectedPayment - materialCost);

  const amount = usesFlatVisitCommission(params.commissionType, params.specialization)
    ? (collectedPayment > 0 ? Number(params.commissionPerVisit || 0) : 0)
    : commissionBase * (Number(params.commissionPercentage || 0) / 100);

  return Math.round(amount * 100) / 100;
};
