import { describe, expect, it } from 'vitest';
import type { Appointment, ClinicalRecord, DoctorEarningEntry } from '../types';
import {
  buildDoctorDashboardRangeSummary,
  createDoctorDashboardRange,
  isAppointmentInDoctorDashboardRange,
  isCommissionEntryInDoctorDashboardRange,
  isTreatmentInDoctorDashboardRange,
  parseLocalDateTimeInput,
  validateDoctorDashboardRange
} from './doctorDashboardRange';

const range = { start: '2026-08-01T00:00', end: '2026-08-08T12:00' };

const appointment = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: 'appointment-1',
  location_id: 'location-1',
  date: '2026-08-08',
  time: '09:00',
  type: 'Consultation',
  status: 'Completed',
  ...overrides
});

const treatment = (overrides: Partial<ClinicalRecord> = {}): ClinicalRecord => ({
  id: 'treatment-1',
  location_id: 'location-1',
  patient_id: 'patient-1',
  teeth: [],
  description: 'Filling',
  cost: 100,
  date: '2026-08-08',
  ...overrides
});

const commission = (overrides: Partial<DoctorEarningEntry> = {}): DoctorEarningEntry => ({
  paymentId: 'payment-1',
  treatmentId: 'treatment-1',
  doctorId: 'doctor-1',
  paymentDate: '2026-08-08',
  treatmentDate: '2026-08-08',
  calculationMode: 'percentage',
  allocatedPayment: 100,
  commissionRate: 10,
  earnings: 10,
  ...overrides
});

describe('doctor dashboard date-time range', () => {
  it('creates current-month, week, and today presets in local time', () => {
    const now = new Date(2026, 7, 8, 14, 35);
    expect(createDoctorDashboardRange('month', now)).toEqual({
      start: '2026-08-01T00:00',
      end: '2026-08-08T14:35'
    });
    expect(createDoctorDashboardRange('week', now).start).toBe('2026-08-03T00:00');
    expect(createDoctorDashboardRange('today', now).start).toBe('2026-08-08T00:00');
  });

  it('rejects malformed, impossible, and reversed ranges', () => {
    expect(parseLocalDateTimeInput('2026-02-30T10:00')).toBeNull();
    expect(parseLocalDateTimeInput('2026-08-08')).toBeNull();
    expect(validateDoctorDashboardRange({ start: '2026-08-08T12:01', end: '2026-08-08T12:00' })).toBeNull();
  });

  it('includes appointments exactly on both boundaries', () => {
    expect(isAppointmentInDoctorDashboardRange(appointment({ date: '2026-08-01', time: '00:00' }), range)).toBe(true);
    expect(isAppointmentInDoctorDashboardRange(appointment({ time: '12:00' }), range)).toBe(true);
    expect(isAppointmentInDoctorDashboardRange(appointment({ time: '12:01' }), range)).toBe(false);
    expect(isAppointmentInDoctorDashboardRange(appointment({ time: 'invalid' }), range)).toBe(false);
  });

  it('uses treatment creation timestamps and safely falls back to legacy clinical dates', () => {
    expect(isTreatmentInDoctorDashboardRange(treatment({ created_at: '2026-08-08T11:59:00' }), range)).toBe(true);
    expect(isTreatmentInDoctorDashboardRange(treatment({ created_at: '2026-08-08T12:01:00' }), range)).toBe(false);
    expect(isTreatmentInDoctorDashboardRange(treatment({ created_at: 'invalid', date: '2026-08-01' }), range)).toBe(true);
    expect(isTreatmentInDoctorDashboardRange(treatment({ created_at: undefined, date: '2026-07-31' }), range)).toBe(false);
  });

  it('includes commission boundary calendar dates because the ledger has day precision', () => {
    const narrowRange = { start: '2026-08-08T11:59', end: '2026-08-08T12:00' };
    expect(isCommissionEntryInDoctorDashboardRange(commission(), narrowRange)).toBe(true);
    expect(isCommissionEntryInDoctorDashboardRange(commission({ paymentDate: '2026-08-07' }), narrowRange)).toBe(false);
    expect(isCommissionEntryInDoctorDashboardRange(commission({ paymentDate: 'invalid' }), narrowRange)).toBe(false);
  });

  it('builds range totals, unique patients, completed appointments, and sorted treatment distribution', () => {
    const records = [
      treatment({ id: 't1', patient_id: 'p1', cost: 100, description: 'Filling', created_at: '2026-08-02T09:00:00', doctorEarningEntries: [commission({ earnings: 10 })] }),
      treatment({ id: 't2', patient_id: 'p1', cost: 50, description: 'Filling', created_at: '2026-08-03T09:00:00' }),
      treatment({ id: 't3', patient_id: 'p2', cost: 80, description: 'Cleaning', created_at: '2026-08-04T09:00:00' }),
      treatment({ id: 'outside', patient_id: 'p3', cost: 999, created_at: '2026-07-01T09:00:00', doctorEarningEntries: [commission({ paymentDate: '2026-07-01', earnings: 99 })] })
    ];
    const summary = buildDoctorDashboardRangeSummary([
      appointment(),
      appointment({ id: 'scheduled', status: 'Scheduled' }),
      appointment({ id: 'outside', date: '2026-08-09' })
    ], records, range);

    expect(summary.treatments).toHaveLength(3);
    expect(summary.completedAppointments).toHaveLength(1);
    expect(summary.treatedPatientCount).toBe(2);
    expect(summary.proceeds).toBe(230);
    expect(summary.commission).toBe(10);
    expect(summary.treatmentDistribution).toEqual([
      { name: 'Filling', count: 2 },
      { name: 'Cleaning', count: 1 }
    ]);
  });

  it('returns a safe empty summary for invalid ranges', () => {
    const summary = buildDoctorDashboardRangeSummary(
      [appointment()],
      [treatment()],
      { start: 'bad', end: 'also-bad' }
    );
    expect(summary.treatments).toEqual([]);
    expect(summary.proceeds).toBe(0);
    expect(summary.commission).toBe(0);
  });

  it('does not allow invalid historical amounts to produce NaN totals', () => {
    const summary = buildDoctorDashboardRangeSummary([], [
      treatment({ cost: Number.NaN, doctorEarningEntries: [commission({ earnings: Number.NaN })] })
    ], range);
    expect(summary.proceeds).toBe(0);
    expect(summary.commission).toBe(0);
  });
});