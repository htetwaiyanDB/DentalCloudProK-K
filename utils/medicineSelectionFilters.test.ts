import { describe, expect, it } from 'vitest';

import type { Medicine } from '../types';
import {
  filterMedicinesForSelection,
  getAvailableMedicines,
  getMedicineFilterOptions
} from './medicineSelectionFilters';

const medicine = (overrides: Partial<Medicine>): Medicine => ({
  id: 'medicine-1',
  location_id: 'branch-1',
  name: 'Amoxicillin 500mg',
  description: 'Oral antibiotic capsules',
  unit: 'box',
  item_type: 'Medicine',
  price: 10,
  stock: 8,
  category: 'Antibiotics',
  ...overrides
});

const inventory = [
  medicine({}),
  medicine({
    id: 'retail-1',
    name: 'Soft Toothbrush',
    description: 'Sensitive bristles',
    item_type: 'Retail',
    category: 'Oral Care',
    unit: 'piece'
  }),
  medicine({
    id: 'supply-1',
    name: 'Examination Gloves',
    description: 'Nitrile',
    item_type: 'Supply',
    category: 'PPE',
    unit: 'box'
  }),
  medicine({ id: 'out-1', name: 'Out of stock item', stock: 0 })
];

const baseFilters = { searchTerm: '', itemType: '', category: '', selectedOnly: false };

describe('medicine selection filters', () => {
  it('keeps only inventory with positive stock', () => {
    expect(getAvailableMedicines(inventory).map((item) => item.id)).toEqual([
      'medicine-1',
      'retail-1',
      'supply-1'
    ]);
  });

  it('searches all useful inventory fields without case sensitivity', () => {
    const available = getAvailableMedicines(inventory);

    expect(filterMedicinesForSelection(available, { ...baseFilters, searchTerm: 'TOOTH' }, new Set()).map((item) => item.id)).toEqual(['retail-1']);
    expect(filterMedicinesForSelection(available, { ...baseFilters, searchTerm: 'nitrile' }, new Set()).map((item) => item.id)).toEqual(['supply-1']);
    expect(filterMedicinesForSelection(available, { ...baseFilters, searchTerm: 'antibiotics' }, new Set()).map((item) => item.id)).toEqual(['medicine-1']);
    expect(filterMedicinesForSelection(available, { ...baseFilters, searchTerm: 'piece' }, new Set()).map((item) => item.id)).toEqual(['retail-1']);
  });

  it('combines type, category, and selected-only filters', () => {
    const available = getAvailableMedicines(inventory);
    const selectedIds = new Set(['retail-1']);

    expect(filterMedicinesForSelection(available, {
      searchTerm: 'soft',
      itemType: 'Retail',
      category: 'Oral Care',
      selectedOnly: true
    }, selectedIds).map((item) => item.id)).toEqual(['retail-1']);

    expect(filterMedicinesForSelection(
      available,
      { ...baseFilters, itemType: 'Supply', selectedOnly: true },
      selectedIds
    )).toEqual([]);
  });

  it('builds sorted unique options and defaults legacy item types to Medicine', () => {
    const available = getAvailableMedicines([
      ...inventory,
      medicine({ id: 'legacy-1', item_type: undefined, category: 'Antibiotics' })
    ]);

    expect(getMedicineFilterOptions(available)).toEqual({
      itemTypes: ['Medicine', 'Retail', 'Supply'],
      categories: ['Antibiotics', 'Oral Care', 'PPE']
    });
  });
});