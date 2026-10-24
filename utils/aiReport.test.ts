import { describe, expect, it } from 'vitest';
import { ClinicalRecord, Expense, Medicine, MedicineSale, PaymentRecord } from '../types';
import { buildFinancialReport, resolveFinancialReportAnchorDate } from './aiReport';

describe('buildFinancialReport', () => {


  it('resolves month-specific financial summary requests to that month end date', () => {
    expect(resolveFinancialReportAnchorDate('Give me Financial Summary for May', '2026-06-05')).toBe('2026-05-31');
    expect(resolveFinancialReportAnchorDate('financial report for May 2026', '2026-06-05')).toBe('2026-05-31');
    expect(resolveFinancialReportAnchorDate('show last month revenue', '2026-06-05')).toBe('2026-05-31');
  });

  it('uses the requested month as the monthly reporting period and caps weekly values at the anchor date', () => {
    const treatments: ClinicalRecord[] = [
      {
        id: 'may_treatment',
        location_id: 'loc_1',
        patient_id: 'patient_1',
        teeth: [18],
        description: 'May filling',
        cost: 1000,
        date: '2026-05-15'
      },
      {
        id: 'may_week_treatment',
        location_id: 'loc_1',
        patient_id: 'patient_2',
        teeth: [21],
        description: 'May scaling',
        cost: 2000,
        date: '2026-05-30'
      },
      {
        id: 'june_treatment',
        location_id: 'loc_1',
        patient_id: 'patient_3',
        teeth: [11],
        description: 'June treatment',
        cost: 9999,
        date: '2026-06-01'
      }
    ];

    const expenses: Expense[] = [
      {
        id: 'may_expense',
        location_id: 'loc_1',
        description: 'May supplies',
        amount: 500,
        category: 'Supplies',
        date: '2026-05-20'
      },
      {
        id: 'june_expense',
        location_id: 'loc_1',
        description: 'June supplies',
        amount: 999,
        category: 'Supplies',
        date: '2026-06-01'
      }
    ];

    const medicineSales: MedicineSale[] = [
      {
        id: 'may_sale',
        location_id: 'loc_1',
        patient_id: 'patient_1',
        medicine_id: 'med_1',
        quantity: 1,
        unit_price: 700,
        total_price: 700,
        date: '2026-05-25'
      },
      {
        id: 'june_sale',
        location_id: 'loc_1',
        patient_id: 'patient_2',
        medicine_id: 'med_1',
        quantity: 1,
        unit_price: 999,
        total_price: 999,
        date: '2026-06-02'
      }
    ];

    const payments: PaymentRecord[] = [
      {
        id: 'may_payment',
        location_id: 'loc_1',
        patientId: 'patient_1',
        amount: 300,
        date: '2026-05-31',
        type: 'PARTIAL',
        remainingBalance: 0
      },
      {
        id: 'june_payment',
        location_id: 'loc_1',
        patientId: 'patient_2',
        amount: 999,
        date: '2026-06-03',
        type: 'FULL',
        remainingBalance: 0
      }
    ];

    const report = buildFinancialReport(
      treatments,
      expenses,
      [],
      'MMK',
      '2026-05-31',
      medicineSales,
      payments
    );

    expect(report.today).toBe('2026-05-31');
    expect(report.monthlyLabel).toBe('May 2026');
    expect(report.revenueDaily).toBe(0);
    expect(report.revenueWeekly).toBe(2700);
    expect(report.revenueMonthly).toBe(3700);
    expect(report.expenseMonthly).toBe(500);
    expect(report.profitMonthly).toBe(3200);
  });

  it('counts treatment production, medicine sales, and service fees without counting collections twice', () => {
    const treatments: ClinicalRecord[] = [
      {
        id: 'tr_today',
        location_id: 'loc_1',
        patient_id: 'patient_1',
        patient_name: 'Patient One',
        teeth: [18],
        description: 'Filling',
        cost: 1000,
        date: '2026-06-05'
      },
      {
        id: 'tr_week',
        location_id: 'loc_1',
        patient_id: 'patient_2',
        patient_name: 'Patient Two',
        doctor_name: 'Dr. Mya',
        teeth: [21],
        description: 'Scaling',
        cost: 2000,
        date: '2026-06-01'
      },
      {
        id: 'tr_previous_month',
        location_id: 'loc_1',
        patient_id: 'patient_3',
        patient_name: 'Patient Three',
        teeth: [11],
        description: 'Extraction',
        cost: 9999,
        date: '2026-05-20'
      }
    ];

    const expenses: Expense[] = [
      {
        id: 'exp_today',
        location_id: 'loc_1',
        description: 'Supplies',
        amount: 300,
        category: 'Supplies',
        date: '2026-06-05'
      },
      {
        id: 'exp_week',
        location_id: 'loc_1',
        description: 'Utilities',
        amount: 700,
        category: 'Utilities',
        date: '2026-06-02'
      },
      {
        id: 'exp_previous_month',
        location_id: 'loc_1',
        description: 'Old expense',
        amount: 5000,
        category: 'Other',
        date: '2026-05-15'
      }
    ];

    const medicines: Medicine[] = [
      {
        id: 'med_1',
        location_id: 'loc_1',
        name: 'Amoxicillin',
        unit: 'card',
        price: 100,
        stock: 5,
        min_stock: 10
      },
      {
        id: 'med_2',
        location_id: 'loc_1',
        name: 'Ibuprofen',
        unit: 'box',
        price: 250,
        stock: 0,
        min_stock: 5
      }
    ];

    const medicineSales: MedicineSale[] = [
      {
        id: 'sale_today',
        location_id: 'loc_1',
        patient_id: 'patient_1',
        medicine_id: 'med_1',
        quantity: 2,
        unit_price: 500,
        total_price: 1000,
        date: '2026-06-05'
      },
      {
        id: 'sale_week',
        location_id: 'loc_1',
        patient_id: 'patient_2',
        medicine_id: 'med_2',
        quantity: 1,
        unit_price: 1500,
        total_price: 1500,
        date: '2026-06-03'
      }
    ];

    const payments: PaymentRecord[] = [
      {
        id: 'pay_today',
        location_id: 'loc_1',
        patientId: 'patient_1',
        amount: 500,
        date: '2026-06-05',
        type: 'PARTIAL',
        remainingBalance: 500
      },
      {
        id: 'pay_week',
        location_id: 'loc_1',
        patientId: 'patient_2',
        amount: 800,
        date: '2026-06-04',
        type: 'FULL',
        remainingBalance: 0
      }
    ];

    const report = buildFinancialReport(
      treatments,
      expenses,
      medicines,
      'MMK',
      '2026-06-05',
      medicineSales,
      payments
    );

    expect(report.revenueDaily).toBe(2000);
    expect(report.revenueWeekly).toBe(5500);
    expect(report.revenueMonthly).toBe(5500);
    expect(report.expenseDaily).toBe(300);
    expect(report.expenseWeekly).toBe(1000);
    expect(report.expenseMonthly).toBe(1000);
    expect(report.profitMonthly).toBe(4500);
    expect(report.inventoryValue).toBe(500);
    expect(report.lowStockCount).toBe(2);
    expect(report.outOfStockCount).toBe(1);
    expect(report.topDoctors30d).toEqual([
      { name: 'Unassigned Doctor', treatments: 2 },
      { name: 'Dr. Mya', treatments: 1 }
    ]);
  });

  it('includes manual service fees once and excludes voided payment fees', () => {
    const serviceFeePayment = (id: string, fee: number, voidedAt?: string): PaymentRecord => ({
      id,
      location_id: 'loc_1',
      patientId: 'patient_1',
      amount: fee,
      clearedAmount: fee,
      date: '2026-06-05',
      type: 'FULL',
      remainingBalance: 0,
      voidedAt,
      receiptSnapshot: {
        version: 1,
        receiptType: 'PAYMENT',
        receiptNumber: id,
        receiptDate: '2026-06-05',
        currency: 'MMK',
        clinic: { appName: 'Clinic', headerTitle: 'Receipt', email: '', phone: '' },
        patient: { id: 'patient_1', name: 'Patient One' },
        payment: { amountPaid: fee, method: 'CASH', status: 'FULL', balanceBefore: fee, balanceAfter: 0, serviceFeeAmount: fee },
        treatments: [],
        medicines: []
      }
    });

    const report = buildFinancialReport([], [], [], 'MMK', '2026-06-05', [], [
      serviceFeePayment('active-fee', 1_000),
      serviceFeePayment('repeated-fee-snapshot', 1_000),
      serviceFeePayment('voided-fee', 2_000, '2026-06-05T12:00:00Z')
    ]);

    expect(report.revenueDaily).toBe(1_000);
    expect(report.revenueMonthly).toBe(1_000);
  });
});
