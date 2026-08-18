export const DOCTOR_SPECIALIZATIONS = ['General', 'Ortho', 'Implant', 'Surgery', 'Specialists'] as const;

// K&K production database canonical vocabulary for doctors.commission_type.
// NOTE: upstream code/data may also use 'flat_visit'; both map to 'fixed'.
export type DoctorCommissionType = 'percentage' | 'fixed';

const LEGACY_FLAT_VISIT_SPECIALIZATIONS: readonly string[] = ['Ortho', 'Implant', 'Surgery'];

interface DoctorCommissionModeInput {
  commissionType?: string | null;
  specialization?: string | null;
}

/**
 * Explicit commission_type always wins. The specialization fallback only
 * preserves behavior while older rows/databases are being migrated.
 *
 * Accepts both the K&K vocabulary ('fixed') and the upstream vocabulary
 * ('flat_visit'), canonicalizing to K&K's 'fixed' so rows written by either
 * convention behave identically.
 */
export const resolveDoctorCommissionType = ({
  commissionType,
  specialization
}: DoctorCommissionModeInput): DoctorCommissionType => {
  const normalized = (commissionType || '').trim();
  if (normalized === 'fixed' || normalized === 'flat_visit') return 'fixed';
  if (normalized === 'percentage') return 'percentage';

  return LEGACY_FLAT_VISIT_SPECIALIZATIONS.includes((specialization || '').trim())
    ? 'fixed'
    : 'percentage';
};

export const usesFlatVisitCommission = (input: DoctorCommissionModeInput): boolean =>
  resolveDoctorCommissionType(input) === 'fixed';

export const validateDoctorCommissionType = (commissionType: unknown): DoctorCommissionType => {
  const normalized = typeof commissionType === 'string' ? commissionType.trim() : '';
  if (normalized === 'fixed' || normalized === 'flat_visit') return 'fixed';
  if (normalized === 'percentage') return 'percentage';
  throw new Error('Commission method must be percentage or fixed.');
};

export const validateDoctorCommissionPercentage = (value: unknown): number => {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 100) {
    throw new Error('Commission percentage must be between 0 and 100.');
  }
  return numericValue;
};

export const validateDoctorCommissionPerVisit = (value: unknown): number => {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new Error('Per-visit commission must be a valid non-negative amount.');
  }
  return numericValue;
};

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

  const amount = usesFlatVisitCommission({
    commissionType: params.commissionType,
    specialization: params.specialization
  })
    ? (collectedPayment > 0 ? Number(params.commissionPerVisit || 0) : 0)
    : commissionBase * (Number(params.commissionPercentage || 0) / 100);

  return Math.round(amount * 100) / 100;
};
