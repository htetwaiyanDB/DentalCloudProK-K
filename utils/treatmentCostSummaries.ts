import type { TreatmentCostSummary, TreatmentCostType } from '../types';

export interface TreatmentCostSummaryRow {
  audit_log_id: string;
  cost_type?: TreatmentCostType | null;
  total_amount?: number | string | null;
}

export const summarizeTreatmentCostRows = (
  rows: TreatmentCostSummaryRow[],
  sourceByAuditId: Map<string, string>
): Record<string, TreatmentCostSummary> => rows.reduce((summary, row) => {
  const treatmentId = sourceByAuditId.get(row.audit_log_id);
  if (!treatmentId) return summary;

  const costType: TreatmentCostType = row.cost_type === 'lab'
    ? 'lab'
    : row.cost_type === 'special_doctor' ? 'special_doctor' : 'material';
  const amount = Math.max(0, Number(row.total_amount || 0));
  const existing = summary[treatmentId] || {
    auditLogId: row.audit_log_id,
    materialTotal: 0,
    materialItemCount: 0,
    labTotal: 0,
    labItemCount: 0,
    specialDoctorTotal: 0,
    specialDoctorItemCount: 0,
    totalAmount: 0,
    itemCount: 0
  };

  if (costType === 'lab') {
    existing.labTotal += amount;
    existing.labItemCount += 1;
  } else if (costType === 'special_doctor') {
    existing.specialDoctorTotal += amount;
    existing.specialDoctorItemCount += 1;
  } else {
    existing.materialTotal += amount;
    existing.materialItemCount += 1;
  }
  existing.totalAmount += amount;
  existing.itemCount += 1;
  summary[treatmentId] = existing;
  return summary;
}, {} as Record<string, TreatmentCostSummary>);