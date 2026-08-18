import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('./20260809000000_visit_doctor_correction.sql', import.meta.url)), 'utf8');

describe('visit doctor correction migration', () => {
  it('links treatments to appointments and keeps an immutable correction history', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS appointment_id UUID');
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(migration).toContain('v_candidate_count = 1');
    expect(migration).toContain('pg_advisory_xact_lock(hashtextextended(p_request_token::TEXT, 0))');
    expect(migration).toContain('pg_advisory_xact_lock(hashtextextended(v_appointment.patient_id::TEXT, 0))');
    expect(migration).toContain('BEFORE INSERT ON public.payments');
    expect(migration).toContain('pg_advisory_xact_lock(hashtextextended(NEW.patient_id::TEXT, 0))');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.doctor_assignment_corrections');
    expect(migration).toContain('Doctor assignment correction history is immutable.');
  });

  it('requires a live administrator session and location access', () => {
    expect(migration).toContain("u.role = 'admin'");
    expect(migration).toContain('session.revoked_at IS NULL');
    expect(migration).toContain('session.expires_at > NOW()');
    expect(migration).toContain('(u.location_id IS NULL OR u.location_id = p_location_id)');
    expect(migration).toContain('v_admin := public.require_visit_correction_admin(p_admin_user_id, p_session_token, v_existing.location_id)');
  });

  it('locks records, rejects stale changes, and blocks paid treatment reassignment', () => {
    expect(migration.match(/FOR UPDATE/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain('changed after the correction dialog was opened');
    expect(migration).toContain('Paid treatments cannot be reassigned here');
    expect(migration).toContain('public.doctor_commission_entries');
  });

  it('updates appointment, treatments and audit rows within one RPC', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.correct_visit_doctor_atomic');
    expect(migration).toContain('UPDATE public.appointments SET doctor_id = p_new_doctor_id');
    expect(migration).toContain('UPDATE public.treatments');
    expect(migration).toContain('UPDATE public.audit_logs');
    expect(migration).toContain('request_token UUID NOT NULL UNIQUE');
  });
});