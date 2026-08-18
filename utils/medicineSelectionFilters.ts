import type { Medicine } from '../types';

export interface MedicineSelectionFilters {
  searchTerm: string;
  itemType: string;
  category: string;
  selectedOnly: boolean;
}

const normalize = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase();

export const getAvailableMedicines = (medicines: Medicine[]): Medicine[] =>
  medicines.filter((medicine) => Number(medicine.stock) > 0);

export const getMedicineFilterOptions = (medicines: Medicine[]) => ({
  itemTypes: [...new Set(
    medicines
      .map((medicine) => (medicine.item_type || 'Medicine').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b)),
  categories: [...new Set(
    medicines
      .map((medicine) => medicine.category?.trim())
      .filter((category): category is string => Boolean(category))
  )].sort((a, b) => a.localeCompare(b))
});

export const filterMedicinesForSelection = (
  medicines: Medicine[],
  filters: MedicineSelectionFilters,
  selectedIds: ReadonlySet<string>
): Medicine[] => {
  const searchTerm = normalize(filters.searchTerm);
  const itemType = normalize(filters.itemType);
  const category = normalize(filters.category);

  return medicines.filter((medicine) => {
    if (filters.selectedOnly && !selectedIds.has(medicine.id)) return false;
    if (itemType && normalize(medicine.item_type || 'Medicine') !== itemType) return false;
    if (category && normalize(medicine.category) !== category) return false;
    if (!searchTerm) return true;

    return [
      medicine.name,
      medicine.description,
      medicine.category,
      medicine.item_type || 'Medicine',
      medicine.unit
    ].some((value) => normalize(value).includes(searchTerm));
  });
};