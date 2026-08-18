import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { rpc: supabaseMock.rpc }, supabaseUrl: '', supabaseAnonKey: '' }));

import { api } from './api';

describe('visit doctor correction API', () => {
  beforeEach(() => supabaseMock.rpc.mockReset());

  it('loads a secured correction preview', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { appointment_id: 'appointment-1', treatments: [] }, error: null });
    await api.appointments.getDoctorCorrectionPreview('appointment-1', { userId: 'admin-1', authToken: 'session-1' });
    expect(supabaseMock.rpc).toHaveBeenCalledWith('preview_visit_doctor_correction', {
      p_appointment_id: 'appointment-1', p_admin_user_id: 'admin-1', p_session_token: 'session-1'
    });
  });

  it('submits one atomic idempotent correction RPC', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { status: 'success', correction_id: 'correction-1', updated_treatment_count: 1 }, error: null });
    const result = await api.appointments.correctDoctor({
      appointmentId: 'appointment-1', expectedOldDoctorId: 'doctor-old', newDoctorId: 'doctor-new',
      treatmentIds: ['treatment-1', 'treatment-1'], reason: 'The wrong doctor was selected.',
      actor: { userId: 'admin-1', authToken: 'session-1' }, requestToken: 'request-1'
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith('correct_visit_doctor_atomic', {
      p_appointment_id: 'appointment-1', p_expected_old_doctor_id: 'doctor-old', p_new_doctor_id: 'doctor-new',
      p_treatment_ids: ['treatment-1'], p_reason: 'The wrong doctor was selected.',
      p_admin_user_id: 'admin-1', p_session_token: 'session-1', p_request_token: 'request-1'
    });
    expect(result.correction_id).toBe('correction-1');
  });

  it('fails closed when the migration is missing', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find correct_visit_doctor_atomic' } });
    await expect(api.appointments.correctDoctor({
      appointmentId: 'appointment-1', newDoctorId: 'doctor-new', treatmentIds: [],
      reason: 'The wrong doctor was selected.', actor: { userId: 'admin-1', authToken: 'session-1' }
    })).rejects.toThrow(/doctor correction is not installed/i);
  });
});