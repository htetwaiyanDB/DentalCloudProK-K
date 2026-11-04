import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => {
  const state: any = { rpcCalls: [] };
  state.rpc = vi.fn(async (name: string, payload: any) => {
    state.rpcCalls.push({ name, payload });
    if (name === 'replace_treatment_costs') {
      return {
        data: [
          { id: 'cost-1', audit_log_id: 'audit-1', material_name: 'Composite', cost_type: 'material', cost_amount: 100, quantity: 2, total_amount: 200 },
          { id: 'cost-2', audit_log_id: 'audit-1', material_name: 'Crown lab', cost_type: 'lab', cost_amount: 300, quantity: 1, total_amount: 300 },
          { id: 'cost-3', audit_log_id: 'audit-1', material_name: 'Implant doctor', cost_type: 'special_doctor', cost_amount: 100000, quantity: 1, total_amount: 100000 }
        ],
        error: null
      };
    }
    return { data: null, error: null };
  });
  const from = vi.fn((table: string) => {
    if (table === 'audit_logs') {
      return { upsert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: 'audit-1' }, error: null })) })) })) };
    }
    if (table === 'pending_commission_recalculations') {
      return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })) };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  const reportQuery: any = {};
  for (const method of ['select', 'gte', 'lte', 'order', 'range', 'eq']) reportQuery[method] = vi.fn(() => reportQuery);
  reportQuery.then = (resolve: any) => Promise.resolve(state.reportPages.shift() || { data: [], error: null }).then(resolve);
  const originalFrom = from.getMockImplementation()!;
  from.mockImplementation((table: string) => table === 'mls_expense_report' ? reportQuery : originalFrom(table));
  state.reportPages = [];
  return { rpc: state.rpc, from, rpcCalls: state.rpcCalls, reportQuery, reportPages: state.reportPages };
});

vi.mock('./supabase', () => ({
  supabase: { rpc: supabaseMock.rpc, from: supabaseMock.from },
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

describe('api.materialCosts transactional RPC', () => {
  const treatment = { id: 'treatment-1', location_id: 'location-1', patient_id: 'patient-1', teeth: [], description: 'Crown', cost: 1000, date: '2026-07-18' };
  const payment = { id: 'payment-1', patientId: 'patient-1', amount: 500, date: '2026-07-18', type: 'PARTIAL' as const, remainingBalance: 500, paymentMethod: 'CASH' as const };
  const save = (source: string, expenseDate: string) => {
    const items = [{ id: 'cost-1', expenseDate, materialName: 'Composite', costType: 'material' as const, costAmount: 100, quantity: 1 }];
    return source === 'payment' ? api.materialCosts.upsertForPayment(payment, treatment, items) : api.materialCosts.upsertForTreatment(treatment, items);
  };

  it.each(['payment', 'treatment'])('preserves item identity and leap-day date for %s writes and maps saved dates', async (source) => {
    supabaseMock.rpc.mockResolvedValueOnce({ data: [{ id: 'cost-1', expense_date: '2028-02-29', cost_amount: 100, quantity: 1 }], error: null });
    const result = await save(source, '2028-02-29');
    expect(supabaseMock.rpc.mock.calls[0][1].p_items[0]).toMatchObject({ id: 'cost-1', expense_date: '2028-02-29' });
    expect(result.items[0]).toMatchObject({ id: 'cost-1', expenseDate: '2028-02-29' });
  });

  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-1-01', '2026-01-01T00:00:00Z', '', '0000-01-01'])('rejects invalid calendar date %s before writes', async (date) => {
    for (const source of ['payment', 'treatment']) await expect(save(source, date)).rejects.toThrow('Expense Date');
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    supabaseMock.reportPages.length = 0;
    for (const method of ['select', 'gte', 'lte', 'order', 'range', 'eq']) supabaseMock.reportQuery[method].mockClear();
    supabaseMock.rpcCalls.length = 0;
    supabaseMock.rpc.mockClear();
    supabaseMock.from.mockClear();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('loads all expense-period report pages with location filtering and maps dates separately', async () => {
    const row = { id: 'cost-1', expense_date: '2026-08-01', cost_type: 'lab', total_amount: '125.50', patient_id: 'patient-1', patient_name: 'Patient', treatment_label: 'Crown', treatment_date: '2026-07-01', doctor_name: 'Doctor', patient_type: 'new', source_type: 'payment', source_id: 'payment-1' };
    supabaseMock.reportPages.push({ data: Array.from({ length: 1000 }, () => row), error: null }, { data: [{ ...row, id: 'last' }], error: null });
    const items = await api.materialCosts.getReportCostItems({ locationId: 'location-1', dateFrom: '2026-08-01', dateTo: '2026-08-31' });
    expect(items).toHaveLength(1001);
    expect(items[1000]).toMatchObject({ id: 'last', expenseDate: '2026-08-01', treatmentDate: '2026-07-01', amount: 125.5, sourceId: 'payment-1' });
    expect(supabaseMock.reportQuery.gte).toHaveBeenCalledWith('expense_date', '2026-08-01');
    expect(supabaseMock.reportQuery.lte).toHaveBeenCalledWith('expense_date', '2026-08-31');
    expect(supabaseMock.reportQuery.eq).toHaveBeenCalledWith('location_id', 'location-1');
    expect(supabaseMock.reportQuery.range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it('fails loudly when the expense report migration is missing', async () => {
    supabaseMock.reportPages.push({ data: null, error: { message: 'relation mls_expense_report does not exist' } });
    await expect(api.materialCosts.getReportCostItems({ dateFrom: '2026-08-01', dateTo: '2026-08-31' })).rejects.toThrow('migration');
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
  });

  it('sends categorized items and the logged-in staff identity with its server session token', async () => {
    const result = await api.materialCosts.upsertForTreatment({
      id: 'treatment-1', location_id: 'location-1', patient_id: 'patient-1', teeth: [], description: 'Crown', cost: 1000, date: '2026-07-18'
    }, [
      { materialName: ' Composite ', costType: 'material', costAmount: 100, quantity: 2 },
      { materialName: 'Crown lab', costType: 'lab', costAmount: 300, quantity: 1 },
      { materialName: ' Implant doctor ', costType: 'special_doctor', costAmount: 100000, quantity: 1 }
    ], { userId: 'admin-1', username: 'Admin', authToken: 'session-token-1' });

    expect(supabaseMock.rpcCalls[0]).toEqual({
      name: 'replace_treatment_costs',
      payload: {
        p_audit_log_id: 'audit-1',
        p_items: [
          { material_name: 'Composite', cost_type: 'material', cost_amount: 100, quantity: 2, doctor_id: null },
          { material_name: 'Crown lab', cost_type: 'lab', cost_amount: 300, quantity: 1, doctor_id: null },
          { material_name: 'Implant doctor', cost_type: 'special_doctor', cost_amount: 100000, quantity: 1, doctor_id: null }
        ],
        p_admin_user_id: 'admin-1',
        p_admin_password: 'session-token-1',
        p_request_token: expect.any(String)
      }
    });
    expect(result.items.map((item) => item.costType)).toEqual(['material', 'lab', 'special_doctor']);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Treatment costs were saved, but doctor commission refresh needs retry.',
      expect.any(Error)
    );
  });

  it('passes doctor_id through for a special doctor item on a treatment', async () => {
    await api.materialCosts.upsertForTreatment({
      id: 'treatment-1', location_id: 'location-1', patient_id: 'patient-1', teeth: [], description: 'Crown', cost: 1000, date: '2026-07-18'
    }, [
      { materialName: 'Implant doctor', costType: 'special_doctor', costAmount: 100000, quantity: 1, doctorId: 'doctor-1' }
    ], { userId: 'admin-1', username: 'Admin', authToken: 'session-token-1' });

    expect(supabaseMock.rpcCalls[0].payload.p_items).toEqual([
      { material_name: 'Implant doctor', cost_type: 'special_doctor', cost_amount: 100000, quantity: 1, doctor_id: 'doctor-1' }
    ]);
  });

  it('stores each MLS edit against the selected payment audit row', async () => {
    await api.materialCosts.upsertForPayment({
      id: 'payment-1', location_id: 'location-1', patientId: 'patient-1', amount: 500,
      date: '2026-09-28', type: 'PARTIAL', remainingBalance: 500, paymentMethod: 'CASH'
    }, {
      id: 'treatment-1', location_id: 'location-1', patient_id: 'patient-1', doctor_id: 'doctor-1',
      teeth: [], description: 'Crown', cost: 1000, date: '2026-09-28'
    }, [
      { materialName: 'Composite', costType: 'material', costAmount: 100, quantity: 1 }
    ], { userId: 'admin-1', username: 'Admin', authToken: 'session-token-1' });

    expect(supabaseMock.from).toHaveBeenCalledWith('audit_logs');
    const auditUpsert = supabaseMock.from.mock.results
      .map((result: any) => result.value?.upsert)
      .find(Boolean);
    expect(auditUpsert).toHaveBeenCalledWith(expect.objectContaining({
      source_type: 'payment',
      source_id: 'payment-1',
      payment_id: 'payment-1',
      patient_id: 'patient-1'
    }), { onConflict: 'source_type,source_id' });
  });
});
