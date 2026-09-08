import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  './20260908090000_payment_void.sql',
  import.meta.url
)), 'utf8');

describe('payment void migration', () => {
  it('requires an admin and a meaningful audit reason', () => {
    expect(migration).toContain('NOT public.is_admin_user(p_voided_by_user_id)');
    expect(migration).toContain('Void reason must be at least 10 characters');
    expect(migration).toContain('Void reason cannot exceed 500 characters');
  });

  it('locks the payment and patient before reversing the balance', () => {
    expect(migration).toMatch(/FROM public\.payments[\s\S]*FOR UPDATE/);
    expect(migration).toMatch(/FROM public\.patients[\s\S]*FOR UPDATE/);
    expect(migration).toContain('SET balance = round(v_patient_balance + v_reversal_amount, 2)');
  });

  it('keeps an immutable-looking audit record while zeroing live collections', () => {
    expect(migration).toContain('IF v_payment.voided_at IS NOT NULL');
    expect(migration).toContain('voided_amount = v_reversal_amount');
    expect(migration).toContain('amount = 0');
    expect(migration).toContain('cleared_amount = 0');
    expect(migration).toContain('DELETE FROM public.payment_allocations');
    expect(migration).toContain("'{allocationReconciled}', 'false'::JSONB");
    expect(migration).toContain("current_setting('dentalcloud.payment_void_rpc', TRUE)");
    expect(migration).toContain("RAISE EXCEPTION 'Voided payments are immutable'");
  });

  it('allows zero amounts only for rows carrying complete void metadata', () => {
    expect(migration).toContain('amount > 0 OR (amount = 0 AND voided_at IS NOT NULL)');
    expect(migration).toContain('voided_amount > 0');
    expect(migration).toContain('Voided payments cannot retain payment allocations');
  });
});
