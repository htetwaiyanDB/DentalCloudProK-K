import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => {
  const state: any = { rowsByTable: {}, rangesByTable: {}, filtersByTable: {} };

  state.from = vi.fn((table: string) => ({
    select: vi.fn(() => {
      let from = 0;
      let to = 999;
      const query: any = {
        order: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => {
          (state.filtersByTable[table] ||= []).push(['eq', column, value]);
          return query;
        }),
        gte: vi.fn((column: string, value: unknown) => {
          (state.filtersByTable[table] ||= []).push(['gte', column, value]);
          return query;
        }),
        lte: vi.fn((column: string, value: unknown) => {
          (state.filtersByTable[table] ||= []).push(['lte', column, value]);
          return query;
        }),
        lt: vi.fn((column: string, value: unknown) => {
          (state.filtersByTable[table] ||= []).push(['lt', column, value]);
          return query;
        }),
        in: vi.fn(() => query),
        or: vi.fn(() => query),
        range: vi.fn((nextFrom: number, nextTo: number) => {
          from = nextFrom;
          to = nextTo;
          (state.rangesByTable[table] ||= []).push([from, to]);
          return query;
        }),
        then: (resolve: any, reject: any) => Promise.resolve({
          data: (state.rowsByTable[table] || []).slice(from, to + 1),
          error: null
        }).then(resolve, reject)
      };
      return query;
    })
  }));

  return state;
});

vi.mock('./supabase', () => ({
  supabase: { from: supabaseMock.from, rpc: vi.fn() },
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

const rows = (table: string) => Array.from({ length: 1001 }, (_, index) => ({
  id: `${table}-${String(index).padStart(4, '0')}`,
  location_id: 'location-1',
  patient_id: 'patient-1',
  appointment_id: 'appointment-1',
  patient_name: 'Patient One',
  original_date: '2026-08-05',
  new_date: '2026-08-06',
  reason: 'Schedule change',
  created_at: '2026-08-05T00:00:00Z',
  date: '2026-08-05',
  medicine_id: 'medicine-1',
  quantity: 1,
  unit_price: 100,
  total_price: 100,
  points: 1,
  type: 'EARNED',
  description: 'Test',
  sender_id: 'patient-1',
  sender_type: 'patient',
  recipient_id: 'admin-1',
  recipient_type: 'admin',
  content: 'Message',
  timestamp: '2026-08-05T00:00:00Z',
  read: false,
  conversation_id: 'conversation-1',
  amount: 100,
  payment_date: '2026-08-05'
}));

describe('high-volume Supabase fetches', () => {
  beforeEach(() => {
    supabaseMock.rowsByTable = { patient_material_costs: [] };
    supabaseMock.rangesByTable = {};
    supabaseMock.filtersByTable = {};
    supabaseMock.from.mockClear();
  });

  it('loads records after the first 1,000 rows for every production history fetch', async () => {
    for (const table of ['appointment_reschedule_logs', 'payments', 'expenses', 'medicine_sales', 'loyalty_transactions', 'messages']) {
      supabaseMock.rowsByTable[table] = rows(table);
    }
    vi.spyOn(api.messages, 'performAutomaticCleanup').mockResolvedValue(undefined);

    const results = await Promise.all([
      api.appointmentRescheduleLogs.getAll('location-1'),
      api.finance.getPayments('location-1'),
      api.expenses.getAll('location-1'),
      api.medicines.getSales('location-1'),
      api.loyalty.getTransactions('patient-1', 'location-1'),
      api.messages.getMessages('conversation-1')
    ]);

    results.forEach((result) => expect(result).toHaveLength(1001));
    for (const table of ['appointment_reschedule_logs', 'payments', 'expenses', 'medicine_sales', 'loyalty_transactions', 'messages']) {
      expect(supabaseMock.rangesByTable[table]).toEqual([[0, 999], [1000, 1999]]);
    }
  });

  it('applies the selected audit date range at the database query', async () => {
    await Promise.all([
      api.treatments.getAllRecords('location-1', {
        limit: null,
        dateFrom: '2026-08-06',
        dateTo: '2026-08-06',
        includeCommissionEntries: false
      }),
      api.appointments.getAll('location-1', { dateFrom: '2026-08-06', dateTo: '2026-08-06' }),
      api.finance.getPayments('location-1', { dateFrom: '2026-08-06', dateTo: '2026-08-06' }),
      api.appointmentRescheduleLogs.getAll('location-1', { dateFrom: '2026-08-06', dateTo: '2026-08-06' })
    ]);

    expect(supabaseMock.filtersByTable.treatments).toEqual(expect.arrayContaining([
      ['eq', 'location_id', 'location-1'],
      ['gte', 'date', '2026-08-06'],
      ['lte', 'date', '2026-08-06']
    ]));
    expect(supabaseMock.filtersByTable.appointments).toEqual(expect.arrayContaining([
      ['gte', 'date', '2026-08-06'],
      ['lte', 'date', '2026-08-06']
    ]));
    expect(supabaseMock.filtersByTable.payments).toEqual(expect.arrayContaining([
      ['gte', 'payment_date', '2026-08-06'],
      ['lte', 'payment_date', '2026-08-06']
    ]));
    expect(supabaseMock.filtersByTable.appointment_reschedule_logs).toEqual(expect.arrayContaining([
      ['gte', 'created_at', expect.any(String)],
      ['lt', 'created_at', expect.any(String)]
    ]));
    expect(supabaseMock.from).not.toHaveBeenCalledWith('doctor_commission_entries');
  });
});
