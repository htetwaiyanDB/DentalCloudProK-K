import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(fileURLToPath(new URL('./20260912092755_stop_special_doctor_expense_sync.sql', import.meta.url)), 'utf8');

describe('stop Special Doctor expense synchronization migration', () => {
  it('removes only previously generated Special Doctor expenses', () => {
    expect(sql).toContain("WHERE source_type = 'special_doctor_cost'");
    expect(sql).toContain('AND is_system_generated IS TRUE');
  });

  it('continues accepting MLS rows without inserting a Special Doctor expense', () => {
    expect(sql).toContain("item.cost_type NOT IN ('material', 'lab', 'special_doctor')");
    expect(sql).not.toContain('IF v_special_doctor_total > 0');
    expect(sql).not.toContain("'Special Doctor Cost', v_treatment_date");
  });

  it('keeps the RPC privilege boundary intact', () => {
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.replace_treatment_costs');
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
