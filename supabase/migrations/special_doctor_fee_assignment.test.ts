import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(fileURLToPath(new URL('./20260930000000_add_special_doctor_fee_assignment.sql', import.meta.url)), 'utf8');

describe('Special doctor fee assignment migration', () => {
  it('adds an optional assignment restricted to Special Doctor MLS costs', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS doctor_id UUID');
    expect(sql).toContain("CHECK (doctor_id IS NULL OR cost_type = 'special_doctor')");
    expect(sql).toContain('FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE SET NULL');
  });

  it('preserves K&K treatment-bound MLS behavior while persisting an assignment', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.replace_treatment_costs(');
    expect(sql).toContain("CASE WHEN item.cost_type = 'special_doctor' THEN item.doctor_id ELSE NULL END");
    expect(sql).toContain("source_type IN ('material_cost', 'lab_cost', 'special_doctor_cost')");
    expect(sql).not.toContain('get_applicable_commission_rate');
  });

  it('keeps the doctor assignment when rebuilt on the payment-based cost replacement function', () => {
    expect(sql).toContain('to_regclass(\'public.payments\')');
    expect(sql).toContain("to_regprocedure('public.replace_treatment_costs(uuid,jsonb,uuid,text,uuid)')");
    expect(sql).toContain('jsonb_to_recordset(p_items) item(material_name TEXT, cost_type TEXT, cost_amount NUMERIC, quantity NUMERIC, doctor_id UUID)');
    expect(sql).toContain('(audit_log_id, material_name, cost_type, cost_amount, quantity, doctor_id, created_by, created_by_name)');
    expect(sql).toContain("IF v_source_type = 'payment' THEN");
  });
});

