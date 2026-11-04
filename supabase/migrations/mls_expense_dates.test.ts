import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  './20261104000000_mls_expense_dates.sql',
  import.meta.url
)), 'utf8');

describe('MLS expense-date migration', () => {
  it('backfills historical dates from the original activity and never guesses today', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS expense_date DATE');
    expect(migration).toContain('COALESCE(p.payment_date, p.created_at::DATE)');
    expect(migration).toContain('WHEN \'treatment\' THEN t.date');
    // A CURRENT_DATE default would silently re-date the reported problem.
    expect(migration).not.toMatch(/expense_date[^;]*DEFAULT\s+CURRENT_DATE/i);
    expect(migration).toContain('ALTER COLUMN expense_date SET NOT NULL');
  });

  it('splits generated expenses by type and expense date without dropping the audit link', () => {
    expect(migration).toContain('GROUP BY c.cost_type, c.expense_date');
    // source_id must stay the audit id so existing audit-delete triggers clean up every date.
    expect(migration).toContain('c.cost_type || \'_cost\', p_audit_log_id, true');
    expect(migration).toContain('source_type IN (\'material_cost\', \'lab_cost\', \'special_doctor_cost\')');
    expect(migration).toContain('WHERE source_type IN (\'material_cost\', \'lab_cost\')');
    expect(migration).not.toContain("WHEN 'special_doctor' THEN 'Special Doctor Cost'");
  });

  it('preserves stable item identity and creation metadata on resave', () => {
    expect(migration).toContain('expense_date = item.expense_date, updated_at = NOW()');
    expect(migration).toContain('AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) item(id UUID) WHERE item.id = c.id)');
    expect(migration).toContain('WHERE c.id = item.id AND c.audit_log_id = p_audit_log_id');
    expect(migration).toContain("Duplicate MLS item IDs are not allowed");
    expect(migration).toContain('MLS item does not belong to this activity');
  });

  it('rejects missing or impossible dates instead of writing them', () => {
    expect(migration).toContain("item->>'expense_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'");
    expect(migration).toContain('Please reload or upgrade the application before saving');
    expect(migration).toContain('item.expense_date::DATE::TEXT <> item.expense_date');
  });

  it('exposes a non-duplicating report view that respects the caller row security', () => {
    expect(migration).toContain('CREATE OR REPLACE VIEW public.mls_expense_report');
    expect(migration).toContain('security_invoker = true');
    expect(migration).toContain('LEFT JOIN LATERAL (');
    expect(migration).toContain('GRANT SELECT ON public.mls_expense_report TO anon, authenticated');
    expect(migration).toMatch(/NOTIFY pgrst, 'reload schema';\s*COMMIT;/);
  });

  it('stays transactional with bounded locks for the production rollout', () => {
    expect(migration).toMatch(/^--[\s\S]*\nBEGIN;/);
    expect(migration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(migration).toContain("SET LOCAL statement_timeout = '120s'");
  });
});
