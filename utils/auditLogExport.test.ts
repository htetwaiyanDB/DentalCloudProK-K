import { describe, expect, it } from 'vitest';
import type { Appointment, AppointmentRescheduleLog, ClinicalRecord, PaymentRecord } from '../types';
import { buildAuditLogExportTableRows, buildAuditLogRows, filterAuditLogRowsForExport, formatAuditPatientBalance } from './auditLogExport';

describe('audit log export rows', () => {
  const records: ClinicalRecord[] = [
    {
      id: 'tr-1',
      location_id: 'loc-1',
      patient_id: 'pat-1',
      patient_name: 'Aung Min',
      patient_type: 'Marketing',
      patient_balance: 15000,
      doctor_name: 'Hnin',
      teeth: [11],
      description: 'Filling',
      cost: 20000,
      standardCost: 25000,
      discountAmount: 5000,
      doctorEarnings: 8000,
      doctorEarningEntries: [{ paymentId: 'pay-1', treatmentId: 'tr-1', doctorId: 'doc-1', paymentDate: '2026-05-30', treatmentDate: '2026-05-30', calculationMode: 'percentage', allocatedPayment: 6000, commissionRate: 10, earnings: 600 }],
      date: '2026-05-30'
    },
    {
      id: 'tr-2',
      location_id: 'loc-1',
      patient_id: 'pat-1',
      patient_name: 'Aung Min',
      patient_type: 'Marketing',
      patient_balance: 15000,
      doctor_name: 'Hnin',
      teeth: [12],
      description: 'Scaling',
      cost: 10000,
      doctorEarnings: 4000,
      doctorEarningEntries: [{ paymentId: 'pay-1', treatmentId: 'tr-2', doctorId: 'doc-1', paymentDate: '2026-05-30', treatmentDate: '2026-05-30', calculationMode: 'percentage', allocatedPayment: 4000, commissionRate: 10, earnings: 400 }],
      date: '2026-05-30'
    },
    {
      id: 'tr-3',
      location_id: 'loc-1',
      patient_id: 'pat-2',
      patient_name: 'Mya Mya',
      patient_balance: 0,
      doctor_name: 'Ko Ko',
      teeth: [],
      description: 'Consultation',
      cost: 5000,
      doctorEarnings: 0,
      date: '2026-05-29'
    }
  ];

  const appointments: Appointment[] = [
    {
      id: 'apt-1',
      location_id: 'loc-1',
      patient_id: 'pat-3',
      patient_name: 'Su Su',
      patient_balance: 0,
      doctor_name: 'Hnin',
      date: '2026-05-30',
      time: '09:30',
      type: 'Checkup',
      status: 'Scheduled',
      created_at: '2026-05-30T08:00:00Z',
      created_by_user_name: 'Reception One'
    },
    {
      id: 'apt-2',
      location_id: 'loc-1',
      patient_name: 'Old Appointment',
      date: '2026-05-28',
      time: '10:00',
      type: 'Follow-up',
      status: 'Completed',
      created_at: '2026-05-28T02:00:00Z',
      created_by_user_name: 'Reception Two'
    }
  ];

  const payments: PaymentRecord[] = [
    {
      id: 'pay-1',
      location_id: 'loc-1',
      patientId: 'pat-1',
      patient_name: 'Aung Min',
      amount: 10000,
      treatmentIds: ['tr-1', 'tr-2'],
      date: '2026-05-30',
      type: 'PARTIAL',
      remainingBalance: 5000,
      paymentMethod: 'KPAY',
      receiptNumber: 'REC-20260530-000001',
      receiptSnapshot: {
        version: 1,
        receiptType: 'PAYMENT',
        receiptNumber: 'REC-20260530-000001',
        receiptDate: '2026-05-30',
        currency: 'MMK',
        clinic: { appName: 'My Dentist', headerTitle: 'Receipt', email: '', phone: '' },
        patient: { id: 'pat-1', name: 'Aung Min' },
        payment: {
          amountPaid: 10000,
          method: 'KPAY',
          status: 'PARTIAL',
          balanceBefore: 15000,
          balanceAfter: 5000,
          serviceFeeAmount: 3000,
          serviceFeeCategory: 'NEW'
        },
        treatments: [
          {
            id: 'tr-1',
            date: '2026-05-30',
            description: 'Filling',
            teeth: [11],
            finalCost: 20000,
            standardCost: 25000,
            discountAmount: 5000,
            pricingNote: 'DISCOUNT'
          }
        ]
      },
      createdAt: '2026-05-30T10:00:00Z',
      createdByUserName: 'Reception One'
    }
  ];

  const rescheduleLogs: AppointmentRescheduleLog[] = [
    {
      id: 'res-1',
      appointment_id: 'apt-1',
      location_id: 'loc-1',
      patient_id: 'pat-3',
      patient_name: 'Su Su',
      doctor_name: 'Hnin',
      original_date: '2026-05-30',
      new_date: '2026-06-02',
      reason: 'Patient did not arrive',
      admin_name: 'Reception One',
      created_at: '2026-05-30T11:00:00Z'
    }
  ];

  it('groups same-patient same-day treatments and includes appointments in audit sort order', () => {
    const rows = buildAuditLogRows(records, appointments, true);

    expect(rows.map((row) => row.kind)).toEqual(['treatment', 'appointment', 'treatment', 'appointment']);

    const groupedTreatment = rows[0];
    expect(groupedTreatment.kind).toBe('treatment');
    if (groupedTreatment.kind === 'treatment') {
      expect(groupedTreatment.record.description).toBe('Filling + Scaling');
      expect(groupedTreatment.record.teeth).toEqual([11, 12]);
      expect(groupedTreatment.record.cost).toBe(30000);
      expect(groupedTreatment.record.doctorEarnings).toBe(12000);
      expect(groupedTreatment.record._groupedRecords).toHaveLength(2);
    }
  });

  it('repairs legacy Unknown reschedule names from the matching appointment', () => {
    const rows = buildAuditLogRows(records, appointments, true, [], [
      {
        ...rescheduleLogs[0],
        appointment_id: 'apt-1',
        patient_name: 'Unknown'
      }
    ]);
    const rescheduleRow = rows.find((row) => row.kind === 'reschedule');

    expect(rescheduleRow?.kind).toBe('reschedule');
    if (rescheduleRow?.kind === 'reschedule') {
      expect(rescheduleRow.rescheduleLog.patient_name).toBe('Su Su');
    }
  });

  it('filters export rows by selected audit tab, date range, and search term', () => {
    const rows = buildAuditLogRows(records, appointments, true);

    const appointmentRows = filterAuditLogRowsForExport(rows, {
      auditFilter: 'appointments',
      dateFrom: '2026-05-30',
      dateTo: '2026-05-30',
      searchTerm: 'Reception One'
    });

    expect(appointmentRows).toHaveLength(1);
    expect(appointmentRows[0].kind).toBe('appointment');
    if (appointmentRows[0].kind === 'appointment') {
      expect(appointmentRows[0].appointment.patient_name).toBe('Su Su');
    }
  });

  it('includes treatment rows throughout an inclusive date range', () => {
    const rows = filterAuditLogRowsForExport(buildAuditLogRows(records, appointments, true), {
      auditFilter: 'treatments',
      dateFrom: '2026-05-29',
      dateTo: '2026-05-30'
    });

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.kind === 'treatment')).toBe(true);
    expect(rows.map((row) => row.kind === 'treatment' ? row.record.date : '')).toEqual(['2026-05-30', '2026-05-29']);
  });

  it('builds PDF/Excel friendly table rows with balances and recorded-by details', () => {
    const rows = filterAuditLogRowsForExport(buildAuditLogRows(records, appointments, true, payments), {
      dateFrom: '2026-05-30',
      dateTo: '2026-05-30'
    });
    const tableRows = buildAuditLogExportTableRows(
      rows.filter((row) => row.kind !== 'payment'),
      'MMK'
    );

    expect(tableRows).toHaveLength(2);
    expect(tableRows[0]).toMatchObject({
      type: 'Treatment',
      patient: 'Aung Min',
      clinician: 'Dr. Hnin',
      patientType: 'Marketing',
      patientBalance: '15,000Ks',
      amount: 30000,
      discount: 5000,
      serviceCharges: 3000,
      doctorEarned: 12000
    });
    expect(tableRows[0].activity).toContain('• Filling');
    expect(tableRows[0].activity).toContain('• Scaling');
    expect(tableRows[0].activity).toContain('Teeth:');

    expect(tableRows[1]).toMatchObject({
      type: 'Appointment',
      patient: 'Su Su',
      recordedBy: expect.stringContaining('Reception One'),
      patientType: '-',
      patientBalance: 'Clear',
      amount: null,
      serviceCharges: null,
      doctorEarned: null
    });
  });

  it('shows the related treatment discount on payment audit rows and exports', () => {
    const rows = buildAuditLogRows(records, appointments, true, payments);
    const paymentRow = rows.find((row) => row.kind === 'payment');

    expect(paymentRow?.kind).toBe('payment');
    if (paymentRow?.kind === 'payment') {
      expect(paymentRow.payment._treatmentDiscountAmount).toBe(5000);
      expect(paymentRow.payment.doctorEarned).toBe(1000);
      expect(buildAuditLogExportTableRows([paymentRow], 'MMK')[0].discount).toBe(5000);
      expect(buildAuditLogExportTableRows([paymentRow], 'MMK')[0].doctorEarned).toBe(1000);
    }
  });

  it('derives legacy receipt discounts and does not double-count duplicate treatment links', () => {
    const legacyPayment: PaymentRecord = {
      ...payments[0],
      id: 'pay-legacy-discount',
      treatmentIds: ['tr-1', 'tr-1'],
      receiptSnapshot: {
        ...payments[0].receiptSnapshot!,
        treatments: [{
          id: 'tr-1',
          date: '2026-05-30',
          description: 'Filling',
          teeth: [11],
          finalCost: 20000,
          standardCost: 25000,
          discountAmount: 0
        }]
      }
    };
    const paymentRow = buildAuditLogRows(records, [], true, [legacyPayment])
      .find((row) => row.kind === 'payment');

    expect(paymentRow?.kind).toBe('payment');
    if (paymentRow?.kind === 'payment') {
      expect(paymentRow.payment._treatmentDiscountAmount).toBe(5000);
      expect(buildAuditLogExportTableRows([paymentRow], 'MMK')[0].discount).toBe(5000);
    }
  });

  it('falls back to applied appointment clinical fee when payment service charge metadata is unavailable', () => {
    const completedAppointment: Appointment = {
      ...appointments[0],
      id: 'apt-service-fee',
      patient_id: 'pat-2',
      patient_name: 'Mya Mya',
      date: '2026-05-29',
      status: 'Completed',
      clinical_fee_status: 'APPLIED',
      clinical_fee_amount: 2000,
      clinical_fee_patient_category: 'RETURNING'
    };
    const rows = buildAuditLogRows([records[2]], [completedAppointment], true, []);
    const treatmentRow = rows.find((row) => row.kind === 'treatment');

    expect(treatmentRow?.kind).toBe('treatment');
    if (treatmentRow?.kind === 'treatment') {
      expect(treatmentRow.record.serviceCharges).toBe(2000);
    }

    const [tableRow] = buildAuditLogExportTableRows(
      rows.filter((row) => row.kind === 'treatment'),
      'MMK'
    );
    expect(tableRow.serviceCharges).toBe(2000);
  });

  it('uses payment service charge metadata carefully without double counting unrelated same-day payments', () => {
    const rows = buildAuditLogRows(
      [records[0]],
      [
        {
          ...appointments[0],
          id: 'apt-duplicate-fallback',
          patient_id: 'pat-1',
          patient_name: 'Aung Min',
          date: '2026-05-30',
          status: 'Completed',
          clinical_fee_status: 'APPLIED',
          clinical_fee_amount: 3000
        }
      ],
      true,
      [
        payments[0],
        { ...payments[0] },
        {
          ...payments[0],
          id: 'pay-unrelated-treatment-same-day',
          treatmentIds: ['different-treatment-id'],
          receiptSnapshot: {
            ...payments[0].receiptSnapshot!,
            payment: {
              ...payments[0].receiptSnapshot!.payment,
              serviceFeeAmount: 7000
            }
          }
        },
        {
          ...payments[0],
          id: 'pay-service-fee-only-same-day',
          treatmentIds: [],
          receiptSnapshot: {
            ...payments[0].receiptSnapshot!,
            payment: {
              ...payments[0].receiptSnapshot!.payment,
              serviceFeeAmount: 1500
            }
          }
        }
      ]
    );
    const treatmentRow = rows.find((row) => row.kind === 'treatment');

    expect(treatmentRow?.kind).toBe('treatment');
    if (treatmentRow?.kind === 'treatment') {
      expect(treatmentRow.record.serviceCharges).toBe(3000);
    }
  });

  it('does not double a per-visit service fee recorded on two matching payments', () => {
    const duplicateFeePayment: PaymentRecord = {
      ...payments[0],
      id: 'pay-duplicate-service-fee',
      receiptSnapshot: {
        ...payments[0].receiptSnapshot!,
        payment: {
          ...payments[0].receiptSnapshot!.payment,
          serviceFeeAmount: 10_000
        }
      }
    };
    const originalFeePayment: PaymentRecord = {
      ...payments[0],
      receiptSnapshot: {
        ...payments[0].receiptSnapshot!,
        payment: {
          ...payments[0].receiptSnapshot!.payment,
          serviceFeeAmount: 10_000
        }
      }
    };

    const rows = buildAuditLogRows([records[0]], [], true, [originalFeePayment, duplicateFeePayment]);
    const treatmentRow = rows.find((row) => row.kind === 'treatment');

    expect(treatmentRow?.kind).toBe('treatment');
    if (treatmentRow?.kind === 'treatment') {
      expect(treatmentRow.record.serviceCharges).toBe(10_000);
    }
  });

  it('can omit appointment rows for doctor/patient-record exports', () => {
    const rows = buildAuditLogRows(records, appointments, false);

    expect(rows.every((row) => row.kind === 'treatment')).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it('formats missing, clear, and debt balances consistently', () => {
    expect(formatAuditPatientBalance(undefined, 'USD')).toBe('-');
    expect(formatAuditPatientBalance(0, 'USD')).toBe('Clear');
    expect(formatAuditPatientBalance(12.5, 'USD')).toBe('12.50$');
  });

  it('includes payment type, receipt, collector, and remaining balance in payment audit rows', () => {
    const rows = buildAuditLogRows(records, appointments, true, payments);
    const paymentRows = filterAuditLogRowsForExport(rows, {
      auditFilter: 'payments',
      dateFrom: '2026-05-30',
      dateTo: '2026-05-30',
      searchTerm: 'KPay'
    });

    expect(paymentRows).toHaveLength(1);
    const [tableRow] = buildAuditLogExportTableRows(paymentRows, 'MMK');
    expect(tableRow).toMatchObject({
      type: 'Payment',
      patient: 'Aung Min',
      recordedBy: 'Reception One',
      patientBalance: '5,000Ks',
      amount: 10000,
      paymentMethod: 'KPay'
    });
    expect(tableRow.activity).toContain('Patient paid 10,000Ks');
    expect(tableRow.activity).toContain('REC-20260530-000001');
  });

  it('includes rescheduled appointments only in the reschedule filter and export rows', () => {
    const rows = buildAuditLogRows(records, appointments, true, payments, rescheduleLogs);
    const appointmentRows = filterAuditLogRowsForExport(rows, {
      auditFilter: 'appointments',
      dateFrom: '2026-05-30',
      dateTo: '2026-05-30',
      searchTerm: 'did not arrive'
    });

    expect(appointmentRows).toHaveLength(0);

    const rescheduleRows = filterAuditLogRowsForExport(rows, {
      auditFilter: 'reschedules',
      dateFrom: '2026-05-30',
      dateTo: '2026-05-30',
      searchTerm: 'did not arrive'
    });

    expect(rescheduleRows).toHaveLength(1);
    expect(rescheduleRows[0].kind).toBe('reschedule');

    const [tableRow] = buildAuditLogExportTableRows(rescheduleRows, 'MMK');
    expect(tableRow).toMatchObject({
      type: 'Rescheduled Appointment',
      patient: 'Su Su',
      clinician: 'Dr. Hnin',
      paymentMethod: '-'
    });
    expect(tableRow.activity).toContain('Original Date: 2026-05-30 -> New Date: 2026-06-02');
    expect(tableRow.activity).toContain('Reason: Patient did not arrive');
  });

  it('searches primary teeth using the staff-facing labels', () => {
    const primaryRecord: ClinicalRecord = {
      ...records[0],
      id: 'tr-primary',
      teeth: [51]
    };
    const rows = buildAuditLogRows([primaryRecord], [], false);

    expect(filterAuditLogRowsForExport(rows, { searchTerm: '1A' })).toHaveLength(1);
  });
});
