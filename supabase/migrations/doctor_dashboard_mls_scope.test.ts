import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('./20261104010000_doctor_dashboard_mls_scope.sql', import.meta.url), 'utf8');

describe('doctor dashboard MLS scope migration', () => {
  it('adds clinician IDs while preserving one ledger row per cost and caller security', () => {
    expect(sql).toContain('security_invoker = true');
    expect(sql).toContain('LEFT JOIN LATERAL (');
    expect(sql).toContain('array_agg(DISTINCT pt.doctor_id) FILTER');
    expect(sql).toContain('WHEN cardinality(linked.doctor_ids) > 0 THEN linked.doctor_ids');
    expect(sql).toContain('WHEN a.doctor_id IS NOT NULL THEN ARRAY[a.doctor_id]');
    expect(sql).not.toMatch(/unnest|INSERT INTO|UPDATE public|DELETE FROM/i);
    expect(sql).toMatch(/NOTIFY pgrst, 'reload schema';\s*COMMIT;/);
  });
});