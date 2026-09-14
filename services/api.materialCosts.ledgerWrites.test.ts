import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { table: string; method: string; args: any[] };

const supabaseMock = vi.hoisted(() => {
  const state: any = {
    treatmentRows: [] as any[],
    paymentRows: [] as any[],
    auditRows: [] as any[],
    costRows: [] as any[],
    existingEntryRows: [] as any[],
    calls: [] as Call[],
    rpcCalls: [] as any[]
  };

  const build = (table: string, result: any): any => {
    const chain: any = {
      then: (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected)
    };
    for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'range', 'single', 'maybeSingle', 'update', 'delete', 'insert']) {
      chain[method] = (...args: any[]) => {
        state.calls.push({ table, method, args });
        return build(table, result);
      };
    }
    chain.upsert = (...args: any[]) => {
      state.calls.push({ table, method: 'upsert', args });
      return build(table, table === 'audit_logs' ? { data: { id: 'audit-1' }, error: null } : { data: null, error: null });
    };
    return chain;
  };

  const from = vi.fn((table: string) => {
    const results: Record<string, any> = {
      treatments: { data: state.treatmentRows, error: null },
      payments: { data: state.paymentRows, error: null },
      audit_logs: { data: state.auditRows, error: null },
      patient_material_costs: { data: state.costRows, error: null },
      doctor_treatment_commissions: { data: [], error: null },
      doctor_commission_entries: { data: state.existingEntryRows, error: null }
    };
    return build(table, results[table] ?? { data: null, error: null });
  });

  const rpc = vi.fn(async (name: string, payload: any) => {
    state.rpcCalls.push({ name, payload });
    if (name === 'replace_treatment_costs') {
      return {
        data: [
          { id: 'cost-1', audit_log_id: 'audit-1', material_name: 'Composite', cost_type: 'material', cost_amount: 100, quantity: 1, total_amount: 100 }
        ],
        error: null
      };
    }
    return { data: null, error: null };
  });

  return { from, rpc, state };
});

vi.mock('./supabase', () => ({
  supabase: { from: supabaseMock.from, rpc: supabaseMock.rpc },
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

vi.mock('../utils/doctorCommissionLedger', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    allocateCommissionablePayments: vi.fn(() => [{ treatmentId: 't-1', paymentId: 'p-1', amount: 500 }]),
    calculateCommissionLedgerEntries: vi.fn(() => [{
      paymentId: 'p-1',
      treatmentId: 't-1',
      doctorId: 'd-1',
      patientId: 'pat-1',
      paymentDate: '2026-01-06',
      treatmentDate: '2026-01-05',
      visitKey: 'pat-1|d-1|2026-01-05',
      calculationMode: 'percentage',
      amount: 500,
      materialDeduction: 0,
      commissionBase: 500,
      commissionRate: 10,
      earnings: 50
    }])
  };
});

import { api } from './api';

const baseTreatment = (overrides: any) => ({
  id: 't-1',
  location_id: 'loc-1',
  patient_id: 'pat-1',
  doctor_id: 'd-1',
  treatment_type_id: 'tt-1',
  date: '2026-01-05',
  cost: 1000,
  doctor_earnings: 50,
  commission_type_snapshot: null,
  commission_rate_snapshot: null,
  doctors: { specialization: 'General', commission_type: 'percentage', commission_percentage: 10, commission_per_visit: 0 },
  ...overrides
});

// Stored ledger row that matches the mocked calculated entry in every field.
const matchingEntryRow = {
  id: 'e-1',
  payment_id: 'p-1',
  treatment_id: 't-1',
  doctor_id: 'd-1',
  patient_id: 'pat-1',
  location_id: 'loc-1',
  payment_date: '2026-01-06',
  treatment_date: '2026-01-05',
  visit_key: 'pat-1|d-1|2026-01-05',
  calculation_mode: 'percentage',
  allocated_payment: '500.00',
  material_deduction: '0.00',
  commission_base: '500.00',
  commission_rate: '10',
  earnings: '50.00'
};

const saveCosts = () => api.materialCosts.upsertForTreatment(
  { id: 't-1', location_id: 'loc-1', patient_id: 'pat-1', teeth: [], description: 'Crown', cost: 1000, date: '2026-01-05' },
  [{ materialName: 'Composite', costType: 'material', costAmount: 100, quantity: 1 }],
  { userId: 'u-1', username: 'Admin', authToken: 'token-1' }
);

const callsFor = (table: string, method: string) => supabaseMock.state.calls.filter((call) => call.table === table && call.method === method);

describe('MLS save commission ledger write-path', () => {
  beforeEach(() => {
    supabaseMock.state.calls.length = 0;
    supabaseMock.state.rpcCalls.length = 0;
    supabaseMock.state.treatmentRows = [
      baseTreatment({}),
      baseTreatment({ id: 't-2', cost: 200, doctor_earnings: 99 })
    ];
    supabaseMock.state.paymentRows = [{
      id: 'p-1', patient_id: 'pat-1', payment_date: '2026-01-06', created_at: '2026-01-06T00:00:00Z',
      amount: 1000, cleared_amount: 1000, treatment_ids: ['t-1'], receipt_snapshot: null
    }];
    supabaseMock.state.auditRows = [{ id: 'a-1', source_id: 't-1' }, { id: 'a-2', source_id: 't-2' }];
    supabaseMock.state.costRows = [{ audit_log_id: 'a-1', cost_type: 'material', total_amount: 100 }];
    supabaseMock.state.existingEntryRows = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('skips ledger upserts and treatment updates when stored values already match', async () => {
    supabaseMock.state.existingEntryRows = [matchingEntryRow];

    const result = await saveCosts();

    expect(result.commissionRefreshPending).toBe(false);
    expect(supabaseMock.state.rpcCalls.map((call: any) => call.name)).toContain('acknowledge_commission_recalculation');
    expect(callsFor('doctor_commission_entries', 'upsert')).toHaveLength(0);
    expect(callsFor('doctor_commission_entries', 'delete')).toHaveLength(0);
    // Only t-2 drifted (stored 99 vs recalculated 0); t-1 already matches and is skipped.
    const treatmentUpdates = callsFor('treatments', 'update');
    expect(treatmentUpdates.map((call) => call.args[0])).toEqual([{ doctor_earnings: 0 }]);
  });

  it('upserts only changed ledger rows and deletes obsolete ones', async () => {
    supabaseMock.state.existingEntryRows = [
      { ...matchingEntryRow, earnings: '40.00' },
      { ...matchingEntryRow, id: 'e-9', payment_id: 'p-9', treatment_id: 't-2', earnings: '10.00' }
    ];

    await saveCosts();

    const entryUpserts = callsFor('doctor_commission_entries', 'upsert');
    expect(entryUpserts).toHaveLength(1);
    expect(entryUpserts[0].args[0]).toHaveLength(1);
    expect(entryUpserts[0].args[0][0]).toMatchObject({ payment_id: 'p-1', treatment_id: 't-1', earnings: 50 });

    const obsoleteDeletes = callsFor('doctor_commission_entries', 'in').filter((call) => call.args[0] === 'id');
    expect(obsoleteDeletes.map((call) => call.args[1])).toEqual([['e-9']]);
  });

  it('batches cost-total queries with the requested id batch size', async () => {
    const ids = Array.from({ length: 60 }, (_, index) => `treatment-${index}`);
    supabaseMock.state.auditRows = ids.map((id, index) => ({ id: `audit-${index}`, source_id: id }));
    supabaseMock.state.costRows = supabaseMock.state.auditRows.map((row: any) => ({ audit_log_id: row.id, cost_type: 'material', total_amount: 10 }));

    supabaseMock.state.calls.length = 0;
    await api.materialCosts.getTotalsByTreatmentIds(ids, { idBatchSize: 50 });
    expect(callsFor('audit_logs', 'select')).toHaveLength(2);
    expect(callsFor('patient_material_costs', 'select')).toHaveLength(2);

    supabaseMock.state.calls.length = 0;
    await api.materialCosts.getTotalsByTreatmentIds(ids);
    expect(callsFor('audit_logs', 'select')).toHaveLength(3);
  });
});
