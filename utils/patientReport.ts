import type { Appointment, ClinicalRecord, Doctor, MedicineSale, Patient, PaymentAllocation, PaymentMethod, PaymentRecord } from '../types';
import type { Currency } from './currency';
import { sumMoney } from './money';
import { getReceiptTreatmentAllocationAmount } from './paymentReceipt';

export type PatientReportTimelineKind = 'appointment' | 'treatment' | 'medicine';

export interface PatientReportTimelineItem {
  id: string;
  kind: PatientReportTimelineKind;
  date: string;
  time?: string;
  title: string;
  detail: string;
  status?: Appointment['status'];
  doctorName?: string;
  amount?: number;
}

export interface PatientReportPaymentDetail {
  id: string;
  date: string;
  amount: number;
  paymentMethod?: PaymentMethod;
  allocations?: PaymentAllocation[];
  receiptNumber?: string;
  balanceAfter: number;
}

export interface PatientReportTreatmentLedgerItem {
  id: string;
  date: string;
  name: string;
  teeth: number[];
  doctorName?: string;
  amount: number;
  paid: number | null;
  balance: number | null;
  payments: PatientReportPaymentDetail[];
}

export interface PatientReportSummary {
  visitDates: string[];
  firstVisitDate: string | null;
  lastVisitDate: string | null;
  totalPaid: number | null;
  treatmentValue: number;
  medicineValue: number;
  serviceFeeValue: number;
  careValue: number;
  currentDebt: number;
  treatments: Array<{ name: string; count: number; total: number; dates: string[] }>;
  medicines: Array<{ id: string; name: string; unit?: string; quantity: number; total: number; dates: string[] }>;
  doctors: Array<{ id: string; name: string; appointmentCount: number; treatmentCount: number; dates: string[] }>;
  appointmentStatus: Array<{ name: Appointment['status']; value: number }>;
  appointments: Appointment[];
  treatmentLedger: PatientReportTreatmentLedgerItem[];
  paymentHistory: PaymentRecord[] | null;
  timeline: PatientReportTimelineItem[];
}

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const positiveNumber = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
};
const newestFirst = <T extends { date: string; time?: string; id: string }>(a: T, b: T): number =>
  `${b.date || ''}T${b.time || ''}`.localeCompare(`${a.date || ''}T${a.time || ''}`) || b.id.localeCompare(a.id);

const getPaymentTreatmentIds = (payment: PaymentRecord): string[] => Array.from(new Set([
  ...(payment.treatmentIds || []),
  ...(payment.receiptSnapshot?.treatments || []).map((treatment) => treatment.id)
].filter(Boolean)));

const getPaymentDedupeKey = (payment: PaymentRecord): string => payment.id || payment.receiptNumber || [
  payment.patientId,
  payment.date,
  payment.clearedAmount ?? payment.amount,
  payment.createdAt || '',
  payment.paymentMethod || ''
].join('|');

const getTreatmentShareOfPayment = (payment: PaymentRecord, visibleTreatmentIds: string[]): number => {
  const collected = positiveNumber(payment.clearedAmount ?? payment.amount);
  const snapshot = payment.receiptSnapshot;
  if (!snapshot) return collected;

  const snapshotTreatments = snapshot.treatments || [];
  const treatmentValue = snapshotTreatments.reduce((total, item) => total + positiveNumber(item.finalCost), 0);
  const visibleIds = new Set(visibleTreatmentIds);
  const visibleTreatmentValue = snapshotTreatments
    .filter((item) => visibleIds.has(item.id))
    .reduce((total, item) => total + positiveNumber(item.finalCost), 0);
  if (treatmentValue <= 0 || visibleTreatmentValue <= 0) return 0;
  const treatmentAllocation = getReceiptTreatmentAllocationAmount(collected, snapshot);
  return treatmentValue > 0 ? treatmentAllocation * (visibleTreatmentValue / treatmentValue) : 0;
};

export const buildPatientReport = ({
  patient,
  appointments,
  treatments,
  medicineSales,
  payments,
  doctors,
  currency,
  paymentsAvailable = true
}: {
  patient: Patient;
  appointments: Appointment[];
  treatments: ClinicalRecord[];
  medicineSales: MedicineSale[];
  payments: PaymentRecord[];
  doctors: Doctor[];
  currency: Currency;
  paymentsAvailable?: boolean;
}): PatientReportSummary => {
  const patientAppointments = appointments
    .filter((appointment) => appointment.patient_id === patient.id)
    .sort(newestFirst);
  const patientTreatments = treatments.filter((treatment) => treatment.patient_id === patient.id);
  const patientMedicines = medicineSales.filter((sale) => sale.patient_id === patient.id);
  const patientPayments = Array.from(new Map(
    payments
      .filter((payment) => payment.patientId === patient.id)
      .map((payment) => [getPaymentDedupeKey(payment), payment])
  ).values()).sort(newestFirst);

  const treatmentValue = sumMoney(patientTreatments.map((record) => positiveNumber(record.cost)), currency);
  const medicineValue = sumMoney(patientMedicines.map((sale) => positiveNumber(sale.total_price)), currency);
  const serviceFeeValue = sumMoney(
    patientAppointments
      .filter((appointment) => appointment.clinical_fee_status === 'APPLIED')
      .map((appointment) => positiveNumber(appointment.clinical_fee_amount)),
    currency
  );

  const visitDates = Array.from(new Set([
    ...patientAppointments.filter((appointment) => appointment.status === 'Completed').map((appointment) => appointment.date),
    ...patientTreatments.map((record) => record.date),
    ...patientMedicines.map((sale) => sale.date)
  ].filter(Boolean))).sort((a, b) => b.localeCompare(a));

  const treatmentMap = new Map<string, { name: string; count: number; total: number; dates: Set<string> }>();
  patientTreatments.forEach((record) => {
    const name = clean(record.description) || 'Treatment';
    const key = name.toLocaleLowerCase();
    const current = treatmentMap.get(key) || { name, count: 0, total: 0, dates: new Set<string>() };
    current.count += 1;
    current.total = sumMoney([current.total, positiveNumber(record.cost)], currency);
    if (record.date) current.dates.add(record.date);
    treatmentMap.set(key, current);
  });

  const medicineMap = new Map<string, { id: string; name: string; unit?: string; quantity: number; total: number; dates: Set<string> }>();
  patientMedicines.forEach((sale) => {
    const name = clean(sale.medicine_name) || 'Unknown medicine / item';
    const key = `${sale.medicine_id || ''}:${name.toLocaleLowerCase()}`;
    const current = medicineMap.get(key) || {
      id: sale.medicine_id || key,
      name,
      unit: clean(sale.medicine_unit) || undefined,
      quantity: 0,
      total: 0,
      dates: new Set<string>()
    };
    if (!current.unit && clean(sale.medicine_unit)) current.unit = clean(sale.medicine_unit);
    current.quantity += positiveNumber(sale.quantity);
    current.total = sumMoney([current.total, positiveNumber(sale.total_price)], currency);
    if (sale.date) current.dates.add(sale.date);
    medicineMap.set(key, current);
  });

  const doctorById = new Map(doctors.map((doctor) => [doctor.id, doctor]));
  const doctorMap = new Map<string, { id: string; name: string; appointmentCount: number; treatmentCount: number; dates: Set<string> }>();
  const addDoctorActivity = (doctorId: string, doctorName: string, date: string, source: 'appointment' | 'treatment') => {
    const resolvedName = clean(doctorName) || clean(doctorById.get(doctorId)?.name);
    if (!doctorId && !resolvedName) return;
    const key = doctorId || resolvedName.toLocaleLowerCase();
    const current = doctorMap.get(key) || {
      id: doctorId || key,
      name: resolvedName || 'Doctor not recorded',
      appointmentCount: 0,
      treatmentCount: 0,
      dates: new Set<string>()
    };
    if (source === 'appointment') current.appointmentCount += 1;
    else current.treatmentCount += 1;
    if (date) current.dates.add(date);
    doctorMap.set(key, current);
  };
  patientAppointments.forEach((appointment) => addDoctorActivity(appointment.doctor_id || '', appointment.doctor_name || '', appointment.date, 'appointment'));
  patientTreatments.forEach((record) => addDoctorActivity(record.doctor_id || '', record.doctor_name || '', record.date, 'treatment'));

  const appointmentStatuses: Appointment['status'][] = ['Completed', 'Scheduled', 'Cancelled'];
  const appointmentStatus = appointmentStatuses
    .map((status) => ({ name: status, value: patientAppointments.filter((appointment) => appointment.status === status).length }))
    .filter((entry) => entry.value > 0);

  const treatmentById = new Map(patientTreatments.map((treatment) => [treatment.id, treatment]));
  const treatmentIdsByDate = new Map<string, string[]>();
  patientTreatments.forEach((treatment) => {
    if (!treatment.date) return;
    treatmentIdsByDate.set(treatment.date, [...(treatmentIdsByDate.get(treatment.date) || []), treatment.id]);
  });

  const paymentDetailsByTreatmentId = new Map<string, PatientReportPaymentDetail[]>();
  [...patientPayments].reverse().forEach((payment) => {
    const explicitIds = getPaymentTreatmentIds(payment);
    const linkedIds = (explicitIds.length > 0 ? explicitIds : treatmentIdsByDate.get(payment.date) || [])
      .filter((id) => treatmentById.has(id));
    const remainingByTreatment = linkedIds.map((treatmentId) => {
      const previousDetails = paymentDetailsByTreatmentId.get(treatmentId) || [];
      const previouslyPaid = previousDetails.reduce((total, detail) => total + detail.amount, 0);
      return {
        treatmentId,
        previousDetails,
        remaining: Math.max(0, positiveNumber(treatmentById.get(treatmentId)?.cost) - previouslyPaid)
      };
    }).filter((item) => item.remaining > 0);
    const totalRemaining = remainingByTreatment.reduce((total, item) => total + item.remaining, 0);
    const paymentTreatmentShare = sumMoney([getTreatmentShareOfPayment(payment, linkedIds)], currency);
    let treatmentPayment = Math.min(totalRemaining, paymentTreatmentShare);
    if (remainingByTreatment.length === 0 || treatmentPayment <= 0) return;

    remainingByTreatment.forEach((item, index) => {
      const proportionalAmount = index === remainingByTreatment.length - 1
        ? treatmentPayment
        : Math.min(treatmentPayment, paymentTreatmentShare * (item.remaining / totalRemaining));
      const attributedAmount = Math.min(item.remaining, sumMoney([proportionalAmount], currency));
      if (attributedAmount <= 0) return;
      item.previousDetails.push({
        id: payment.id,
        date: payment.date,
        amount: attributedAmount,
        paymentMethod: payment.paymentMethod,
        allocations: payment.allocations,
        receiptNumber: payment.receiptNumber || payment.receiptSnapshot?.receiptNumber,
        balanceAfter: positiveNumber(payment.patientCurrentBalance ?? payment.remainingBalance)
      });
      treatmentPayment = Math.max(0, sumMoney([treatmentPayment, -attributedAmount], currency));
      paymentDetailsByTreatmentId.set(item.treatmentId, item.previousDetails);
    });
  });

  const treatmentLedger = [...patientTreatments]
    .sort(newestFirst)
    .map((treatment): PatientReportTreatmentLedgerItem => {
      const amount = positiveNumber(treatment.cost);
      const details = (paymentDetailsByTreatmentId.get(treatment.id) || []).sort((a, b) => newestFirst(a, b));
      const paid = sumMoney(details.map((detail) => detail.amount), currency);
      return {
        id: treatment.id,
        date: treatment.date,
        name: clean(treatment.description) || 'Treatment',
        teeth: treatment.teeth || [],
        doctorName: clean(treatment.doctor_name) || clean(doctorById.get(treatment.doctor_id || '')?.name) || undefined,
        amount,
        paid: paymentsAvailable ? paid : null,
        balance: paymentsAvailable ? Math.max(0, sumMoney([amount, -paid], currency)) : null,
        payments: paymentsAvailable ? details : []
      };
    });

  const timeline: PatientReportTimelineItem[] = [
    ...patientAppointments.map((appointment) => ({
      id: `appointment-${appointment.id}`,
      kind: 'appointment' as const,
      date: appointment.date,
      time: appointment.time,
      title: appointment.type || 'Appointment',
      detail: appointment.notes || 'No appointment notes',
      status: appointment.status,
      doctorName: clean(appointment.doctor_name) || clean(doctorById.get(appointment.doctor_id || '')?.name) || undefined
    })),
    ...patientTreatments.map((record) => ({
      id: `treatment-${record.id}`,
      kind: 'treatment' as const,
      date: record.date,
      title: clean(record.description) || 'Treatment',
      detail: record.teeth?.length ? `Teeth: ${record.teeth.join(', ')}` : 'No teeth recorded',
      doctorName: clean(record.doctor_name) || clean(doctorById.get(record.doctor_id || '')?.name) || undefined,
      amount: positiveNumber(record.cost)
    })),
    ...patientMedicines.map((sale) => ({
      id: `medicine-${sale.id}`,
      kind: 'medicine' as const,
      date: sale.date,
      title: clean(sale.medicine_name) || 'Unknown medicine / item',
      detail: `${positiveNumber(sale.quantity)}${clean(sale.medicine_unit) ? ` ${clean(sale.medicine_unit)}` : ''} given`,
      amount: positiveNumber(sale.total_price)
    }))
  ].sort(newestFirst);

  return {
    visitDates,
    firstVisitDate: visitDates.length ? visitDates[visitDates.length - 1] : null,
    lastVisitDate: visitDates[0] || null,
    totalPaid: paymentsAvailable ? sumMoney(patientPayments.map((payment) => positiveNumber(payment.clearedAmount ?? payment.amount)), currency) : null,
    treatmentValue,
    medicineValue,
    serviceFeeValue,
    careValue: sumMoney([treatmentValue, medicineValue, serviceFeeValue], currency),
    currentDebt: positiveNumber(patient.balance),
    treatments: Array.from(treatmentMap.values())
      .map((item) => ({ ...item, dates: Array.from(item.dates).sort((a, b) => b.localeCompare(a)) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    medicines: Array.from(medicineMap.values())
      .map((item) => ({ ...item, dates: Array.from(item.dates).sort((a, b) => b.localeCompare(a)) }))
      .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)),
    doctors: Array.from(doctorMap.values())
      .map((item) => ({ ...item, dates: Array.from(item.dates).sort((a, b) => b.localeCompare(a)) }))
      .sort((a, b) => (b.appointmentCount + b.treatmentCount) - (a.appointmentCount + a.treatmentCount) || a.name.localeCompare(b.name)),
    appointmentStatus,
    appointments: patientAppointments,
    treatmentLedger,
    paymentHistory: paymentsAvailable ? patientPayments : null,
    timeline
  };
};
