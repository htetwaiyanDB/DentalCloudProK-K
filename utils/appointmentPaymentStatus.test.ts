import { describe, expect, it } from 'vitest';
import type { Appointment, PaymentRecord } from '../types';
import {
  applyPaymentToAppointmentSummary,
  buildAppointmentPaymentReconciliation,
  filterAppointmentsByPendingPayment,
  summarizeAppointmentPayment,
  type AppointmentPaymentTreatment
} from './appointmentPaymentStatus';

const appointment = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: 'appointment-1',
  location_id: 'location-1',
  patient_id: 'patient-1',
  patient_name: 'Aye Aye',
  doctor_id: 'doctor-1',
  doctor_name: 'Doctor One',
  date: '2026-11-16',
  time: '10:00',
  type: 'Consultation',
  status: 'Completed',
  ...overrides
});

const treatment = (overrides: Partial<AppointmentPaymentTreatment> = {}): AppointmentPaymentTreatment => ({
  id: 'treatment-1',
  patient_id: 'patient-1',
  date: '2026-11-16',
  cost: 100_000,
  appointment_id: 'appointment-1',
  ...overrides
});

const payment = (overrides: Partial<PaymentRecord> = {}): PaymentRecord => {
  const amount = overrides.amount ?? 100_000;
  return {
    id: 'payment-1',
    location_id: 'location-1',
    patientId: 'patient-1',
    patient_name: 'Aye Aye',
    amount,
    clearedAmount: amount,
    treatmentIds: ['treatment-1'],
    date: '2026-11-16',
    type: amount >= 100_000 ? 'FULL' : 'PARTIAL',
    remainingBalance: 0,
    paymentMethod: 'CASH',
    ...overrides
  };
};

describe('appointment payment status', () => {
  it('marks a completed appointment with no payment record as Payment Pending', () => {
    const summary = summarizeAppointmentPayment({
      appointment: appointment(),
      treatments: [treatment()],
      payments: []
    });

    expect(summary.payment_status).toBe('PENDING');
    expect(summary.visit_total).toBe(100_000);
    expect(summary.paid_amount).toBe(0);
    expect(summary.payment_due).toBe(100_000);
  });

  it('marks a completed appointment with full payment as Paid', () => {
    const summary = summarizeAppointmentPayment({
      appointment: appointment(),
      treatments: [treatment()],
      payments: [payment({ amount: 100_000 })]
    });

    expect(summary.payment_status).toBe('PAID');
    expect(summary.paid_amount).toBe(100_000);
    expect(summary.payment_due).toBe(0);
  });

  it('marks a completed appointment with partial payment as Partial with the due balance', () => {
    const summary = summarizeAppointmentPayment({
      appointment: appointment(),
      treatments: [treatment()],
      payments: [payment({ amount: 40_000, type: 'PARTIAL' })]
    });

    expect(summary.payment_status).toBe('PARTIAL');
    expect(summary.paid_amount).toBe(40_000);
    expect(summary.payment_due).toBe(60_000);
  });

  it('ignores voided payments and non-completed appointments', () => {
    const voided = summarizeAppointmentPayment({
      appointment: appointment(),
      treatments: [treatment()],
      payments: [payment({ amount: 100_000, voidedAt: '2026-11-16T12:00:00.000Z' })]
    });
    expect(voided.payment_status).toBe('PENDING');

    const scheduled = summarizeAppointmentPayment({
      appointment: appointment({ status: 'Scheduled' }),
      treatments: [treatment()],
      payments: []
    });
    expect(scheduled.payment_status).toBe('NOT_APPLICABLE');
  });
});
describe('daily appointment payment reconciliation', () => {
  const paidAppointment = appointment({ id: 'appointment-paid', patient_id: 'patient-paid', time: '09:00' });
  const partialAppointment = appointment({ id: 'appointment-partial', patient_id: 'patient-partial', time: '10:00' });
  const pendingAppointment = appointment({ id: 'appointment-pending', patient_id: 'patient-pending', time: '11:00' });
  const scheduledAppointment = appointment({ id: 'appointment-scheduled', patient_id: 'patient-scheduled', time: '12:00', status: 'Scheduled' });
  const otherDayAppointment = appointment({ id: 'appointment-other-day', patient_id: 'patient-other', time: '13:00', date: '2026-11-15' });

  const treatments = [
    treatment({ id: 'treatment-paid', patient_id: 'patient-paid', appointment_id: 'appointment-paid', cost: 100_000 }),
    treatment({ id: 'treatment-partial', patient_id: 'patient-partial', appointment_id: 'appointment-partial', cost: 80_000 }),
    treatment({ id: 'treatment-pending', patient_id: 'patient-pending', appointment_id: 'appointment-pending', cost: 50_000 }),
    treatment({ id: 'treatment-scheduled', patient_id: 'patient-scheduled', appointment_id: 'appointment-scheduled', cost: 90_000 }),
    treatment({ id: 'treatment-other-day', patient_id: 'patient-other', appointment_id: 'appointment-other-day', date: '2026-11-15', cost: 70_000 })
  ];
  const payments = [
    payment({ id: 'payment-paid', patientId: 'patient-paid', amount: 100_000, treatmentIds: ['treatment-paid'] }),
    payment({ id: 'payment-partial', patientId: 'patient-partial', amount: 30_000, type: 'PARTIAL', treatmentIds: ['treatment-partial'] })
  ];

  it('builds date-based Completed / Paid / Payment Pending totals', () => {
    const reconciliation = buildAppointmentPaymentReconciliation({
      appointments: [paidAppointment, partialAppointment, pendingAppointment, scheduledAppointment, otherDayAppointment],
      treatments,
      payments,
      date: '2026-11-16'
    });

    expect(reconciliation).toEqual({
      date: '2026-11-16',
      completed: 3,
      paid: 1,
      partial: 1,
      pending: 2,
      pendingAppointmentIds: ['appointment-partial', 'appointment-pending']
    });
  });

  it('filters the list to the completed appointments with no payment or unpaid balance', () => {
    const reconciliation = buildAppointmentPaymentReconciliation({
      appointments: [paidAppointment, partialAppointment, pendingAppointment, scheduledAppointment, otherDayAppointment],
      treatments,
      payments,
      date: '2026-11-16'
    });
    const cancelledAppointment = appointment({ id: 'appointment-cancelled', patient_id: 'patient-cancelled', status: 'Cancelled' });
    const rows = [
      { ...paidAppointment, payment_status: 'PAID' as const, visit_total: 100_000, paid_amount: 100_000, payment_due: 0 },
      { ...partialAppointment, payment_status: 'PARTIAL' as const, visit_total: 80_000, paid_amount: 30_000, payment_due: 50_000 },
      { ...pendingAppointment, payment_status: 'PENDING' as const, visit_total: 50_000, paid_amount: 0, payment_due: 50_000 },
      { ...scheduledAppointment, payment_status: 'NOT_APPLICABLE' as const },
      { ...cancelledAppointment, payment_status: 'NOT_APPLICABLE' as const }
    ];

    const filtered = filterAppointmentsByPendingPayment(rows, reconciliation.pendingAppointmentIds);
    expect(filtered.map((row) => row.id)).toEqual(['appointment-partial', 'appointment-pending']);
  });

  it('updates a row immediately after a payment is recorded', () => {
    const pendingRow = { ...pendingAppointment, payment_status: 'PENDING' as const, visit_total: 50_000, paid_amount: 0, payment_due: 50_000 };
    const partialRow = applyPaymentToAppointmentSummary(pendingRow, 20_000);
    expect(partialRow.payment_status).toBe('PARTIAL');
    expect(partialRow.payment_due).toBe(30_000);

    const paidRow = applyPaymentToAppointmentSummary(partialRow, 30_000);
    expect(paidRow.payment_status).toBe('PAID');
    expect(paidRow.payment_due).toBe(0);
  });
});


describe('existing historical records', () => {
  it('does not treat a payment for an older visit as payment for a newer completed visit', () => {
    const olderTreatment = treatment({
      id: 'treatment-older',
      appointment_id: 'appointment-older',
      date: '2026-11-01',
      cost: 100_000
    });
    const visitTreatment = treatment({
      id: 'treatment-newer',
      appointment_id: 'appointment-1',
      date: '2026-11-16',
      cost: 50_000
    });
    const summary = summarizeAppointmentPayment({
      appointment: appointment(),
      treatments: [olderTreatment, visitTreatment],
      payments: [payment({
        id: 'payment-older',
        date: '2026-11-01',
        amount: 100_000,
        treatmentIds: ['treatment-older']
      })]
    });

    expect(summary.payment_status).toBe('PENDING');
    expect(summary.payment_due).toBe(50_000);
  });
});

