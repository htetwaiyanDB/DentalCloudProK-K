import { describe, expect, it } from 'vitest';

import {
  applyMaterialCostPreset,
  normalizeMaterialCostPresetInputs,
  sortMaterialCostPresets,
  type MaterialCostDraftRow
} from './materialCostPresets';

const ids = {
  material: '11111111-1111-4111-8111-111111111111',
  lab: '22222222-2222-4222-8222-222222222222',
  specialDoctor: '33333333-3333-4333-8333-333333333333'
};

const emptyRow = (costType: 'material' | 'lab' | 'special_doctor'): MaterialCostDraftRow => ({
  localId: `new-${costType}`,
  materialName: '',
  costType,
  costAmount: 0,
  quantity: 1,
  isPristine: true
});

describe('material and lab cost presets', () => {
  it('normalizes labels, amounts, and ordering without mutating the input', () => {
    const source = [
      { id: ids.lab, costType: 'lab' as const, label: ' Crown Lab ', amount: 123.456, sortOrder: 9 },
      { id: ids.material, costType: 'material' as const, label: 'Composite', amount: 50, sortOrder: 8 },
      { id: ids.specialDoctor, costType: 'special_doctor' as const, label: 'Visiting surgeon', amount: 500, sortOrder: 7 }
    ];

    expect(normalizeMaterialCostPresetInputs(source)).toEqual([
      { id: ids.lab, costType: 'lab', label: 'Crown Lab', amount: 123.46, sortOrder: 0 },
      { id: ids.material, costType: 'material', label: 'Composite', amount: 50, sortOrder: 1 },
      { id: ids.specialDoctor, costType: 'special_doctor', label: 'Visiting surgeon', amount: 500, sortOrder: 2 }
    ]);
    expect(source[0].label).toBe(' Crown Lab ');
  });

  it('rejects invalid identifiers, duplicate ids, blank labels, categories, and amounts', () => {
    expect(() => normalizeMaterialCostPresetInputs([{ id: 'bad', costType: 'material', label: 'A', amount: 1, sortOrder: 0 }])).toThrow('invalid identifier');
    expect(() => normalizeMaterialCostPresetInputs([
      { id: ids.material, costType: 'material', label: 'A', amount: 1, sortOrder: 0 },
      { id: ids.material, costType: 'lab', label: 'B', amount: 2, sortOrder: 1 }
    ])).toThrow('unique identifier');
    expect(() => normalizeMaterialCostPresetInputs([{ id: ids.material, costType: 'material', label: ' ', amount: 1, sortOrder: 0 }])).toThrow('needs a label');
    expect(() => normalizeMaterialCostPresetInputs([{ id: ids.material, costType: 'other' as any, label: 'A', amount: 1, sortOrder: 0 }])).toThrow('valid category');
    expect(() => normalizeMaterialCostPresetInputs([{ id: ids.material, costType: 'material', label: 'A', amount: 0, sortOrder: 0 }])).toThrow('greater than zero');
    expect(() => normalizeMaterialCostPresetInputs([{ id: ids.material, costType: 'material', label: 'A', amount: Number.NaN, sortOrder: 0 }])).toThrow('greater than zero');
    expect(() => normalizeMaterialCostPresetInputs([{ id: ids.material, costType: 'material', label: 'A', amount: 0.004, sortOrder: 0 }])).toThrow('greater than zero');
    expect(() => normalizeMaterialCostPresetInputs([{ id: ids.material, costType: 'material', label: 'A', amount: 10_000_000_000, sortOrder: 0 }])).toThrow('greater than zero');
  });

  it('fills only a pristine row of the matching category', () => {
    const touchedMaterial = { ...emptyRow('material'), localId: 'touched', materialName: 'Manual', isPristine: false };
    const rows = [touchedMaterial, emptyRow('material'), emptyRow('lab')];
    const result = applyMaterialCostPreset(rows, {
      id: ids.material, costType: 'material', label: 'Composite', amount: 25
    }, emptyRow);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(touchedMaterial);
    expect(result[1]).toMatchObject({ materialName: 'Composite', costAmount: 25, quantity: 1, isPristine: false });
    expect(result[2]).toEqual(rows[2]);
  });

  it('appends repeated presets without overwriting manual or preset-populated rows', () => {
    const rows = [{ ...emptyRow('lab'), materialName: 'Manual lab', costAmount: 10, isPristine: false }];
    const preset = { id: ids.lab, costType: 'lab' as const, label: 'Crown Lab', amount: 300 };
    const once = applyMaterialCostPreset(rows, preset, emptyRow);
    const twice = applyMaterialCostPreset(once, preset, emptyRow);

    expect(twice.map((row) => row.materialName)).toEqual(['Manual lab', 'Crown Lab', 'Crown Lab']);
    expect(twice.slice(1).every((row) => row.quantity === 1 && !row.isPristine)).toBe(true);
  });

  it('sorts by configured order and then label without mutating the source', () => {
    const source = [
      { label: 'Z', sortOrder: 1 },
      { label: 'B', sortOrder: 0 },
      { label: 'A', sortOrder: 0 }
    ];
    expect(sortMaterialCostPresets(source).map((item) => item.label)).toEqual(['A', 'B', 'Z']);
    expect(source.map((item) => item.label)).toEqual(['Z', 'B', 'A']);
  });
});