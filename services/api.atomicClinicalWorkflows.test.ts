import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('./supabase', () => ({
  supabase: { rpc: supabaseMock.rpc },
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

describe('atomic clinical workflows', () => {
  beforeEach(() => supabaseMock.rpc.mockReset());

  it('records treatment, medicine, balance, loyalty, and appointment work through one RPC', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        status: 'success',
        new_balance: 1500,
        completed_appointment_ids: ['appointment-1'],
        record: {
          id: 'treatment-1',
          standard_cost: 1000,
          doctor_earnings: 0,
          discount_amount: 0,
          pricing_note: null
        }
      },
      error: null
    });

    const result = await api.treatments.record({
      location_id: 'location-1',
      patient_id: 'patient-1',
      doctor_id: 'doctor-1',
      teeth: [11],
      description: 'Crown',
      cost: 1000,
      medications: [{ id: 'medicine-1', qty: 2 }]
    });

    expect(supabaseMock.rpc).toHaveBeenCalledWith('record_treatment_atomic', expect.objectContaining({
      p_location_id: 'location-1',
      p_patient_id: 'patient-1',
      p_cost: 1000,
      p_medications: [{ id: 'medicine-1', qty: 2 }]
    }));
    expect(result.record.id).toBe('treatment-1');
    expect(result.completed_appointment_ids).toEqual(['appointment-1']);
  });

  it('sells medicine through one atomic RPC and uses the local business date', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        sale: { id: 'sale-1', quantity: '2', unit_price: '500', total_price: '800', standard_total: '1000', discount_amount: '200', pricing_note: 'DISCOUNT' },
        new_stock: '8'
      },
      error: null
    });

    const result = await api.medicines.sell('patient-1', 'medicine-1', 2, 'location-1', undefined, 800);

    expect(supabaseMock.rpc).toHaveBeenCalledWith('sell_medicine_atomic', expect.objectContaining({
      p_location_id: 'location-1',
      p_patient_id: 'patient-1',
      p_medicine_id: 'medicine-1',
      p_quantity: 2,
      p_treatment_id: null,
      p_sale_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      p_final_total: 800
    }));
    expect(result).toMatchObject({ new_stock: 8, sale: { total_price: 800, standard_total: 1000, discount_amount: 200, pricing_note: 'DISCOUNT' } });
  });

  it('fails closed when the required migration has not been applied', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find record_treatment_atomic' }
    });

    await expect(api.treatments.record({
      location_id: 'location-1',
      patient_id: 'patient-1',
      teeth: [],
      description: 'Consultation',
      cost: 100
    })).rejects.toThrow(/atomic treatment recording is not installed/i);
  });

  it('undoes a treatment through one RPC without trusting client patient or cost values', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        status: 'success',
        treatment_id: 'treatment-1',
        patient_id: 'patient-1',
        new_balance: '500',
        new_points: 4,
        reversed_medicine_sale_ids: ['sale-1'],
        restocked_medicines: [{ medicine_id: 'medicine-1', new_stock: '12' }]
      },
      error: null
    });

    const result = await api.treatments.undoRecord('treatment-1');

    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('undo_treatment_atomic', {
      p_treatment_id: 'treatment-1'
    });
    expect(result).toMatchObject({ treatment_id: 'treatment-1', new_balance: '500', new_points: 4 });
  });

  it('fails closed when atomic treatment undo is not installed', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find undo_treatment_atomic' }
    });

    await expect(api.treatments.undoRecord('treatment-1'))
      .rejects.toThrow(/atomic treatment undo is not installed/i);
  });

  it('undoes one medicine record through an atomic RPC and normalizes totals', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        status: 'success', medicine_sale_id: 'sale-1', medicine_id: 'medicine-1', patient_id: 'patient-1',
        quantity_restocked: '2', new_stock: '12', new_balance: '500', new_points: '4', reversed_points: '1',
        loyalty_reversal: { id: 'reversal-1', points: -1 }
      },
      error: null
    });

    const result = await api.medicines.undoSale('sale-1');

    expect(supabaseMock.rpc).toHaveBeenCalledWith('undo_medicine_sale_atomic', { p_medicine_sale_id: 'sale-1' });
    expect(result).toMatchObject({
      medicine_sale_id: 'sale-1', quantity_restocked: 2, new_stock: 12,
      new_balance: 500, new_points: 4, reversed_points: 1
    });
  });

  it('fails closed when atomic medicine record undo is not installed', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find undo_medicine_sale_atomic' }
    });

    await expect(api.medicines.undoSale('sale-1'))
      .rejects.toThrow(/atomic medicine record undo is not installed/i);
  });
});
