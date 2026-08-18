import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: { status: 'success' }, error: null }))
}));

vi.mock('./supabase', () => ({
  supabase: { rpc: supabaseMock.rpc },
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

describe('patients.delete', () => {
  beforeEach(() => supabaseMock.rpc.mockClear());

  it('uses the atomic patient deletion RPC', async () => {
    await api.patients.delete('patient-1');

    expect(supabaseMock.rpc).toHaveBeenCalledWith('delete_patient_atomic', {
      p_patient_id: 'patient-1'
    });
  });
});
