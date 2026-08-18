import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => {
  const state: any = { rpcCalls: [], rpcResults: [] };
  state.rpc = vi.fn(async (functionName: string, payload: any) => {
    state.rpcCalls.push({ functionName, payload });
    return state.rpcResults.shift();
  });
  return state;
});

vi.mock('./supabase', () => ({
  supabase: { rpc: supabaseMock.rpc },
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

const paymentRow = {
  id: 'payment-1',
  location_id: 'location-1',
  patient_id: 'patient-1',
  patient_name: 'Patient One',
  amount: 100,
  original_amount: 100,
  cleared_amount: 100,
  balance_before: 150,
  remaining_balance: 50,
  payment_method: 'CASH',
  payment_status: 'PARTIAL',
  treatment_ids: ['treatment-1'],
  receipt_number: 'REC-1',
  payment_date: '2026-07-03',
  receipt_snapshot: null,
  created_by_user_id: null,
  created_by_user_name: 'Front Desk',
  created_at: '2026-07-03T00:00:00Z'
};

describe('finance.processPayment', () => {
  beforeEach(() => {
    supabaseMock.rpcCalls = [];
    supabaseMock.rpcResults = [];
    supabaseMock.rpc.mockClear();
  });

  it('passes a submission key to the payment RPC for idempotency', async () => {
    supabaseMock.rpcResults.push({ data: [paymentRow], error: null });

    const result = await api.finance.processPayment({
      patientId: 'patient-1',
      amount: 100,
      paymentMethod: 'CASH',
      treatmentIds: ['treatment-1'],
      paymentDate: '2026-07-03',
      submissionKey: 'submit-123',
      createdByUserName: 'Front Desk'
    });

    expect(supabaseMock.rpcCalls).toHaveLength(1);
    expect(supabaseMock.rpcCalls[0]).toMatchObject({
      functionName: 'process_patient_payment',
      payload: {
        p_patient_id: 'patient-1',
        p_amount: 100,
        p_payment_method: 'CASH',
        p_treatment_ids: ['treatment-1'],
        p_payment_date: '2026-07-03',
        p_submission_key: 'submit-123',
        p_created_by_user_name: 'Front Desk'
      }
    });
    expect(result.payment.id).toBe('payment-1');
  });

  it('passes service fee metadata through the receipt snapshot for server-side balance validation', async () => {
    supabaseMock.rpcResults.push({ data: [paymentRow], error: null });

    await api.finance.processPayment({
      patientId: 'patient-1',
      amount: 5000,
      paymentMethod: 'CASH',
      treatmentIds: [],
      paymentDate: '2026-07-03',
      submissionKey: 'service-fee-123',
      receiptSnapshot: {
        payment: {
          serviceFeeAmount: 5000,
          serviceFeeCategory: 'RETURNING'
        }
      },
      createdByUserName: 'Front Desk'
    });

    expect(supabaseMock.rpcCalls).toHaveLength(1);
    expect(supabaseMock.rpcCalls[0]).toMatchObject({
      functionName: 'process_patient_payment',
      payload: {
        p_amount: 5000,
        p_treatment_ids: [],
        p_receipt_snapshot: {
          payment: {
            serviceFeeAmount: 5000,
            serviceFeeCategory: 'RETURNING'
          }
        },
        p_submission_key: 'service-fee-123'
      }
    });
  });

  it('fails closed when idempotent payment storage is not installed', async () => {
    supabaseMock.rpcResults.push(
      { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.process_patient_payment with parameter p_submission_key' } }
    );

    await expect(api.finance.processPayment({
      patientId: 'patient-1',
      amount: 100,
      paymentMethod: 'CASH',
      submissionKey: 'submit-123'
    })).rejects.toThrow(/idempotent payment storage is not installed/i);

    expect(supabaseMock.rpcCalls).toHaveLength(1);
    expect(supabaseMock.rpcCalls[0].payload.p_submission_key).toBe('submit-123');
  });

  it('posts split allocations through the dedicated atomic RPC', async () => {
    supabaseMock.rpcResults.push({ data: [{ ...paymentRow, payment_method: 'MIXED' }], error: null });

    const result = await api.finance.processPayment({
      patientId: 'patient-1',
      amount: 100,
      paymentMethod: 'MIXED',
      allocations: [{ method: 'CASH', amount: 40 }, { method: 'KPAY', amount: 60 }],
      submissionKey: 'split-123'
    });

    expect(supabaseMock.rpcCalls).toHaveLength(1);
    expect(supabaseMock.rpcCalls[0]).toMatchObject({
      functionName: 'process_patient_split_payment',
      payload: {
        p_amount: 100,
        p_submission_key: 'split-123',
        p_allocations: [
          { method: 'CASH', amount: 40, reference: null },
          { method: 'KPAY', amount: 60, reference: null }
        ]
      }
    });
    expect(result.payment.paymentMethod).toBe('MIXED');
    expect(result.payment.allocations).toEqual([
      { method: 'CASH', amount: 40 },
      { method: 'KPAY', amount: 60 }
    ]);
  });

  it('never downgrades a split payment when its migration is missing', async () => {
    supabaseMock.rpcResults.push({ data: null, error: { code: 'PGRST202', message: 'Could not find process_patient_split_payment' } });

    await expect(api.finance.processPayment({
      patientId: 'patient-1',
      amount: 100,
      paymentMethod: 'MIXED',
      allocations: [{ method: 'CASH', amount: 40 }, { method: 'KPAY', amount: 60 }]
    })).rejects.toThrow(/split payment storage is not installed/i);

    expect(supabaseMock.rpcCalls).toHaveLength(1);
    expect(supabaseMock.rpcCalls[0].functionName).toBe('process_patient_split_payment');
  });
});
