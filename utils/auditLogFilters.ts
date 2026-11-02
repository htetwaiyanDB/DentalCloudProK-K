import type { Appointment, AppointmentRescheduleLog, ClinicalRecord, PaymentRecord } from '../types';

export type AuditLogFilterRow =
  | { kind: 'treatment'; sortDate: string; record: Pick<ClinicalRecord, 'date'> }
  | { kind: 'appointment'; sortDate: string; appointment: Pick<Appointment, 'date' | 'created_at'> }
  | { kind: 'reschedule'; sortDate: string; rescheduleLog: Pick<AppointmentRescheduleLog, 'created_at'> }
  | { kind: 'payment'; sortDate: string; payment: Pick<PaymentRecord, 'date' | 'createdAt' | 'voidedAt'> };

export const toLocalISODate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getAuditLogEventDate = (row: AuditLogFilterRow): string => {
  if (row.kind === 'treatment') return row.record.date || '';
  if (row.kind === 'appointment') return row.appointment.date || row.appointment.created_at?.slice(0, 10) || '';
  if (row.kind === 'reschedule') return row.rescheduleLog.created_at?.slice(0, 10) || '';
  return row.payment.voidedAt?.slice(0, 10) || row.payment.date || row.payment.createdAt?.slice(0, 10) || '';
};

export const isDateInRange = (dateStr: string | undefined, dateFrom: string, dateTo: string): boolean => {
  if (!dateStr) return false;
  const dateOnly = dateStr.slice(0, 10);
  return dateOnly >= dateFrom && dateOnly <= dateTo;
};

export const filterAuditRowsByDateRange = <T extends AuditLogFilterRow>(rows: T[], dateFrom: string, dateTo: string): T[] => {
  return rows.filter((row) => isDateInRange(getAuditLogEventDate(row), dateFrom, dateTo));
};
