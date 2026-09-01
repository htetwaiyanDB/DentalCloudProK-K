import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => {
  const state: any = { calls: [], rowsByTable: {} };

  state.from = vi.fn((table: string) => ({
    select: vi.fn((columns: string) => {
      state.calls.push({ table, columns });
      const query: any = {
        eq: vi.fn(() => query),
        in: vi.fn(() => query),
        order: vi.fn(() => query),
        range: vi.fn(() => query),
        then: (resolve: any, reject: any) => Promise.resolve({
          data: state.rowsByTable[table] || [],
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

describe('Clinical Focus patient history queries', () => {
  beforeEach(() => {
    supabaseMock.calls = [];
    supabaseMock.rowsByTable = {};
    supabaseMock.from.mockClear();
  });

  it('skips commission-ledger enrichment when requested by the patient chart', async () => {
    await api.treatments.getHistory('patient-1', { includeCommissionEntries: false });
    expect(supabaseMock.from).not.toHaveBeenCalledWith('doctor_commission_entries');
  });

  it('keeps commission-ledger enrichment enabled for existing callers', async () => {
    supabaseMock.rowsByTable.treatments = [{ id: 'treatment-1', patient_id: 'patient-1', date: '2026-09-01' }];
    await api.treatments.getHistory('patient-1');
    expect(supabaseMock.from).toHaveBeenCalledWith('doctor_commission_entries');
  });

  it('uses a narrow select without the redundant patient join for medicine history', async () => {
    await api.medicines.getSales('location-1', 'patient-1', { throwOnError: true });
    const saleSelect = supabaseMock.calls.find((call: any) => call.table === 'medicine_sales');
    expect(saleSelect.columns).toContain('standard_total');
    expect(saleSelect.columns).toContain('medicines(name, unit)');
    expect(saleSelect.columns).not.toContain('patients(');
    expect(saleSelect.columns).not.toContain('*');
  });
});