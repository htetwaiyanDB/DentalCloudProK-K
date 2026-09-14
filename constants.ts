// Only keeping chart-specific configuration or static metadata
export const mockRevenueData = [
  { name: 'Mon', value: 2400 },
  { name: 'Tue', value: 1398 },
  { name: 'Wed', value: 9800 },
  { name: 'Thu', value: 3908 },
  { name: 'Fri', value: 4800 },
  { name: 'Sat', value: 3800 },
  { name: 'Sun', value: 4300 },
];

export const TREATMENT_CATEGORIES = [
  'Preventative',
  'Restorative',
  'Cosmetic',
  'Surgery',
  'Orthodontics'
] as const;

export const DEFAULT_PATIENT_TYPE_NAME = 'Walk-in';
export const AUTO_ONP_PATIENT_TYPE_NAME = 'ONP';

export const DEFAULT_PATIENT_TYPE_OPTIONS = [
  'Walk-in',
  'ONP',
  'RNP',
  'OTP',
  'Hotline',
  'Rec-ph call',
  'Tiktok',
  'Tiktok Hotline'
] as const;

export const DEFAULT_APPOINTMENT_TYPE_OPTIONS = [
  'Consult',
  'Check Up'
] as const;

export const FLEXIBLE_STAFF_TABS = [
  {
    key: 'dashboard',
    label: 'Overview',
    description: 'Dashboard insights and clinic summary.'
  },
  {
    key: 'patients',
    label: 'Patients',
    description: 'Patient profiles and patient management.'
  },
  {
    key: 'appointments',
    label: 'Appointments',
    description: 'Appointment schedules and booking flow.'
  },
  {
    key: 'doctors',
    label: 'Doctors',
    description: 'Doctor directory and schedule management.'
  },
  {
    key: 'finance',
    label: 'Clinical Focus',
    description: 'Treatment workflow, billing, and payments.'
  },
  {
    key: 'treatments',
    label: 'Service Menu',
    description: 'Treatment types and service configuration.'
  },
  {
    key: 'material-cost',
    label: 'MLS',
    description: 'Track Material, Lab & Special Cost items with linked expense impact.'
  },
  {
    key: 'records',
    label: 'Audit Log',
    description: 'Clinical records and audit trail review.'
  },
  {
    key: 'expenses',
    label: 'Expenses',
    description: 'Operating expenses and cost tracking.'
  },
  {
    key: 'inventory',
    label: 'Inventory',
    description: 'Medicine stock and inventory operations.'
  },
  {
    key: 'messaging',
    label: 'Messaging',
    description: 'Patient conversations and staff replies.'
  },
  {
    key: 'ai-assistant',
    label: 'AI Assistant',
    description: 'Loli AI assistant workspace.'
  },
  {
    key: 'branch-switching',
    label: 'Branch Switching',
    description: 'Switch the active branch without access to system settings.'
  }
] as const;

export const MANAGER_ONLY_TABS = ['users', 'settings'] as const;

export type FlexibleStaffTab = typeof FLEXIBLE_STAFF_TABS[number]['key'];
export type ManagerOnlyTab = typeof MANAGER_ONLY_TABS[number];
export type AppTabPermission = FlexibleStaffTab | ManagerOnlyTab;

export const DEFAULT_NORMAL_TAB_PERMISSIONS: FlexibleStaffTab[] = [
  'dashboard',
  'patients',
  'appointments',
  'doctors',
  'finance',
  'ai-assistant'
];

export const ALL_APP_TAB_PERMISSIONS: AppTabPermission[] = [
  ...FLEXIBLE_STAFF_TABS.map(tab => tab.key),
  ...MANAGER_ONLY_TABS
];

export const FULL_ACCESS_TAB_PERMISSIONS: AppTabPermission[] = ALL_APP_TAB_PERMISSIONS.filter(
  (tab) => tab !== 'branch-switching'
);

export const DOCTOR_DASHBOARD_TABS: AppTabPermission[] = [
  'dashboard',
  'appointments',
  'records',
  'settings'
];
