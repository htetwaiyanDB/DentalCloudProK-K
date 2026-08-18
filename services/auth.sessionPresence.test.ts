import { beforeEach, describe, expect, it, vi } from 'vitest';

const presenceMock = vi.hoisted(() => ({
  markActive: vi.fn(),
  markInactive: vi.fn()
}));

vi.mock('./activeStaffPresence', () => ({
  activeStaffPresence: presenceMock
}));

vi.mock('./api', () => ({
  api: {
    users: {
      getAll: vi.fn(),
      getById: vi.fn(),
      getByDoctorId: vi.fn(),
      create: vi.fn(),
      authenticate: vi.fn(),
      revokeAuthSession: vi.fn()
    }
  }
}));

import { auth } from './auth';
import { api } from './api';

const createLocalStorageMock = () => {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    })
  };
};

describe('auth staff session presence resilience', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('localStorage', createLocalStorageMock());
    presenceMock.markActive.mockReset();
    presenceMock.markInactive.mockReset();
  });

  it('keeps a valid staff session when active presence tracking fails', async () => {
    presenceMock.markActive.mockRejectedValueOnce(new Error('RPC unavailable'));

    const session = await auth.createStaffSession({
      id: '00000000-0000-0000-0000-000000000001',
      username: 'admin',
      password: 'admin123',
      role: 'admin',
      location_id: null
    });

    expect(session.username).toBe('admin');
    expect(auth.getSession()?.username).toBe('admin');
    expect(localStorage.removeItem).not.toHaveBeenCalledWith('dental_auth_session');
  });

  it('clears the local session even when inactive presence tracking fails during logout', async () => {
    presenceMock.markActive.mockResolvedValueOnce(undefined);
    presenceMock.markInactive.mockRejectedValueOnce(new Error('RPC unavailable'));

    await auth.createStaffSession({
      id: '00000000-0000-0000-0000-000000000002',
      username: 'frontdesk',
      password: 'secret',
      role: 'normal',
      location_id: null
    });

    await auth.logout();

    expect(auth.getSession()).toBeNull();
    expect(localStorage.removeItem).toHaveBeenCalledWith('dental_auth_session');
  });

  it('revokes the server-issued staff token during logout', async () => {
    presenceMock.markActive.mockResolvedValueOnce(undefined);
    presenceMock.markInactive.mockResolvedValueOnce(undefined);

    await auth.createStaffSession({
      id: '00000000-0000-0000-0000-000000000005',
      username: 'admin',
      auth_session_token: 'server-token-1',
      role: 'admin',
      location_id: null
    });

    await auth.logout();

    expect(api.users.revokeAuthSession).toHaveBeenCalledWith('server-token-1');
    expect(auth.getSession()).toBeNull();
  });

  it('refreshes branch permission changes from the database without requiring a new login', async () => {
    presenceMock.markActive.mockResolvedValueOnce(undefined);
    await auth.createStaffSession({
      id: '00000000-0000-0000-0000-000000000003',
      username: 'marketing',
      password: 'secret',
      role: 'normal',
      location_id: null,
      allowed_tabs: ['dashboard']
    });

    vi.mocked(api.users.getById).mockResolvedValueOnce({
      id: '00000000-0000-0000-0000-000000000003',
      username: 'marketing',
      password: '',
      role: 'normal',
      location_id: null,
      allowed_tabs: ['dashboard', 'branch-switching']
    });

    const refreshed = await auth.refreshStaffSession();

    expect(refreshed?.allowed_tabs).toContain('branch-switching');
    expect(auth.getSession()?.allowed_tabs).toContain('branch-switching');
  });

  it('clears a cached session when the staff account was deleted', async () => {
    presenceMock.markActive.mockResolvedValueOnce(undefined);
    presenceMock.markInactive.mockResolvedValueOnce(undefined);
    await auth.createStaffSession({
      id: '00000000-0000-0000-0000-000000000004',
      username: 'removed-user',
      password: 'secret',
      role: 'normal',
      location_id: null
    });
    vi.mocked(api.users.getById).mockResolvedValueOnce(null);

    await expect(auth.refreshStaffSession()).resolves.toBeNull();
    expect(auth.getSession()).toBeNull();
  });

  it('repairs a legacy doctor session that stored doctors.id as userId', async () => {
    presenceMock.markActive.mockResolvedValueOnce(undefined);
    await auth.createStaffSession({
      id: '00000000-0000-0000-0000-000000000010',
      username: 'doctor@example.com',
      role: 'normal',
      location_id: '00000000-0000-0000-0000-000000000020',
      doctor_id: '00000000-0000-0000-0000-000000000010'
    });
    vi.mocked(api.users.getById).mockResolvedValueOnce(null);
    vi.mocked(api.users.getByDoctorId).mockResolvedValueOnce({
      id: '00000000-0000-0000-0000-000000000011',
      username: 'doctor@example.com',
      role: 'normal',
      location_id: '00000000-0000-0000-0000-000000000020',
      doctor_id: '00000000-0000-0000-0000-000000000010'
    });

    const refreshed = await auth.refreshStaffSession();

    expect(api.users.getByDoctorId).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000010');
    expect(refreshed?.userId).toBe('00000000-0000-0000-0000-000000000011');
    expect(refreshed?.role).toBe('doctor');
    expect(auth.getSession()?.userId).toBe('00000000-0000-0000-0000-000000000011');
  });

  it('does not validate patient sessions against the staff users table', async () => {
    auth.setSession({
      userId: '00000000-0000-0000-0000-000000000030',
      patientId: '00000000-0000-0000-0000-000000000030',
      username: 'Patient One',
      role: 'patient',
      location_id: '00000000-0000-0000-0000-000000000040',
      loginTime: Date.now()
    });

    const refreshed = await auth.refreshStaffSession();

    expect(refreshed?.role).toBe('patient');
    expect(api.users.getById).not.toHaveBeenCalled();
    expect(api.users.getByDoctorId).not.toHaveBeenCalled();
  });
});
