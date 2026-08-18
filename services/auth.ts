import { User, Patient } from '../types';
import { api } from './api';
import { activeStaffPresence } from './activeStaffPresence';
import type { AppTabPermission } from '../constants';
import { DOCTOR_DASHBOARD_TABS } from '../constants';
import { resolveAllowedTabs } from '../utils/permissions';

// Default admin credentials
export const DEFAULT_ADMIN = {
  username: 'admin',
  password: 'admin123'
};

// Session storage keys
const SESSION_KEY = 'dental_auth_session';
const SESSION_USER_KEY = 'dental_auth_user';
const SESSION_INSTANCE_KEY = 'dental_auth_session_instance';
const SESSION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

const generateSessionInstanceId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `staff-session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const getOrCreateSessionInstanceId = (): string => {
  const existing = localStorage.getItem(SESSION_INSTANCE_KEY);
  if (existing) return existing;

  const created = generateSessionInstanceId();
  localStorage.setItem(SESSION_INSTANCE_KEY, created);
  return created;
};

const isRecoveryFlowActive = (): boolean => {
  if (typeof window === 'undefined') return false;

  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return searchParams.get('reset') === 'password' || hashParams.get('type') === 'recovery';
};

export interface AuthSession {
  userId: string;
  username: string;
  role: 'admin' | 'normal' | 'patient' | 'doctor';
  allowed_tabs?: AppTabPermission[];
  location_id: string | null;
  loginTime: number;
  clientSessionId?: string;
  staffAuthToken?: string;
  doctor_id?: string | null;
  patientId?: string; // For patient sessions
  supabaseUserId?: string; // For Supabase Auth sessions
}

export const auth = {
  // Initialize default admin if it doesn't exist
  async initializeDefaultAdmin(): Promise<void> {
    try {
      const users = await api.users.getAll();
      const adminExists = users.some(u => u.username === DEFAULT_ADMIN.username && u.role === 'admin');
      
      if (!adminExists) {
        // Create default admin
        await api.users.create({
          username: DEFAULT_ADMIN.username,
          password: DEFAULT_ADMIN.password,
          role: 'admin'
        });
      }
    } catch (error) {
      console.warn('Error initializing default admin:', error);
    }
  },

  // Login with username, password, and CAPTCHA
  async login(username: string, password: string, captchaAnswer: number, captchaExpected: number): Promise<AuthSession> {
    // Verify CAPTCHA
    if (captchaAnswer !== captchaExpected) {
      throw new Error('Invalid CAPTCHA. Please try again.');
    }

    // Check database users (including default admin if already initialized)
    try {
      const user = await api.users.authenticate(username, password);
      
      if (!user && username === DEFAULT_ADMIN.username && password === DEFAULT_ADMIN.password) {
        // If database auth fails but credentials match default, initialize and try again
        await this.initializeDefaultAdmin();
        const retryUser = await api.users.authenticate(username, password);
        if (retryUser) {
          return await this.createStaffSession(retryUser);
        }
      }

      if (!user) {
        throw new Error('Invalid username or password');
      }

      return await this.createStaffSession(user);
    } catch (error: any) {
      throw new Error(error.message || 'Invalid username or password');
    }
  },

  // Logout
  async logout(): Promise<void> {
    const session = this.getSession();
    if (session && session.role !== 'patient') {
      try {
        await activeStaffPresence.markInactive(session);
      } catch (error) {
        console.warn('Unable to clear active staff presence during logout. Continuing local logout.', error);
      }
    }

    if (session?.staffAuthToken) {
      try {
        await api.users.revokeAuthSession(session.staffAuthToken);
      } catch (error) {
        console.warn('Unable to revoke the server staff session during logout. Continuing local logout.', error);
      }
    }

    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_USER_KEY);
    localStorage.removeItem(SESSION_INSTANCE_KEY);
  },

  // Get current session
  getSession(): AuthSession | null {
    try {
      if (isRecoveryFlowActive()) {
        return null;
      }

      const sessionStr = localStorage.getItem(SESSION_KEY);
      if (!sessionStr) return null;
      
      const session: AuthSession = JSON.parse(sessionStr);
      if (!session.clientSessionId) {
        session.clientSessionId = getOrCreateSessionInstanceId();
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      }
      // Keep users signed in on this device for up to one year.
      if (Date.now() - session.loginTime > SESSION_MAX_AGE_MS) {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(SESSION_USER_KEY);
        localStorage.removeItem(SESSION_INSTANCE_KEY);
        return null;
      }
      return session;
    } catch {
      return null;
    }
  },

  // Check if user is authenticated
  isAuthenticated(): boolean {
    return this.getSession() !== null;
  },

  // Check if user is admin
  isAdmin(): boolean {
    const session = this.getSession();
    return session?.role === 'admin' || false;
  },

  // Set session
  setSession(session: AuthSession): void {
    const sessionWithClientId: AuthSession = {
      ...session,
      clientSessionId: session.clientSessionId || getOrCreateSessionInstanceId()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionWithClientId));
  },

  // Get current user
  getCurrentUser(): AuthSession | null {
    return this.getSession();
  },

  // Patient login with email, phone, username, or name + password.
  // Patient portal authentication now uses the app's patient_auth table only.
  async patientLogin(identifier: string, password: string): Promise<AuthSession> {
    try {
      const trimmedIdentifier = identifier.trim();
      const patient = await api.patients.authenticate(trimmedIdentifier, password);
      if (!patient) {
        throw new Error('Invalid credentials. Please check your email, phone, or username and password.');
      }

      const session: AuthSession = {
        userId: patient.id,
        username: patient.name,
        role: 'patient',
        location_id: patient.location_id || null,
        loginTime: Date.now(),
        patientId: patient.id
      };

      this.setSession(session);
      return session;
    } catch (error: any) {
      console.error('Patient login error:', error);
      throw new Error(error.message || 'Invalid patient credentials');
    }
  },

  // Check if user is patient
  isPatient(): boolean {
    const session = this.getSession();
    return session?.role === 'patient' || false;
  },

  // Get current patient ID
  getCurrentPatientId(): string | null {
    const session = this.getSession();
    return session?.patientId || null;
  },

  // Supabase Auth is no longer used for patient login/signup/reset.
  async getSupabaseSession() {
    return null;
  },

  async restoreSupabaseSession(): Promise<AuthSession | null> {
    return null;
  },

  async refreshStaffSession(): Promise<AuthSession | null> {
    const currentSession = this.getSession();
    if (!currentSession || currentSession.role === 'patient') return currentSession;

    let currentUser = await api.users.getById(currentSession.userId);
    // Older doctor-only logins stored doctors.id as userId. After the database
    // repair creates the linked staff user, migrate those cached sessions to
    // the canonical users.id instead of forcing the doctor to log in again.
    if (!currentUser && currentSession.role === 'doctor' && currentSession.doctor_id) {
      currentUser = await api.users.getByDoctorId(currentSession.doctor_id);
    }
    if (!currentUser) {
      await this.logout();
      return null;
    }

    const isDoctorUser = Boolean(currentUser.doctor_id);
    const refreshedSession: AuthSession = {
      ...currentSession,
      userId: currentUser.id,
      username: currentUser.username,
      role: isDoctorUser ? 'doctor' : currentUser.role,
      allowed_tabs: isDoctorUser
        ? [...DOCTOR_DASHBOARD_TABS]
        : resolveAllowedTabs(currentUser.role, currentUser.allowed_tabs),
      location_id: currentUser.location_id || null,
      doctor_id: currentUser.doctor_id || null
    };

    this.setSession(refreshedSession);
    return refreshedSession;
  },

  // Patient/staff sessions are managed in localStorage; Supabase Auth is not used for app login.
  onAuthStateChange(_callback: (session: AuthSession | null) => void) {
    return {
      data: {
        subscription: {
          unsubscribe: () => {}
        }
      }
    };
  },

  async createStaffSession(user: User): Promise<AuthSession> {
    const isDoctorUser = Boolean(user.doctor_id);
    const resolvedRole: AuthSession['role'] = isDoctorUser ? 'doctor' : user.role;
    const session: AuthSession = {
      userId: user.id,
      username: user.username,
      role: resolvedRole,
      allowed_tabs: isDoctorUser ? [...DOCTOR_DASHBOARD_TABS] : resolveAllowedTabs(user.role, user.allowed_tabs),
      location_id: user.location_id || null,
      doctor_id: user.doctor_id || null,
      loginTime: Date.now(),
      clientSessionId: getOrCreateSessionInstanceId(),
      staffAuthToken: user.auth_session_token
    };

    this.setSession(session);

    try {
      await activeStaffPresence.markActive(session);
    } catch (error) {
      console.warn('Unable to update active staff presence during login. Continuing authenticated session.', error);
    }

    return session;
  }
};

