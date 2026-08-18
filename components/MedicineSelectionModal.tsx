import React, { useMemo, useState } from 'react';
import { Gift, Minus, Package, Plus, RotateCcw, Search, X } from 'lucide-react';
import { Medicine } from '../types';
import { Modal } from './Shared';
import { formatCurrency, Currency } from '../utils/currency';
import {
  filterMedicinesForSelection,
  getAvailableMedicines,
  getMedicineFilterOptions
} from '../utils/medicineSelectionFilters';

export interface SelectedMedicineCharge {
  medicine: Medicine;
  quantity: number;
  finalTotal: number;
}

interface MedicineSelectionModalProps {
  medicines: Medicine[];
  currency: Currency;
  onConfirm: (selectedMedicines: SelectedMedicineCharge[]) => void;
  onClose: () => void;
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;
const formatQuantity = (value: number | undefined) => {
  const num = Number(value || 0);
  return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, '');
};

const MedicineSelectionModal: React.FC<MedicineSelectionModalProps> = ({ medicines, currency, onConfirm, onClose }) => {
  const [quantities, setQuantities] = useState<Map<string, number>>(new Map());
  const [finalTotals, setFinalTotals] = useState<Map<string, string>>(new Map());
  const [searchTerm, setSearchTerm] = useState('');
  const [itemType, setItemType] = useState('');
  const [category, setCategory] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const availableMedicines = useMemo(() => getAvailableMedicines(medicines), [medicines]);
  const filterOptions = useMemo(() => getMedicineFilterOptions(availableMedicines), [availableMedicines]);
  const selectedIds = useMemo(
    () => new Set(Array.from(quantities.entries()).filter(([, quantity]) => quantity > 0).map(([id]) => id)),
    [quantities]
  );
  const filteredMedicines = useMemo(() => filterMedicinesForSelection(
    availableMedicines,
    { searchTerm, itemType, category, selectedOnly },
    selectedIds
  ), [availableMedicines, category, itemType, searchTerm, selectedIds, selectedOnly]);
  const hasActiveFilters = Boolean(searchTerm.trim() || itemType || category || selectedOnly);

  const clearFilters = () => {
    setSearchTerm('');
    setItemType('');
    setCategory('');
    setSelectedOnly(false);
  };

  const standardTotal = (medicine: Medicine, quantity: number) => roundMoney(Math.max(0, Number(medicine.price || 0)) * quantity);
  const getFinalTotal = (medicine: Medicine, quantity: number) => {
    const standard = standardTotal(medicine, quantity);
    const raw = finalTotals.get(medicine.id);
    if (raw === undefined) return standard;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? Math.min(standard, Math.max(0, roundMoney(parsed))) : standard;
  };
  const clampToStep = (value: number, max: number, step: number) => {
    const safeStep = step > 0 ? step : 1;
    return Math.max(0, Math.min(max, Number((Math.round(value / safeStep) * safeStep).toFixed(2))));
  };
  const setQuantity = (medicine: Medicine, value: number) => {
    const next = clampToStep(value, Number(medicine.stock), Number(medicine.quantity_step || 1));
    const updated = new Map(quantities);
    if (next === 0) {
      updated.delete(medicine.id);
      setFinalTotals((previous) => { const copy = new Map(previous); copy.delete(medicine.id); return copy; });
    } else {
      updated.set(medicine.id, next);
      setFinalTotals((previous) => {
        if (!previous.has(medicine.id)) return previous;
        const copy = new Map(previous);
        copy.set(medicine.id, String(Math.min(getFinalTotal(medicine, quantities.get(medicine.id) || next), standardTotal(medicine, next))));
        return copy;
      });
    }
    setQuantities(updated);
  };

  const selected = Array.from(quantities.entries()).flatMap(([id, quantity]) => {
    const medicine = medicines.find((candidate) => candidate.id === id);
    return medicine ? [{ medicine, quantity, finalTotal: getFinalTotal(medicine, quantity) }] : [];
  });
  const originalTotal = selected.reduce((sum, item) => sum + standardTotal(item.medicine, item.quantity), 0);
  const finalTotal = selected.reduce((sum, item) => sum + item.finalTotal, 0);
  const discountTotal = Math.max(0, roundMoney(originalTotal - finalTotal));

  return (
    <Modal title="Select Inventory Items" onClose={onClose}>
      <div className="space-y-4">
        {availableMedicines.length === 0 ? (
          <div className="py-8 text-center text-gray-500"><Package className="mx-auto mb-3 h-12 w-12 text-gray-300" /><p>No inventory items available in stock.</p></div>
        ) : <>
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
            <div className="relative">
              <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search name, description, category, type, or unit..."
                aria-label="Search inventory items"
                autoFocus
                className="w-full rounded-xl border border-indigo-200 bg-white py-2.5 pl-10 pr-10 text-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-indigo-500"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  aria-label="Clear inventory search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="sr-only" htmlFor="medicine-item-type-filter">Filter by item type</label>
              <select
                id="medicine-item-type-filter"
                value={itemType}
                onChange={(event) => setItemType(event.target.value)}
                className="min-w-0 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-transparent focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All item types</option>
                {filterOptions.itemTypes.map((type) => <option key={type} value={type}>{type === 'Retail' ? 'Retail Item' : type}</option>)}
              </select>
              <label className="sr-only" htmlFor="medicine-category-filter">Filter by category</label>
              <select
                id="medicine-category-filter"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="min-w-0 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-transparent focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All categories</option>
                {filterOptions.categories.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${selectedOnly ? 'border-indigo-300 bg-indigo-100 text-indigo-800' : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-200'}`}>
                <input
                  type="checkbox"
                  checked={selectedOnly}
                  onChange={(event) => setSelectedOnly(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                Selected only ({selectedIds.size})
              </label>
              <div className="flex items-center gap-3 text-xs">
                <span className="font-semibold text-gray-500" aria-live="polite">
                  {filteredMedicines.length} of {availableMedicines.length} items
                </span>
                {hasActiveFilters && (
                  <button type="button" onClick={clearFilters} className="font-bold text-indigo-700 hover:text-indigo-900">
                    Clear filters
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="max-h-[32rem] space-y-2 overflow-y-auto rounded-xl border border-gray-200 p-4">
            {filteredMedicines.length === 0 ? (
              <div className="py-10 text-center text-gray-500">
                <Search className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="font-bold text-gray-700">No matching items</p>
                <p className="mt-1 text-sm">Try another search or clear the filters.</p>
                <button type="button" onClick={clearFilters} className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-100">
                  Show all in-stock items
                </button>
              </div>
            ) : filteredMedicines.map((medicine) => {
              const quantity = quantities.get(medicine.id) || 0;
              const step = Number(medicine.quantity_step || 1);
              const standard = standardTotal(medicine, quantity);
              const charge = getFinalTotal(medicine, quantity);
              const discount = Math.max(0, roundMoney(standard - charge));
              return (
                <div key={medicine.id} className={`rounded-xl border p-4 transition-colors ${quantity > 0 ? 'border-indigo-200 bg-indigo-50' : 'border-gray-200 bg-white'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div><h4 className="font-bold text-gray-900">{medicine.name}</h4><p className="text-xs text-gray-500">{medicine.unit} · {formatCurrency(medicine.price || 0, currency)} each · {formatQuantity(medicine.stock)} in stock</p></div>
                    {discount > 0 && <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${charge === 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{charge === 0 ? 'FOC' : 'Discount'}</span>}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button type="button" onClick={() => setQuantity(medicine, quantity - step)} disabled={quantity <= 0} className="rounded-lg border border-gray-300 p-1.5 hover:bg-white disabled:opacity-40"><Minus size={16} /></button>
                    <input type="number" min="0" max={medicine.stock} step={step} value={quantity} onChange={(event) => setQuantity(medicine, Number.parseFloat(event.target.value) || 0)} className="w-20 rounded-lg border border-gray-300 py-1.5 text-center text-sm font-medium focus:border-transparent focus:ring-2 focus:ring-indigo-500" aria-label={`${medicine.name} quantity`} />
                    <button type="button" onClick={() => setQuantity(medicine, quantity + step)} disabled={quantity >= medicine.stock} className="rounded-lg border border-gray-300 p-1.5 hover:bg-white disabled:opacity-40"><Plus size={16} /></button>
                    {quantity > 0 && <span className="ml-auto text-sm font-bold text-indigo-700">List {formatCurrency(standard, currency)}</span>}
                  </div>
                  {quantity > 0 && (
                    <div className="mt-3 grid gap-2 rounded-lg border border-indigo-100 bg-white p-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                      <label className="text-xs font-bold text-gray-600">Final charge
                        <input type="number" min="0" max={standard} step="0.01" value={finalTotals.get(medicine.id) ?? String(standard)} onChange={(event) => setFinalTotals((previous) => new Map(previous).set(medicine.id, event.target.value))} onBlur={() => setFinalTotals((previous) => new Map(previous).set(medicine.id, String(charge)))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold focus:border-transparent focus:ring-2 focus:ring-indigo-500" />
                      </label>
                      <button type="button" onClick={() => setFinalTotals((previous) => new Map(previous).set(medicine.id, '0'))} className="inline-flex items-center justify-center gap-1 rounded-lg bg-amber-100 px-3 py-2 text-xs font-black text-amber-800 hover:bg-amber-200"><Gift size={14} /> FOC</button>
                      <button type="button" onClick={() => setFinalTotals((previous) => { const copy = new Map(previous); copy.delete(medicine.id); return copy; })} className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50"><RotateCcw size={14} /> Reset</button>
                      {discount > 0 && <p className="text-xs font-semibold text-emerald-700 sm:col-span-3">Discount: {formatCurrency(discount, currency)} · Patient pays {formatCurrency(charge, currency)}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {selected.length > 0 && <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
            <div className="flex justify-between text-sm text-gray-600"><span>Original items total</span><span>{formatCurrency(originalTotal, currency)}</span></div>
            {discountTotal > 0 && <div className="mt-1 flex justify-between text-sm font-bold text-emerald-700"><span>Item discount</span><span>-{formatCurrency(discountTotal, currency)}</span></div>}
            <div className="mt-2 flex justify-between border-t border-indigo-200 pt-2"><span className="font-bold text-gray-800">Amount added to bill</span><span className="text-lg font-black text-indigo-700">{formatCurrency(finalTotal, currency)}</span></div>
          </div>}
          <div className="flex gap-3"><button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-300 py-3 font-bold text-gray-700 hover:bg-gray-50">Cancel</button><button type="button" onClick={() => onConfirm(selected)} disabled={selected.length === 0} className="flex-1 rounded-xl bg-indigo-600 py-3 font-bold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">Add to Patient Bill</button></div>
        </>}
      </div>
    </Modal>
  );
};

export default MedicineSelectionModal;