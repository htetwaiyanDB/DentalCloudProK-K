import type { Appointment, AppointmentRescheduleLog, ClinicalRecord, PaymentRecord } from '../types';
import { Currency, formatCurrency } from './currency';
import { filterAuditRowsByDateRange } from './auditLogFilters';
import { formatTeethArray, formatTeethWithPosition } from './toothNumbering';
import { formatPaymentAllocations, formatPaymentMethod } from './paymentMethods';
import { formatDoctorName } from './doctorName';
import { allocateCommissionablePayments, calculateCommissionLedgerEntries } from './doctorCommissionLedger';
import { getPaymentTreatmentIds, getPaymentTreatmentShare } from './paymentTreatmentAllocation';

export type AuditFilter = 'all' | 'appointments' | 'reschedules' | 'treatments' | 'payments';

export type AuditExportRow =
  | { kind: 'treatment'; sortDate: string; record: ClinicalRecord & { _groupedRecords?: ClinicalRecord[] } }
  | { kind: 'appointment'; sortDate: string; appointment: Appointment }
  | { kind: 'reschedule'; sortDate: string; rescheduleLog: AppointmentRescheduleLog }
  | { kind: 'payment'; sortDate: string; payment: PaymentRecord & { _treatmentDiscountAmount?: number } };

export interface AuditLogFilterOptions {
  auditFilter?: AuditFilter;
  dateFrom?: string;
  dateTo?: string;
  searchTerm?: string;
}

export interface AuditLogExportTableRow {
  type: 'Appointment' | 'Rescheduled Appointment' | 'Treatment' | 'Payment';
  dateTime: string;
  patient: string;
  clinician: string;
  activity: string;
  recordedBy: string;
  patientType: string;
  patientBalance: string;
  amount: number | null;
  discount: number | null;
  serviceCharges: number | null;
  doctorEarned: number | null;
  paymentMethod: string;
}

const getPositiveNumber = (value: unknown): number => {
  const numericValue = Number(value || 0);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
};

const getTreatmentDiscount = (record?: ClinicalRecord): number => {
  if (!record) return 0;
  const explicitDiscount = getPositiveNumber(record.discountAmount);
  if (explicitDiscount > 0) return explicitDiscount;
  return Math.max(0, getPositiveNumber(record.standardCost) - getPositiveNumber(record.cost));
};

export const getAuditPaymentDiscount = (
  payment: PaymentRecord & { _treatmentDiscountAmount?: number }
): number => {
  const snapshotDiscount = (payment.receiptSnapshot?.treatments || []).reduce(
    (sum, treatment) => {
      const explicitDiscount = getPositiveNumber(treatment.discountAmount);
      const derivedDiscount = Math.max(
        0,
        getPositiveNumber(treatment.standardCost) - getPositiveNumber(treatment.finalCost)
      );
      return sum + (explicitDiscount > 0 ? explicitDiscount : derivedDiscount);
    },
    0
  );
  return snapshotDiscount > 0
    ? snapshotDiscount
    : getPositiveNumber(payment._treatmentDiscountAmount);
};

const getPaymentServiceFeeAmount = (payment: PaymentRecord): number => {
  const snapshotFee = getPositiveNumber(payment.receiptSnapshot?.payment?.serviceFeeAmount);
  if (snapshotFee > 0) return snapshotFee;

  return getPositiveNumber((payment as PaymentRecord & { serviceFeeAmount?: number }).serviceFeeAmount);
};

const calculateTreatmentServiceCharges = (
  treatmentRecords: ClinicalRecord[],
  payments: PaymentRecord[],
  appointments: Appointment[]
): number => {
  if (treatmentRecords.length === 0) return 0;

  const patientId = treatmentRecords[0].patient_id;
  const treatmentDate = treatmentRecords[0].date;
  const treatmentIds = new Set(treatmentRecords.map((record) => record.id).filter(Boolean));
  let serviceChargeTotal = 0;

  payments.forEach((payment) => {
    if (payment.patientId !== patientId) return;

    const paymentTreatmentIds = payment.treatmentIds || [];
    const hasPaymentTreatmentIds = paymentTreatmentIds.length > 0;
    const matchesTreatmentId = paymentTreatmentIds.some((treatmentId) => treatmentIds.has(treatmentId));
    const matchesTreatmentVisitDate = (payment.date || '') === treatmentDate;
    if (hasPaymentTreatmentIds ? !matchesTreatmentId : !matchesTreatmentVisitDate) return;

    const serviceFeeAmount = getPaymentServiceFeeAmount(payment);
    if (serviceFeeAmount <= 0) return;

    // Service fees are configured once per patient visit. Multiple partial,
    // retried, or legacy payment rows may contain the same fee snapshot, so
    // summing every match can turn a 10,000 fee into 20,000 in the Audit Log.
    serviceChargeTotal = Math.max(serviceChargeTotal, serviceFeeAmount);
  });

  if (serviceChargeTotal > 0) return serviceChargeTotal;

  appointments.forEach((appointment) => {
    if (appointment.patient_id !== patientId) return;
    if (appointment.status !== 'Completed') return;
    if ((appointment.date || '') !== treatmentDate) return;
    if (appointment.clinical_fee_status && appointment.clinical_fee_status !== 'APPLIED') return;

    const clinicalFeeAmount = getPositiveNumber(appointment.clinical_fee_amount);
    if (clinicalFeeAmount <= 0) return;

    serviceChargeTotal = Math.max(serviceChargeTotal, clinicalFeeAmount);
  });

  return serviceChargeTotal;
};

export const formatAuditCreatedAt = (value?: string | null): string => {
  if (!value) return 'Unknown';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
};

export const formatAuditPatientBalance = (balance: number | null | undefined, currency: Currency): string => {
  if (balance === null || balance === undefined) return '-';
  const numericBalance = Number(balance || 0);
  return numericBalance > 0 ? formatCurrency(numericBalance, currency) : 'Clear';
};

const formatAuditDoctorName = (doctorName?: string | null): string => {
  return formatDoctorName(doctorName);
};

export const buildAuditLogRows = (
  records: ClinicalRecord[],
  appointments: Appointment[] = [],
  includeAppointments = true,
  payments: PaymentRecord[] = [],
  rescheduleLogs: AppointmentRescheduleLog[] = []
): AuditExportRow[] => {
  const groupedTreatmentMap = new Map<string, ClinicalRecord[]>();

  records.forEach((record) => {
    const key = `${record.patient_id || ''}|${record.date || ''}`;
    if (!groupedTreatmentMap.has(key)) {
      groupedTreatmentMap.set(key, []);
    }
    groupedTreatmentMap.get(key)!.push(record);
  });

  const treatmentRows: AuditExportRow[] = [];
  groupedTreatmentMap.forEach((group) => {
    const sorted = [...group].sort((a, b) => {
      const dateCmp = (a.date || '').localeCompare(b.date || '');
      return dateCmp || (a.description || '').localeCompare(b.description || '');
    });
    const base: ClinicalRecord & { _groupedRecords?: ClinicalRecord[] } = { ...sorted[0] };
    const allDescriptions = sorted.map((record) => record.description).filter(Boolean);
    const allTeeth = sorted.flatMap((record) => record.teeth || []);
    const totalCost = sorted.reduce((sum, record) => sum + (record.cost || 0), 0);
    const totalDiscount = sorted.reduce((sum, record) => sum + getTreatmentDiscount(record), 0);
    const totalStandardCost = sorted.reduce((sum, record) => sum + getPositiveNumber(record.standardCost ?? record.cost), 0);
    const totalEarnings = sorted.reduce((sum, record) => sum + (record.doctorEarnings || 0), 0);
    const patientType = sorted.find((record) => (record.patient_type || '').trim())?.patient_type || base.patient_type || null;

    base.description = allDescriptions.join(' + ');
    base.teeth = [...new Set(allTeeth)].sort((a, b) => a - b);
    base.cost = totalCost;
    base.standardCost = totalStandardCost;
    base.discountAmount = totalDiscount;
    base.doctorEarnings = totalEarnings > 0 ? totalEarnings : base.doctorEarnings;
    base.patient_type = patientType;
    base.serviceCharges = calculateTreatmentServiceCharges(sorted, payments, appointments);
    base._groupedRecords = sorted;

    treatmentRows.push({
      kind: 'treatment',
      sortDate: `${base.date || ''}T23:59:59`,
      record: base
    });
  });

  const appointmentRows: AuditExportRow[] = includeAppointments
    ? appointments.map((appointment) => ({
        kind: 'appointment',
        sortDate: appointment.created_at || `${appointment.date || ''}T${appointment.time || '00:00:00'}`,
        appointment
      }))
    : [];

  const treatmentById = new Map(records.map((record) => [record.id, record]));
  const doctorEarningsByPayment = new Map<string, number>();
  records.forEach((record) => {
    (record.doctorEarningEntries || []).forEach((entry) => {
      // Legacy totals belong only to the treatment and cannot identify the
      // payment that earned them. Actual ledger rows remain the source of truth.
      if (!entry.paymentId || entry.paymentId.startsWith('legacy-')) return;
      doctorEarningsByPayment.set(
        entry.paymentId,
        (doctorEarningsByPayment.get(entry.paymentId) || 0) + getPositiveNumber(entry.earnings)
      );
    });
  });
  const fallbackCommissionEntries = calculateCommissionLedgerEntries(
    records.map((record) => ({
      id: record.id,
      patientId: record.patient_id,
      doctorId: record.doctor_id,
      treatmentTypeId: record.treatment_type_id,
      date: record.date,
      cost: getPositiveNumber(record.cost),
      commissionType: record.doctor_commission_type,
      specialization: record.doctor_specialization,
      commissionPercentage: record.doctor_commission_percentage,
      commissionPerVisit: record.doctor_commission_per_visit
    })),
    allocateCommissionablePayments(
      records.map((record) => ({
        id: record.id,
        patientId: record.patient_id,
        doctorId: record.doctor_id,
        treatmentTypeId: record.treatment_type_id,
        date: record.date,
        cost: getPositiveNumber(record.cost),
        commissionType: record.doctor_commission_type,
        specialization: record.doctor_specialization,
        commissionPercentage: record.doctor_commission_percentage,
        commissionPerVisit: record.doctor_commission_per_visit
      })),
      payments.map((payment) => ({
        id: payment.id,
        patientId: payment.patientId,
        date: payment.date,
        createdAt: payment.createdAt,
        commissionableAmount: getPaymentTreatmentShare(payment),
        treatmentIds: getPaymentTreatmentIds(payment)
      }))
    )
  );
  const fallbackDoctorEarningsByPayment = new Map<string, number>();
  fallbackCommissionEntries.forEach((entry) => {
    fallbackDoctorEarningsByPayment.set(
      entry.paymentId,
      (fallbackDoctorEarningsByPayment.get(entry.paymentId) || 0) + getPositiveNumber(entry.earnings)
    );
  });
  const paymentRows: AuditExportRow[] = includeAppointments
    ? payments.map((payment) => ({
        kind: 'payment',
        sortDate: payment.createdAt || `${payment.date || ''}T23:59:58`,
        payment: {
          ...payment,
          _treatmentDiscountAmount: [...new Set(payment.treatmentIds || [])].reduce(
            (sum, treatmentId) => sum + getTreatmentDiscount(treatmentById.get(treatmentId)),
            0
          ),
          doctorEarned: doctorEarningsByPayment.has(payment.id)
            ? doctorEarningsByPayment.get(payment.id) || 0
            : fallbackDoctorEarningsByPayment.get(payment.id) || 0
        }
      }))
    : [];

  const appointmentById = new Map(appointments.map((appointment) => [appointment.id, appointment]));
  const rescheduleRows: AuditExportRow[] = includeAppointments
    ? rescheduleLogs.map((rescheduleLog) => {
        const appointment = appointmentById.get(rescheduleLog.appointment_id);
        const snapshotName = (rescheduleLog.patient_name || '').trim();
        const resolvedPatientName = snapshotName && snapshotName.toLowerCase() !== 'unknown'
          ? snapshotName
          : appointment?.patient_name || appointment?.guest_name || 'Unknown';

        return {
          kind: 'reschedule',
          sortDate: rescheduleLog.created_at || `${rescheduleLog.new_date || ''}T23:59:57`,
          rescheduleLog: { ...rescheduleLog, patient_name: resolvedPatientName }
        };
      })
    : [];

  return [...treatmentRows, ...appointmentRows, ...paymentRows, ...rescheduleRows].sort((a, b) => b.sortDate.localeCompare(a.sortDate));
};

export const filterAuditLogRowsForExport = <T extends AuditExportRow>(rows: T[], options: AuditLogFilterOptions): T[] => {
  const scopedRows = rows.filter((row) => {
    if (options.auditFilter === 'appointments') return row.kind === 'appointment';
    if (options.auditFilter === 'reschedules') return row.kind === 'reschedule';
    if (options.auditFilter === 'treatments') return row.kind === 'treatment';
    if (options.auditFilter === 'payments') return row.kind === 'payment';
    return true;
  });

  const dateScopedRows = options.dateFrom && options.dateTo
    ? filterAuditRowsByDateRange(scopedRows, options.dateFrom, options.dateTo)
    : scopedRows;

  const term = (options.searchTerm || '').trim().toLowerCase();
  if (!term) return dateScopedRows;

  return dateScopedRows.filter((row) => {
    if (row.kind === 'treatment') {
      const record = row.record;
      return (
        (record.patient_name || '').toLowerCase().includes(term) ||
        (record.doctor_name || '').toLowerCase().includes(term) ||
        (record.description || '').toLowerCase().includes(term) ||
        (record.date || '').toLowerCase().includes(term) ||
        formatTeethArray(record.teeth || []).toLowerCase().includes(term) ||
        (record.teeth || []).some((tooth) => tooth.toString().includes(term))
      );
    }

    if (row.kind === 'payment') {
      const payment = row.payment;
      return (
        (payment.patient_name || '').toLowerCase().includes(term) ||
        (payment.createdByUserName || '').toLowerCase().includes(term) ||
        (payment.allocations?.length ? formatPaymentAllocations(payment.allocations) : formatPaymentMethod(payment.paymentMethod)).toLowerCase().includes(term) ||
        (payment.receiptNumber || '').toLowerCase().includes(term) ||
        (payment.date || '').toLowerCase().includes(term)
      );
    }

    if (row.kind === 'reschedule') {
      const rescheduleLog = row.rescheduleLog;
      return (
        (rescheduleLog.patient_name || '').toLowerCase().includes(term) ||
        (rescheduleLog.doctor_name || '').toLowerCase().includes(term) ||
        (rescheduleLog.admin_name || '').toLowerCase().includes(term) ||
        (rescheduleLog.reason || '').toLowerCase().includes(term) ||
        (rescheduleLog.original_date || '').toLowerCase().includes(term) ||
        (rescheduleLog.new_date || '').toLowerCase().includes(term) ||
        (rescheduleLog.created_at || '').toLowerCase().includes(term)
      );
    }

    const appointment = row.appointment;
    return (
      (appointment.patient_name || '').toLowerCase().includes(term) ||
      (appointment.doctor_name || '').toLowerCase().includes(term) ||
      (appointment.created_by_user_name || '').toLowerCase().includes(term) ||
      (appointment.type || '').toLowerCase().includes(term) ||
      (appointment.status || '').toLowerCase().includes(term) ||
      (appointment.date || '').toLowerCase().includes(term) ||
      (appointment.time || '').toLowerCase().includes(term) ||
      (appointment.created_at || '').toLowerCase().includes(term)
    );
  });
};

export const buildAuditLogExportTableRows = (rows: AuditExportRow[], currency: Currency): AuditLogExportTableRow[] => {
  return rows.map((row) => {
    if (row.kind === 'appointment') {
      const appointment = row.appointment;
      return {
        type: 'Appointment',
        dateTime: `${appointment.date || '-'} ${appointment.time || ''}`.trim(),
        patient: appointment.patient_name || 'Unknown',
        clinician: formatAuditDoctorName(appointment.doctor_name),
        activity: `Appointment made for ${appointment.date || '-'} at ${appointment.time || '-'} (${appointment.type || 'Checkup'}, ${appointment.status || '-'})`,
        recordedBy: `${appointment.created_by_user_name || 'Unknown'}\n${formatAuditCreatedAt(appointment.created_at)}`,
        patientType: '-',
        patientBalance: formatAuditPatientBalance(appointment.patient_balance, currency),
        amount: null,
        discount: null,
        serviceCharges: null,
        doctorEarned: null,
        paymentMethod: '-'
      };
    }

    if (row.kind === 'reschedule') {
      const rescheduleLog = row.rescheduleLog;
      return {
        type: 'Rescheduled Appointment',
        dateTime: formatAuditCreatedAt(rescheduleLog.created_at),
        patient: rescheduleLog.patient_name || 'Unknown',
        clinician: formatAuditDoctorName(rescheduleLog.doctor_name),
        activity: `Original Date: ${rescheduleLog.original_date || '-'} -> New Date: ${rescheduleLog.new_date || '-'}\nReason: ${rescheduleLog.reason || '-'}`,
        recordedBy: `${rescheduleLog.admin_name || 'Unknown'}\n${formatAuditCreatedAt(rescheduleLog.created_at)}`,
        patientType: '-',
        patientBalance: '-',
        amount: null,
        discount: null,
        serviceCharges: null,
        doctorEarned: null,
        paymentMethod: '-'
      };
    }

    if (row.kind === 'payment') {
      const payment = row.payment;
      return {
        type: 'Payment',
        dateTime: formatAuditCreatedAt(payment.createdAt || payment.date),
        patient: payment.patient_name || 'Unknown',
        clinician: '-',
        activity: `Patient paid ${formatCurrency(payment.amount, currency)}${payment.receiptNumber ? ` (${payment.receiptNumber})` : ''}`,
        recordedBy: payment.createdByUserName || 'Unknown',
        patientType: '-',
        patientBalance: formatAuditPatientBalance(payment.remainingBalance, currency),
        amount: payment.amount,
        discount: getAuditPaymentDiscount(payment) || null,
        serviceCharges: null,
        doctorEarned: getPositiveNumber(payment.doctorEarned) || null,
        paymentMethod: payment.allocations?.length ? formatPaymentAllocations(payment.allocations) : formatPaymentMethod(payment.paymentMethod)
      };
    }

    const record = row.record;
    const groupedRecords = record._groupedRecords && record._groupedRecords.length > 0 ? record._groupedRecords : [record];
    const activityLines = groupedRecords.map((groupedRecord) => `• ${groupedRecord.description}`).join('\n');
    const teethLabel = record.teeth && record.teeth.length > 0 ? formatTeethWithPosition(record.teeth) : 'General';

    return {
      type: 'Treatment',
      dateTime: record.date || '-',
      patient: record.patient_name || 'Unknown',
      clinician: formatAuditDoctorName(record.doctor_name),
      activity: `${activityLines}\nTeeth: ${teethLabel}`,
      recordedBy: 'Clinical record',
      patientType: record.patient_type || '-',
      patientBalance: formatAuditPatientBalance(record.patient_balance, currency),
      amount: record.cost || 0,
      discount: getTreatmentDiscount(record) || null,
      serviceCharges: getPositiveNumber(record.serviceCharges) || null,
      doctorEarned: record.doctorEarnings || null,
      paymentMethod: '-'
    };
  });
};
