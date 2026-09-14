import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260910000000_refresh_default_percentage_commission_snapshots.sql'), 'utf8');

describe('default percentage commission snapshot refresh migration', () => {
  it('allows an explicit default snapshot correction without re-resolving overrides', () => {
    expect(migration).toContain('NEW.commission_percentage_snapshot IS NOT DISTINCT FROM OLD.commission_percentage_snapshot');
    expect(migration).toContain('NEW.treatment_type_id IS NOT DISTINCT FROM OLD.treatment_type_id THEN\n    RETURN NEW;');
    expect(migration).toContain("NEW.commission_source_snapshot := CASE WHEN v_type = 'percentage' AND v_custom_percentage IS NOT NULL THEN 'treatment_override' ELSE 'doctor_default' END");
  });
});