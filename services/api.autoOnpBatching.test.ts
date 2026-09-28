import { describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => {
  const state: any = { updateBatches: [] as string[][] };
  const query: any = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => query),
    lte: vi.fn(() => query),
    or: vi.fn(() => query),
    eq: vi.fn(() => query),
    then: (resolve: any) => Promise.resolve({
      data: Array.from({ length: 45 }, (_, index) => ({ id: `patient-${index}`, patient_type: 'Walk-in' })),
      error: null
    }).then(resolve)
  };
  return {
    state,
    from: vi.fn((table: string) => table === 'app_settings'
      ? { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { auto_onp_patient_type_enabled: true }, error: null })) })) })) }
      : table === 'patients'
        ? {
            select: vi.fn(() => query),
            update: vi.fn(() => ({ in: vi.fn(async (_column: string, ids: string[]) => {
              state.updateBatches.push(ids);
              return { error: null };
            }) }))
          }
        : {})
  };
});

vi.mock('./supabase', () => ({
  supabase: { from: supabaseMock.from, rpc: vi.fn() },
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

describe('automatic ONP patient conversion', () => {
  it('splits updates into URL-safe batches to avoid custom-domain proxy CORS failures', async () => {
    await api.patients.getAll('location-1');

    expect(supabaseMock.state.updateBatches.map((batch: string[]) => batch.length)).toEqual([20, 20, 5]);
    expect(new Set(supabaseMock.state.updateBatches.flat()).size).toBe(45);
  });
});