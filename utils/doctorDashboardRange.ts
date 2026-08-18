import type { Appointment, ClinicalRecord, DoctorEarningEntry } from '../types';

export interface DoctorDashboardRange {
  start: string;
  end: string;
}

export type DoctorDashboardRangePreset = 'today' | 'week' | 'month';

const pad = (value: number) => String(value).padStart(2, '0');
const finiteAmount = (value: unknown): number => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

export const toLocalDateTimeInput = (date: Date): string => (
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
);

export const toLocalDateKey = (date: Date): string => (
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
);

export const createDoctorDashboardRange = (
  preset: DoctorDashboardRangePreset,
  now = new Date()
): DoctorDashboardRange => {
  const end = new Date(now);
  const start = new Date(now);

  if (preset === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (preset === 'week') {
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }

  return {
    start: toLocalDateTimeInput(start),
    end: toLocalDateTimeInput(end)
  };
};

export const parseLocalDateTimeInput = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return toLocalDateTimeInput(parsed) === value ? parsed : null;
};

export const validateDoctorDashboardRange = (
  range: DoctorDashboardRange
): { start: Date; end: Date; startDateKey: string; endDateKey: string } | null => {
  const start = parseLocalDateTimeInput(range.start);
  const end = parseLocalDateTimeInput(range.end);
  if (!start || !end || start.getTime() > end.getTime()) return null;

  return {
    start,
    end,
    startDateKey: toLocalDateKey(start),
    endDateKey: toLocalDateKey(end)
  };
};

const parseAppointmentDateTime = (appointment: Appointment): Date | null => {
  const rawTime = String(appointment.time || '');
  if (!/^\d{2}:\d{2}/.test(rawTime)) return null;
  const time = rawTime.slice(0, 5);
  return parseLocalDateTimeInput(`${appointment.date}T${time}`);
};

export const isAppointmentInDoctorDashboardRange = (
  appointment: Appointment,
  range: DoctorDashboardRange
): boolean => {
  const validRange = validateDoctorDashboardRange(range);
  const scheduledAt = parseAppointmentDateTime(appointment);
  return Boolean(
    validRange &&
    scheduledAt &&
    scheduledAt.getTime() >= validRange.start.getTime() &&
    scheduledAt.getTime() <= validRange.end.getTime()
  );
};

export const isTreatmentInDoctorDashboardRange = (
  record: ClinicalRecord,
  range: DoctorDashboardRange
): boolean => {
  const validRange = validateDoctorDashboardRange(range);
  if (!validRange) return false;

  if (record.created_at) {
    const createdAt = new Date(record.created_at);
    if (Number.isFinite(createdAt.getTime())) {
      return createdAt.getTime() >= validRange.start.getTime()
        && createdAt.getTime() <= validRange.end.getTime();
    }
  }

  // Historical records may only have a clinical date. Include them when that
  // calendar day intersects the selected local range rather than discarding them.
  return /^\d{4}-\d{2}-\d{2}$/.test(record.date)
    && record.date >= validRange.startDateKey
    && record.date <= validRange.endDateKey;
};

export const isCommissionEntryInDoctorDashboardRange = (
  entry: DoctorEarningEntry,
  range: DoctorDashboardRange
): boolean => {
  const validRange = validateDoctorDashboardRange(range);
  if (!validRange || !/^\d{4}-\d{2}-\d{2}$/.test(entry.paymentDate)) return false;

  // Commission accounting is payment-date based and has day precision. Include
  // both boundary dates regardless of the selected boundary times.
  return entry.paymentDate >= validRange.startDateKey
    && entry.paymentDate <= validRange.endDateKey;
};

export interface DoctorDashboardRangeSummary {
  treatments: ClinicalRecord[];
  completedAppointments: Appointment[];
  treatedPatientCount: number;
  proceeds: number;
  commission: number;
  treatmentDistribution: Array<{ name: string; count: number }>;
}

export const buildDoctorDashboardRangeSummary = (
  appointments: Appointment[],
  treatmentRecords: ClinicalRecord[],
  range: DoctorDashboardRange
): DoctorDashboardRangeSummary => {
  if (!validateDoctorDashboardRange(range)) {
    return {
      treatments: [],
      completedAppointments: [],
      treatedPatientCount: 0,
      proceeds: 0,
      commission: 0,
      treatmentDistribution: []
    };
  }

  const treatments = treatmentRecords.filter((record) => (
    isTreatmentInDoctorDashboardRange(record, range)
  ));
  const completedAppointments = appointments.filter((appointment) => (
    appointment.status === 'Completed'
    && isAppointmentInDoctorDashboardRange(appointment, range)
  ));
  const treatmentCounts = new Map<string, number>();
  treatments.forEach((record) => {
    const name = (record.description || 'Unknown').trim() || 'Unknown';
    treatmentCounts.set(name, (treatmentCounts.get(name) || 0) + 1);
  });

  return {
    treatments,
    completedAppointments,
    treatedPatientCount: new Set(treatments.map((record) => record.patient_id)).size,
    proceeds: treatments.reduce((sum, record) => sum + finiteAmount(record.cost), 0),
    commission: treatmentRecords
      .flatMap((record) => record.doctorEarningEntries || [])
      .filter((entry) => isCommissionEntryInDoctorDashboardRange(entry, range))
      .reduce((sum, entry) => sum + finiteAmount(entry.earnings), 0),
    treatmentDistribution: Array.from(treatmentCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([name, count]) => ({
        name: name.length > 22 ? `${name.slice(0, 22)}...` : name,
        count
      }))
  };
};