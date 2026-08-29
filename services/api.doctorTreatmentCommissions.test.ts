import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('./supabase', () => ({
  supabase: { rpc: supabaseMock.rpc },
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

describe('doctor treatment commission replacement', () => {
  beforeEach(() => supabaseMock.rpc.mockReset());

  it('uses one transactional RPC for the complete normalized list', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: null });

    await api.doctorTreatmentCommissions.replaceForDoctor(
      'doctor-1', 'percentage', 10, 0,
      [{ treatment_id: 'treatment-1', commission_rate: 12.5, fixed_amount: null }],
      { userId: 'user-1', authToken: 'token-1' }
    );

    expect(supabaseMock.rpc).toHaveBeenCalledWith('configure_doctor_commission', {
      p_doctor_id: 'doctor-1',
      p_commission_type: 'percentage',
      p_commission_percentage: 10,
      p_commission_per_visit: 0,
      p_commissions: [{ treatment_id: 'treatment-1', commission_rate: 12.5, fixed_amount: null }],
      p_user_id: 'user-1',
      p_session_token: 'token-1'
    });
  });

  it('passes fixed treatment amounts to the transactional RPC', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: null });

    await api.doctorTreatmentCommissions.replaceForDoctor(
      'doctor-1', 'fixed', 0, 10_000,
      [{ treatment_id: 'treatment-1', commission_rate: 0, fixed_amount: 15_000 }],
      { userId: 'user-1', authToken: 'token-1' }
    );

    expect(supabaseMock.rpc).toHaveBeenCalledWith('configure_doctor_commission', expect.objectContaining({
      p_commission_type: 'fixed',
      p_commissions: [{ treatment_id: 'treatment-1', commission_rate: 0, fixed_amount: 15_000 }]
    }));
  });

  it('provides an actionable error when the migration is missing', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find configure_doctor_commission' }
    });

    await expect(api.doctorTreatmentCommissions.replaceForDoctor(
      'doctor-1', 'fixed', 0, 10_000, [], { userId: 'user-1', authToken: 'token-1' }
    ))
      .rejects.toThrow('configurable_doctor_commission_migration.sql');
  });
});