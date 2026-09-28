import { describe, expect, it } from 'vitest';

import { summarizeTreatmentCostRows } from './treatmentCostSummaries';

describe('treatment cost summaries', () => {
  it('separates all treatment cost categories while preserving the combined total', () => {
    const summaries = summarizeTreatmentCostRows([
      { audit_log_id: 'audit-1', cost_type: 'material', total_amount: 12_000 },
      { audit_log_id: 'audit-1', cost_type: 'lab', total_amount: '30,000'.replace(',', '') },
      { audit_log_id: 'audit-1', cost_type: 'material', total_amount: 8_000 },
      { audit_log_id: 'audit-1', cost_type: 'special_doctor', total_amount: 40_000 }
    ], new Map([['audit-1', 'treatment-1']]));

    expect(summaries['treatment-1']).toEqual({
      auditLogId: 'audit-1',
      materialTotal: 20_000,
      materialItemCount: 2,
      labTotal: 30_000,
      labItemCount: 1,
      specialDoctorTotal: 40_000,
      specialDoctorItemCount: 1,
      assignedSpecialDoctorTotal: 0,
      assignedSpecialDoctorItemCount: 0,
      totalAmount: 90_000,
      itemCount: 4
    });
  });

  it('tracks the portion of special doctor fees tied to an assigned doctor separately', () => {
    const summaries = summarizeTreatmentCostRows([
      { audit_log_id: 'audit-2', cost_type: 'special_doctor', total_amount: 40_000, doctor_id: 'doctor-1' },
      { audit_log_id: 'audit-2', cost_type: 'special_doctor', total_amount: 15_000, doctor_id: null }
    ], new Map([['audit-2', 'treatment-2']]));

    expect(summaries['treatment-2']?.specialDoctorTotal).toBe(55_000);
    expect(summaries['treatment-2']?.specialDoctorItemCount).toBe(2);
    expect(summaries['treatment-2']?.assignedSpecialDoctorTotal).toBe(40_000);
    expect(summaries['treatment-2']?.assignedSpecialDoctorItemCount).toBe(1);
    // The assigned portion is a breakout, not an addition: totalAmount must
    // not double count it.
    expect(summaries['treatment-2']?.totalAmount).toBe(55_000);
  });

  it('treats legacy rows without a cost type as material', () => {
    const summaries = summarizeTreatmentCostRows([
      { audit_log_id: 'audit-legacy', total_amount: 25_000 }
    ], new Map([['audit-legacy', 'treatment-legacy']]));

    expect(summaries['treatment-legacy']?.materialTotal).toBe(25_000);
    expect(summaries['treatment-legacy']?.labTotal).toBe(0);
    expect(summaries['treatment-legacy']?.specialDoctorTotal).toBe(0);
    expect(summaries['treatment-legacy']?.totalAmount).toBe(25_000);
  });

  it('ignores rows that cannot be linked to a treatment', () => {
    expect(summarizeTreatmentCostRows([
      { audit_log_id: 'missing', cost_type: 'lab', total_amount: 10_000 }
    ], new Map())).toEqual({});
  });
});