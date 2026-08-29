import type { AppTabPermission } from './constants';
import type { Currency } from './utils/currency';
import type { DoctorCommissionType } from './utils/doctorCommission';

export interface Location {
  id: string;
  name: string;
  address: string;
  phone: string;
  created_at?: string;
}

export interface Patient {
  id: string;
  patient_unique_id?: string;
  location_id: string;
  name: string;
  email: string;
  phone: string;
  age?: number;
  address?: string;
  city?: string;
  township?: string;
  patient_type?: string;
  lastVisit?: string;
  balance: number;
  loyalty_points: number;
  medicalHistory?: string;
  created_at?: string;
  has_account?: boolean;
  username?: string | null;
}

export interface PatientType {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface PatientFile {
  path: string;           // storage path e.g. patientId/filename.ext
  name: string;           // file name
  size: number;           // bytes
  type: string;           // mime type
  uploaded_at?: string;   // storage timestamp
  url: string;            // public URL for download/view
}

export interface TreatmentType {
  id: string; // Database ID
  location_id: string;
  name: string; // Display name (e.g., "Root Canal")
  cost: number;
  category: string;
}

export interface TreatmentChargeLine {
  teeth: number[];
  cost: number;
  standardCost: number;
}

export interface ClinicalRecord {
  id: string;
  location_id: string;
  patient_id: string;
  patient_name?: string; // Joined field for global view
  patient_unique_id?: string; // Joined field for global view
  patient_type?: string | null; // Joined field for audit log patient type display
  patient_balance?: number; // Joined field for audit log balance/debt display
  serviceCharges?: number; // Audit-only calculated patient service charge total for this treatment visit
  doctor_id?: string;
  doctor_name?: string; // Joined field for clinical ownership
  doctor_specialization?: string | null;
  doctor_commission_type?: DoctorCommissionType | null;
  doctor_commission_percentage?: number | null;
  doctor_commission_per_visit?: number | null;
  treatment_type_id?: string | null;
  teeth: number[];
  description: string;
  cost: number;
  standardCost?: number | null;
  discountAmount?: number;
  pricingNote?: 'FOC' | 'DISCOUNT' | null;
  doctorEarnings?: number; // Calculated commission for this treatment
  doctorEarningEntries?: DoctorEarningEntry[];
  date: string;
  created_at?: string;
}

export interface DoctorEarningEntry {
  id?: string;
  paymentId: string;
  treatmentId: string;
  doctorId: string;
  paymentDate: string;
  treatmentDate: string;
  calculationMode: 'percentage' | 'flat_visit';
  allocatedPayment: number;
  commissionRate: number;
  earnings: number;
}

export type AuditLogSourceType = 'treatment' | 'payment' | 'appointment' | 'reschedule';

export interface AuditLogEntry {
  id: string;
  sourceType: AuditLogSourceType;
  sourceId: string;
  location_id?: string | null;
  patient_id?: string | null;
  doctor_id?: string | null;
  treatment_id?: string | null;
  created_at?: string;
}

export type TreatmentCostType = 'material' | 'lab';

export interface PatientMaterialCost {
  id: string;
  auditLogId: string;
  materialName: string;
  costType: TreatmentCostType;
  costAmount: number;
  quantity: number;
  totalAmount: number;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PatientMaterialCostInput {
  materialName: string;
  costType: TreatmentCostType;
  costAmount: number;
  quantity: number;
}

export interface MaterialLabCostPreset {
  id: string;
  costType: TreatmentCostType;
  label: string;
  amount: number;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface MaterialLabCostPresetInput {
  id: string;
  costType: TreatmentCostType;
  label: string;
  amount: number;
  sortOrder: number;
}

export interface TreatmentCostSummary {
  auditLogId: string;
  materialTotal: number;
  materialItemCount: number;
  labTotal: number;
  labItemCount: number;
  totalAmount: number;
  itemCount: number;
}

export interface PaymentRecord {
  id: string;
  location_id?: string;
  patientId: string;
  patient_name?: string;
  patient_type?: string | null;
  amount: number;
  originalAmount?: number;
  clearedAmount?: number;
  treatmentIds?: string[];
  date: string;
  type: 'FULL' | 'PARTIAL';
  balanceBefore?: number;
  remainingBalance: number;
  patientCurrentBalance?: number;
  paymentMethod?: PaymentMethod;
  allocations?: PaymentAllocation[];
  receiptNumber?: string;
  receiptSnapshot?: PaymentReceiptSnapshot | null;
  createdAt?: string;
  createdByUserId?: string | null;
  createdByUserName?: string | null;
  corrections?: PaymentCorrection[];
}

export interface PaymentCorrection {
  id: string;
  paymentId: string;
  oldAmount: number;
  newAmount: number;
  oldMethod?: PaymentMethod | null;
  newMethod?: PaymentMethod | null;
  oldAllocations?: PaymentAllocation[];
  newAllocations?: PaymentAllocation[];
  reason: string;
  editedBy: string;
  editedAt: string;
  editorName?: string | null;
}

export interface PaymentAllocation {
  id?: string;
  paymentId?: string;
  method: PaymentMethod;
  amount: number;
  reference?: string | null;
}

export interface PaymentReceiptTreatmentLine {
  id: string;
  date: string;
  description: string;
  teeth: number[];
  finalCost: number;
  standardCost: number;
  discountAmount: number;
  pricingNote?: 'FOC' | 'DISCOUNT' | null;
}

export interface PaymentReceiptMedicineLine {
  id: string;
  date: string;
  medicineName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  standardTotal?: number;
  discountAmount?: number;
  pricingNote?: 'FOC' | 'DISCOUNT' | null;
}

export interface PaymentReceiptSnapshot {
  version: 1 | 2;
  allocationReconciled?: true;
  receiptType: 'PAYMENT';
  receiptNumber: string;
  receiptDate: string;
  createdAt?: string | null;
  currency: Currency;
  clinic: {
    appName: string;
    headerTitle: string;
    email: string;
    phone: string;
  };
  patient: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    patientUniqueId?: string;
  };
  payment: {
    amountPaid: number;
    method: PaymentMethod;
    allocations?: PaymentAllocation[];
    status: 'FULL' | 'PARTIAL';
    balanceBefore: number;
    balanceAfter: number;
    serviceFeeAmount?: number;
    serviceFeeCategory?: 'NEW' | 'RETURNING' | null;
    recordedByUserName?: string | null;
  };
  treatments?: PaymentReceiptTreatmentLine[];
  medicines?: PaymentReceiptMedicineLine[];
}

export type PaymentMethod =
  | 'KPAY'
  | 'WAVEPAY'
  | 'CASH'
  | 'MMQR'
  | 'DEBIT_CARD'
  | 'CREDIT_CARD'
  | 'AYA_PAY'
  | 'UAB_PAY'
  | 'MIXED'
  | 'UNKNOWN';

export interface DoctorSchedule {
  id: string;
  doctor_id: string;
  day_of_week: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  start_time: string; // HH:MM format
  end_time: string; // HH:MM format
}

// For creating/updating doctors - schedule without doctor_id since it's not known yet
export interface DoctorScheduleInput {
  id?: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface Doctor {
  id: string;
  location_id: string;
  location_ids?: string[];
  name: string;
  email?: string;
  phone?: string;
  specialization?: string;
  password?: string;
  schedules: DoctorSchedule[]; // Array of schedules for different days/times
  commission_type?: DoctorCommissionType;
  commission_percentage?: number; // e.g., 50 means 50% of treatment cost goes to doctor
  commission_per_visit?: number; // Flat amount paid once per patient visit
  custom_commissions?: DoctorTreatmentCommission[];
  created_at?: string;
}

// For creating/updating doctors
export interface DoctorInput {
  id?: string;
  location_id: string;
  location_ids?: string[];
  name: string;
  email?: string;
  phone?: string;
  specialization?: string;
  password?: string;
  schedules?: DoctorScheduleInput[];
  commission_type?: DoctorCommissionType;
  commission_percentage?: number; // e.g., 50 means 50% of treatment cost goes to doctor
  commission_per_visit?: number; // Flat amount paid once per patient visit
  created_at?: string;
}

export interface DoctorTreatmentCommission {
  id?: string;
  doctor_id?: string;
  treatment_id: string;
  commission_rate: number;
  fixed_amount?: number | null;
  created_at?: string;
  updated_at?: string;
  treatment_name?: string;
}

export interface DoctorProfileSaveInput extends Partial<Doctor> {
  custom_commissions?: DoctorTreatmentCommission[];
}

export interface Appointment {
  id: string;
  location_id: string;
  patient_id?: string | null;
  patient_name?: string;
  patient_balance?: number | null;
  doctor_id?: string;
  doctor_name?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  type: string;
  status: 'Scheduled' | 'Completed' | 'Cancelled';
  cancellation_outcome?: CancellationOutcome | null;
  completed_later_appointment_id?: string | null;
  notes?: string;
  guest_name?: string | null;
  guest_phone?: string | null;
  guest_source?: string | null;
  guest_notes?: string | null;
  converted_patient_id?: string | null;
  created_at?: string;
  created_by_user_id?: string | null;
  created_by_user_name?: string | null;
  clinical_fee_status?: 'PENDING' | 'APPLIED' | 'SKIPPED' | 'NOT_APPLICABLE';
  clinical_fee_amount?: number;
  clinical_fee_patient_category?: 'NEW' | 'RETURNING' | null;
  clinical_fee_applied_at?: string | null;
}

export interface DoctorCorrectionTreatmentCandidate {
  id: string;
  description: string;
  date: string;
  doctor_id?: string | null;
  linked_to_appointment: boolean;
  has_financial_history: boolean;
}

export interface DoctorCorrectionPreview {
  appointment_id: string;
  patient_id: string;
  patient_name: string;
  location_id: string;
  visit_date: string;
  visit_time: string;
  status: Appointment['status'];
  old_doctor_id?: string | null;
  old_doctor_name?: string | null;
  treatments: DoctorCorrectionTreatmentCandidate[];
}

export interface DoctorCorrectionResult {
  status: 'success';
  correction_id: string;
  appointment_id: string;
  old_doctor_id?: string | null;
  new_doctor_id: string;
  updated_treatment_count: number;
  updated_audit_count: number;
}

export type CancellationOutcome = 'NO_SHOW' | 'RESCHEDULED' | 'COMPLETED_LATER';

export interface AppointmentRescheduleLog {
  id: string;
  appointment_id: string;
  location_id: string;
  patient_id?: string | null;
  patient_name: string;
  doctor_name?: string | null;
  original_date: string;
  new_date: string;
  reason: string;
  admin_user_id?: string | null;
  admin_name?: string | null;
  created_at?: string;
}

export interface ClinicalFeeSettings {
  enabled: boolean;
  newPatientAmount: number;
  returningPatientAmount: number;
}

export interface ClinicalFeeCompletionResult {
  appointmentId: string;
  feeStatus: 'APPLIED' | 'SKIPPED' | 'NOT_APPLICABLE';
  feeAmount: number;
  patientCategory: 'NEW' | 'RETURNING' | null;
  newBalance: number | null;
}

export interface AppointmentType {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface User {
  id: string;
  location_id: string | null; // null for global admins
  doctor_id?: string | null;
  username: string;
  auth_session_token?: string;
  password?: string; // Only for creation/update, not returned in queries
  role: 'admin' | 'normal';
  allowed_tabs?: AppTabPermission[];
  created_at?: string;
  updated_at?: string;
}

export interface ActiveStaffMonitorEntry {
  session_id: string;
  user_id: string;
  username: string;
  role: 'admin' | 'normal' | 'doctor';
  location_id: string | null;
  location_name?: string | null;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  login_at: string;
  last_seen: string;
}

export interface Medicine {
  id: string;
  location_id: string;
  name: string;
  description?: string;
  unit: string; // e.g., "pack", "bottle", "box"
  item_type?: 'Medicine' | 'Retail' | 'Supply' | 'Other';
  price: number;
  stock: number; // Current stock quantity
  min_stock?: number; // Minimum stock level for alerts
  quantity_step?: number; // Smallest allowed dispense increment (e.g., 0.5 card)
  category?: string; // e.g., "Pain Relief", "Antibiotics", "Supplements"
  created_at?: string;
  updated_at?: string;
}

export interface MedicineSale {
  id: string;
  location_id: string;
  patient_id: string;
  patient_name?: string;
  medicine_id: string;
  medicine_name?: string;
  medicine_unit?: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  standard_total?: number | null;
  discount_amount?: number;
  pricing_note?: 'FOC' | 'DISCOUNT' | null;
  date: string;
  treatment_id?: string; // Optional: link to treatment if sold with treatment
  created_at?: string;
}

export interface ClinicSettings {
  loyalty_enabled: boolean;
  clinical_fee_enabled?: boolean;
  clinical_fee_amount?: number;
  clinical_fee_new_patient_amount?: number;
  clinical_fee_returning_patient_amount?: number;
}

export interface S3Settings {
  url: string;
  accessKey: string;
  secretKey: string;
  region: string;
  updated_at?: string;
}

/**
 * Supabase Storage settings (alternative to S3-compatible API)
 * Uses Supabase REST Storage API directly (no signing required)
 */
export interface SupabaseStorageSettings {
  storageUrl: string;    // e.g., https://your-supabase.supabase.co
  anonKey: string;       // Supabase anon/publishable key
  serviceKey: string;    // Supabase service role key (for server operations)
  bucket: string;        // e.g., patient_files
  updated_at?: string;
}

export interface LoyaltyRule {
  id: string;
  location_id: string;
  name: string;
  event_type: 'TREATMENT' | 'PURCHASE' | 'VISIT' | 'REDEEM';
  points_per_unit: number; // For earned: points per unit of currency. For redeem: units of currency per 1 point.
  min_amount?: number; // Minimum amount to earn or minimum points to redeem
  active: boolean;
}

export interface LoyaltyTransaction {
  id: string;
  patient_id: string;
  location_id: string;
  points: number; // positive for earned, negative for redeemed
  type: 'EARNED' | 'REDEEMED' | 'EXPIRED' | 'REVERSED';
  description: string;
  date: string;
}

export interface Expense {
  id: string;
  location_id: string;
  description: string;
  amount: number;
  category: string;
  date: string;
  source_type?: string | null;
  source_id?: string | null;
  is_system_generated?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Message {
  id: string;
  sender_id: string;
  sender_type: 'patient' | 'admin';
  recipient_id: string;
  recipient_type: 'patient' | 'admin';
  content: string;
  timestamp: string;
  read: boolean;
  conversation_id: string;
}

export interface Conversation {
  id: string;
  patient_id?: string | null;
  doctor_user_id?: string | null;
  participant_type?: 'patient' | 'doctor';
  participant_name?: string;
  patient_name: string;
  admin_id: string;
  admin_name: string;
  last_message?: string;
  last_message_time?: string;
  unread_count: number;
  created_at: string;
}

export interface ScheduledTask {
  id: string;
  location_id: string;
  admin_id?: string | null;
  task_type: 'EMAIL' | 'DAILY_REPORT_EMAIL';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  run_at: string;
  payload: Record<string, any>;
  last_error?: string | null;
  sent_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type ReceiptSize = 'A4' | 'THERMAL_55MM' | 'THERMAL_80MM';

export interface ReceiptPreferences {
  headerTitle: string;
  currency: 'USD' | 'MMK';
  receiptSize: ReceiptSize;
}






