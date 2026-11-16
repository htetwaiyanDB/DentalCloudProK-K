import type {
  Appointment,
  AppointmentPaymentReconciliation,
  AppointmentPaymentStatus,
  PaymentRecord
} from '../types';
import { allocateCommissionablePayments } from './doctorCommissionLedger';
import { getPaymentTreatmentIds, getPaymentTreatmentShare } from './paymentTreatmentAllocation';

export interface AppointmentPaymentTreatment {
  id: string;
  patient_id: string;
  date: string;
  cost: number;
  appointment_id?: string | null;
}

export interface AppointmentPaymentSummary {
  payment_status: AppointmentPaymentStatus;
  visit_total: number;
  paid_amount: number;
  payment_due: number;
}

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const positiveMoney = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
};

/**
 * Treatments that belong to an appointment visit.
 *
 * Newer treatment rows carry `appointment_id`. Older rows only carry the
 * patient/date pair, so they fall back to the same patient + same day (and are
 * excluded when they are explicitly linked to another appointment that day).
 */
export const getAppointmentVisitTreatments = (
  appointment: Pick<Appointment, 'id' | 'patient_id' | 'date'>,
  treatments: AppointmentPaymentTreatment[]
): AppointmentPaymentTreatment[] => {
  if (!appointment.patient_id) return [];

  const linked = treatments.filter((treatment) => treatment.appointment_id === appointment.id);
  const unlinkedSameDay = treatments.filter((treatment) => (
    treatment.patient_id === appointment.patient_id &&
    treatment.date === appointment.date &&
    !treatment.appointment_id
  ));

  return Array.from(new Map([...linked, ...unlinkedSameDay].map((treatment) => [treatment.id, treatment])).values());
};

const summarizeVisitPayment = ({
  appointment,
  visitTreatments,
  patientTreatments,
  patientPayments
}: {
  appointment: Appointment;
  visitTreatments: AppointmentPaymentTreatment[];
  patientTreatments: AppointmentPaymentTreatment[];
  patientPayments: PaymentRecord[];
}): AppointmentPaymentSummary => {
  const visitTotal = roundMoney(
    visitTreatments.reduce((sum, treatment) => sum + positiveMoney(treatment.cost), 0)
  );
  const visitTreatmentIds = new Set(visitTreatments.map((treatment) => treatment.id));

  // Reuse the same FIFO allocation the commission ledger and payment
  // validation use. Explicitly linked treatments are covered first, then any
  // remaining amount is applied to the oldest outstanding visit for that
  // patient. This keeps partial and legacy payments consistent everywhere.
  const allocations = allocateCommissionablePayments(
    patientTreatments.map((treatment) => ({
      id: treatment.id,
      patientId: treatment.patient_id,
      date: treatment.date,
      cost: positiveMoney(treatment.cost)
    })),
    patientPayments.map((payment) => ({
      id: payment.id,
      patientId: payment.patientId,
      date: payment.date || appointment.date,
      createdAt: payment.createdAt || null,
      commissionableAmount: getPaymentTreatmentShare(payment),
      treatmentIds: getPaymentTreatmentIds(payment)
    }))
  );

  let paidAmount = roundMoney(
    allocations
      .filter((allocation) => visitTreatmentIds.has(allocation.treatmentId))
      .reduce((sum, allocation) => sum + positiveMoney(allocation.amount), 0)
  );

  // A treatment can be removed/re-created after a receipt was stored. When the
  // allocator cannot map that receipt, fall back to the receipt snapshot so a
  // completed and already-paid visit is not shown as pending.
  if (paidAmount <= 0 && visitTotal > 0) {
    const linkedPayments = patientPayments.filter((payment) => (
      getPaymentTreatmentIds(payment).some((treatmentId) => visitTreatmentIds.has(treatmentId))
    ));
    if (linkedPayments.length > 0) {
      const snapshotValue = linkedPayments.reduce((sum, payment) => (
        sum + (payment.receiptSnapshot?.treatments || [])
          .filter((line) => visitTreatmentIds.has(line.id))
          .reduce((lineSum, line) => lineSum + positiveMoney(line.finalCost), 0)
      ), 0);
      const fallbackValue = snapshotValue > 0
        ? snapshotValue
        : linkedPayments.reduce((sum, payment) => sum + getPaymentTreatmentShare(payment), 0);
      paidAmount = roundMoney(Math.min(visitTotal, fallbackValue));
    }
  }

  const hasVisitPayment = patientPayments.some((payment) => (
    getPaymentTreatmentIds(payment).some((treatmentId) => visitTreatmentIds.has(treatmentId)) ||
    (!getPaymentTreatmentIds(payment).length && payment.date === appointment.date)
  ));

  // A completed visit with no priced treatment (for example a waived or
  // service-fee-only visit) can only be considered paid when a payment exists.
  const paymentStatus: AppointmentPaymentStatus = visitTotal <= 0
    ? (hasVisitPayment ? 'PAID' : 'PENDING')
    : paidAmount >= visitTotal - 0.005
      ? 'PAID'
      : paidAmount > 0
        ? 'PARTIAL'
        : 'PENDING';

  return {
    payment_status: paymentStatus,
    visit_total: visitTotal,
    paid_amount: roundMoney(Math.min(visitTotal, paidAmount)),
    payment_due: roundMoney(Math.max(0, visitTotal - paidAmount))
  };
};

/**
 * Derives the payment status of one appointment without writing anything to the
 * database. Appointment status and payment status stay separate.
 */
export const summarizeAppointmentPayment = ({
  appointment,
  treatments,
  payments
}: {
  appointment: Appointment;
  treatments: AppointmentPaymentTreatment[];
  payments: PaymentRecord[];
}): AppointmentPaymentSummary => {
  if (appointment.status !== 'Completed' || !appointment.patient_id) {
    return { payment_status: 'NOT_APPLICABLE', visit_total: 0, paid_amount: 0, payment_due: 0 };
  }

  const patientTreatments = treatments.filter((treatment) => treatment.patient_id === appointment.patient_id);
  const patientPayments = payments.filter((payment) => payment.patientId === appointment.patient_id && !payment.voidedAt);
  const visitTreatments = getAppointmentVisitTreatments(appointment, patientTreatments);

  return summarizeVisitPayment({ appointment, visitTreatments, patientTreatments, patientPayments });
};

export const isAppointmentPaymentOutstanding = (appointment: Appointment): boolean => (
  appointment.status === 'Completed' &&
  (appointment.payment_status === 'PENDING' || appointment.payment_status === 'PARTIAL')
);

/**
 * The "View Pending Payments" filter. Pending appointment ids from the day
 * reconciliation are authoritative, with the row status used as a fallback.
 */
export const filterAppointmentsByPendingPayment = (
  appointments: Appointment[],
  pendingAppointmentIds: Iterable<string> = []
): Appointment[] => {
  const pendingIds = new Set(pendingAppointmentIds);
  return appointments.filter((appointment) => (
    pendingIds.has(appointment.id) || isAppointmentPaymentOutstanding(appointment)
  ));
};

/**
 * Builds the Completed / Paid / Payment Pending counters for one visit day.
 * Appointments are already loaded for that day by the API; the date guard
 * keeps the totals correct when a caller passes a wider range.
 */
export const buildAppointmentPaymentReconciliation = ({
  appointments,
  treatments,
  payments,
  date
}: {
  appointments: Appointment[];
  treatments: AppointmentPaymentTreatment[];
  payments: PaymentRecord[];
  date: string;
}): AppointmentPaymentReconciliation => {
  const dayAppointments = appointments
    .filter((appointment) => (
      appointment.date === date &&
      appointment.status === 'Completed' &&
      !!appointment.patient_id
    ))
    .sort((a, b) => (a.time || '').localeCompare(b.time || '') || a.id.localeCompare(b.id));

  let paid = 0;
  let partial = 0;
  let pending = 0;
  const pendingAppointmentIds: string[] = [];

  dayAppointments.forEach((appointment) => {
    const summary = summarizeAppointmentPayment({ appointment, treatments, payments });
    if (summary.payment_status === 'PAID') {
      paid += 1;
      return;
    }

    pending += 1;
    pendingAppointmentIds.push(appointment.id);
    if (summary.payment_status === 'PARTIAL') partial += 1;
  });

  return {
    date,
    completed: dayAppointments.length,
    paid,
    partial,
    pending,
    pendingAppointmentIds
  };
};

/**
 * Optimistically applies a just-recorded payment to an appointment row so the
 * list can change from "Payment Pending" to "Paid" before the background
 * refresh finishes.
 */
export const applyPaymentToAppointmentSummary = (
  appointment: Appointment,
  paymentAmount: number
): Appointment => {
  const visitTotal = positiveMoney(appointment.visit_total);
  const paidAmount = roundMoney(positiveMoney(appointment.paid_amount) + positiveMoney(paymentAmount));
  const paymentDue = roundMoney(Math.max(0, visitTotal - paidAmount));

  let paymentStatus: AppointmentPaymentStatus;
  if (appointment.status !== 'Completed' || !appointment.patient_id) {
    paymentStatus = 'NOT_APPLICABLE';
  } else if (visitTotal <= 0) {
    paymentStatus = paidAmount > 0 ? 'PAID' : appointment.payment_status || 'PENDING';
  } else if (paymentDue <= 0.005) {
    paymentStatus = 'PAID';
  } else {
    paymentStatus = paidAmount > 0 ? 'PARTIAL' : 'PENDING';
  }

  return {
    ...appointment,
    payment_status: paymentStatus,
    visit_total: visitTotal,
    paid_amount: roundMoney(Math.min(visitTotal, paidAmount)),
    payment_due: paymentDue
  };
};

