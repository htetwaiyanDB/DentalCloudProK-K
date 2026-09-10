import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => {
  const state: any = { rpcCalls: [] };
  state.rpc = vi.fn(async (name: string, payload: any) => {
    state.rpcCalls.push({ name, payload });
    if (name === 'replace_treatment_costs') {
      return {
        data: [
          { id: 'cost-1', audit_log_id: 'audit-1', material_name: 'Composite', cost_type: 'material', cost_amount: 100, quantity: 2, total_amount: 200 },
          { id: 'cost-2', audit_log_id: 'audit-1', material_name: 'Crown lab', cost_type: 'lab', cost_amount: 300, quantity: 1, total_amount: 300 }
        ],
        error: null
      };
    }
    return { data: null, error: null };
  });
  const from = vi.fn((table: string) => {
    if (table === 'audit_logs') {
      return { upsert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: 'audit-1' }, error: null })) })) })) };
    }
    if (table === 'pending_commission_recalculations') {
      return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })) };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  return { rpc: state.rpc, from, rpcCalls: state.rpcCalls };
});

vi.mock('./supabase', () => ({
  supabase: { rpc: supabaseMock.rpc, from: supabaseMock.from },
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

describe('api.materialCosts transactional RPC', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    supabaseMock.rpcCalls.length = 0;
    supabaseMock.rpc.mockClear();
    supabaseMock.from.mockClear();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('sends categorized items and the logged-in staff identity with its server session token', async () => {
    const result = await api.materialCosts.upsertForTreatment({
      id: 'treatment-1', location_id: 'location-1', patient_id: 'patient-1', teeth: [], description: 'Crown', cost: 1000, date: '2026-07-18'
    }, [
      { materialName: ' Composite ', costType: 'material', costAmount: 100, quantity: 2 },
      { materialName: 'Crown lab', costType: 'lab', costAmount: 300, quantity: 1 }
    ], { userId: 'admin-1', username: 'Admin', authToken: 'session-token-1' });

    expect(supabaseMock.rpcCalls[0]).toEqual({
      name: 'replace_treatment_costs',
      payload: {
        p_audit_log_id: 'audit-1',
        p_items: [
          { material_name: 'Composite', cost_type: 'material', cost_amount: 100, quantity: 2 },
          { material_name: 'Crown lab', cost_type: 'lab', cost_amount: 300, quantity: 1 }
        ],
        p_admin_user_id: 'admin-1',
        p_admin_password: 'session-token-1',
        p_request_token: expect.any(String)
      }
    });
    expect(result.items.map((item) => item.costType)).toEqual(['material', 'lab']);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Treatment costs were saved, but doctor commission refresh needs retry.',
      expect.any(Error)
    );
  });
});