import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('./20260810130000_repair_doctor_login_user_links.sql', import.meta.url),
  'utf8'
);

describe('doctor login user link repair migration', () => {
  it('backfills only credentialed, unlinked, non-conflicting doctors', () => {
    expect(migration).toContain("NULLIF(btrim(d.email), '') IS NOT NULL");
    expect(migration).toContain("NULLIF(btrim(d.password), '') IS NOT NULL");
    expect(migration).toContain('linked.doctor_id = d.id');
    expect(migration).toContain('lower(btrim(existing.username)) = lower(btrim(d.email))');
    expect(migration).toContain('INSERT INTO public.users (location_id, doctor_id, username, password, role, allowed_tabs)');
  });

  it('is repeatable and preserves one linked user per doctor', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS users_doctor_id_unique_idx');
    expect(migration).toContain('ON CONFLICT DO NOTHING');
    expect(migration).toContain('login_doctors_without_linked_user');
  });
});