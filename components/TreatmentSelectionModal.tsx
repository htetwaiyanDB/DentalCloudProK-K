import React, { useMemo, useState } from 'react';
import { X, Check, Sparkles } from 'lucide-react';
import { ClinicalRecord, MedicineSale } from '../types';
import { formatCurrency, Currency } from '../utils/currency';
import { formatTeethWithPosition } from '../utils/toothNumbering';
import { isReceiptItemRecent } from '../utils/receiptItemRecency';
import { groupReceiptTreatmentsByDate, splitReceiptTreatmentsByDate } from '../utils/receiptTreatmentGroups';
import { resolveMedicineSalePricing } from '../utils/medicineSalePricing';

interface TreatmentSelectionModalProps {
  treatments: ClinicalRecord[];
  medicines?: MedicineSale[];
  currency: Currency;
  onConfirm: (selectedTreatments: ClinicalRecord[], selectedMedicines: MedicineSale[]) => void;
  onClose: () => void;
}

const TreatmentSelectionModal: React.FC<TreatmentSelectionModalProps> = ({
  treatments,
  medicines = [],
  currency,
  onConfirm,
  onClose
}) => {
  const [selectedTreatmentIds, setSelectedTreatmentIds] = useState<Set<string>>(new Set());
  const [selectedMedicineIds, setSelectedMedicineIds] = useState<Set<string>>(new Set());
  const [showPastTreatments, setShowPastTreatments] = useState(false);
  const [showIndividualTreatments, setShowIndividualTreatments] = useState(false);

  const { today: todayTreatments, past: pastTreatments } = useMemo(
    () => splitReceiptTreatmentsByDate(treatments),
    [treatments]
  );
  const visibleTreatments = showPastTreatments ? [...todayTreatments, ...pastTreatments] : todayTreatments;
  const treatmentGroups = useMemo(() => groupReceiptTreatmentsByDate(visibleTreatments), [visibleTreatments]);

  const sortedMedicines = useMemo(
    () => [...medicines].sort((a, b) => new Date(b.date || '').getTime() - new Date(a.date || '').getTime()),
    [medicines]
  );

  const toggleSelection = (setState: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setState((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleTreatmentGroup = (group: ClinicalRecord[]) => {
    setSelectedTreatmentIds((previous) => {
      const next = new Set(previous);
      const shouldSelect = group.some((treatment) => !next.has(treatment.id));
      group.forEach((treatment) => shouldSelect ? next.add(treatment.id) : next.delete(treatment.id));
      return next;
    });
  };

  const selectedTreatments = treatments.filter((treatment) => selectedTreatmentIds.has(treatment.id));
  const selectedMedicines = medicines.filter((medicine) => selectedMedicineIds.has(medicine.id));
  const treatmentTotal = selectedTreatments.reduce((sum, treatment) => sum + (treatment.cost || 0), 0);
  const medicineTotal = selectedMedicines.reduce((sum, medicine) => sum + (medicine.total_price || 0), 0);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-gray-200 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Select Receipt Items</h2>
            <p className="text-sm text-gray-500 mt-1">Choose treatments and any standalone medicine items to include on the receipt.</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedTreatmentIds(new Set(visibleTreatments.map((treatment) => treatment.id)))}
              className="px-3 py-1 text-sm bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 font-medium"
            >
              All Visible Treatments
            </button>
            <button
              onClick={() => setSelectedTreatmentIds(new Set())}
              className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
            >
              Clear Treatments
            </button>
            <button
              onClick={() => setSelectedMedicineIds(new Set(medicines.map((medicine) => medicine.id)))}
              className="px-3 py-1 text-sm bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 font-medium"
            >
              All Medicines
            </button>
            <button
              onClick={() => setSelectedMedicineIds(new Set())}
              className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
            >
              Clear Medicines
            </button>
            <div className="flex-1" />
            <div className="text-sm text-gray-600 font-medium">
              Selected: {selectedTreatmentIds.size} treatments · {selectedMedicineIds.size} medicines
            </div>
          </div>

          <div className="space-y-6">
            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">Treatments</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {showPastTreatments ? 'Today and earlier treatment visits.' : "Today’s treatment visits only."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (showPastTreatments) {
                        const pastTreatmentIds = new Set(pastTreatments.map((treatment) => treatment.id));
                        setSelectedTreatmentIds((selectedIds) => new Set([...selectedIds].filter((id) => !pastTreatmentIds.has(id))));
                      }
                      setShowPastTreatments((visible) => !visible);
                    }}
                    className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-50"
                  >
                    {showPastTreatments ? 'Hide Past Treatments' : 'Past Treatments'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowIndividualTreatments((visible) => !visible)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${showIndividualTreatments ? 'bg-slate-700 text-white hover:bg-slate-800' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                  >
                    {showIndividualTreatments ? 'Done' : 'Advanced'}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {visibleTreatments.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-8 text-center text-sm text-slate-500">
                    {showPastTreatments ? 'No treatments available.' : 'No treatments were completed today. Use Past Treatments to select an earlier visit.'}
                  </div>
                ) : (
                  showIndividualTreatments ? visibleTreatments.map((treatment) => {
                    const isSelected = selectedTreatmentIds.has(treatment.id);
                    const recent = isReceiptItemRecent(treatment.date || '');
                    return (
                      <button
                        type="button"
                        key={treatment.id}
                        onClick={() => toggleSelection(setSelectedTreatmentIds, treatment.id)}
                        className={`relative w-full p-4 border-2 rounded-lg cursor-pointer text-left transition-all ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-50'
                            : recent
                              ? 'border-amber-300 bg-amber-50/40 hover:border-amber-400'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        {recent ? (
                          <div className="absolute -top-2.5 -right-2.5 flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                            <Sparkles className="w-3 h-3" />
                            Recent
                          </div>
                        ) : null}
                        <div className="flex items-start gap-4">
                          <div className={`mt-1 w-6 h-6 rounded border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'}`}>
                            {isSelected ? <Check className="w-4 h-4 text-white" /> : null}
                          </div>
                          <div className="flex-1">
                            <div className="flex justify-between items-start mb-1">
                              <div className="flex items-center gap-2">
                                <h4 className="font-semibold text-gray-900">{treatment.description}</h4>
                              </div>
                              <span className="text-base font-bold text-gray-900">
                                {formatCurrency(treatment.cost || 0, currency)}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                              <span>
                                Date: {new Date(treatment.date).toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric'
                                })}
                              </span>
                              {treatment.teeth && treatment.teeth.length > 0 ? (
                                <span>Teeth: {formatTeethWithPosition(treatment.teeth)}</span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  }) : treatmentGroups.map((group) => {
                    const selectedCount = group.treatments.filter((treatment) => selectedTreatmentIds.has(treatment.id)).length;
                    const isSelected = selectedCount === group.treatments.length;
                    const isPartiallySelected = selectedCount > 0 && !isSelected;
                    const recent = isReceiptItemRecent(group.date || '');
                    const treatmentNames = group.treatments.map((treatment) => treatment.description).join(' · ');
                    return (
                      <button
                        type="button"
                        key={group.date || group.treatments.map((treatment) => treatment.id).join('-')}
                        onClick={() => toggleTreatmentGroup(group.treatments)}
                        className={`relative w-full cursor-pointer rounded-lg border-2 p-4 text-left transition-all ${isSelected ? 'border-indigo-500 bg-indigo-50' : isPartiallySelected ? 'border-indigo-300 bg-indigo-50/50' : recent ? 'border-amber-300 bg-amber-50/40 hover:border-amber-400' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                      >
                        {recent ? (
                          <div className="absolute -top-2.5 -right-2.5 flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                            <Sparkles className="h-3 w-3" /> Today
                          </div>
                        ) : null}
                        <div className="flex items-start gap-4">
                          <div className={`mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border-2 ${isSelected ? 'border-indigo-600 bg-indigo-600' : isPartiallySelected ? 'border-indigo-500 bg-indigo-100' : 'border-gray-300'}`}>
                            {(isSelected || isPartiallySelected) ? <Check className={`h-4 w-4 ${isSelected ? 'text-white' : 'text-indigo-600'}`} /> : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                              <div>
                                <h4 className="font-semibold text-gray-900">
                                  {new Date(group.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                                </h4>
                                <p className="mt-0.5 text-sm text-slate-600">{group.treatments.length} {group.treatments.length === 1 ? 'treatment' : 'treatments'} · {treatmentNames}</p>
                              </div>
                              <span className="text-base font-bold text-gray-900">{formatCurrency(group.total, currency)}</span>
                            </div>
                            {isPartiallySelected ? <p className="mt-2 text-xs font-medium text-indigo-700">{selectedCount} of {group.treatments.length} treatments selected</p> : null}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-600">Medicines & Items</h3>
              <div className="space-y-2">
                {sortedMedicines.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 italic">No medicine sales available</div>
                ) : (
                  sortedMedicines.map((medicine) => {
                    const pricing = resolveMedicineSalePricing(medicine as MedicineSale & Record<string, unknown>);
                    const isSelected = selectedMedicineIds.has(medicine.id);
                    const recent = isReceiptItemRecent(medicine.date || '');
                    const stale = !recent;
                    return (
                      <div
                        key={medicine.id}
                        onClick={() => toggleSelection(setSelectedMedicineIds, medicine.id)}
                        className={`relative p-4 border-2 rounded-lg cursor-pointer transition-all ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-50'
                            : recent
                              ? 'border-amber-300 bg-amber-50/40 hover:border-amber-400'
                              : 'border-slate-200 bg-slate-100 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          <div className={`mt-1 w-6 h-6 rounded border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300'}`}>
                            {isSelected ? <Check className="w-4 h-4 text-white" /> : null}
                          </div>
                          <div className="flex-1">
                            <div className="flex justify-between items-start mb-1">
                              <div className="flex items-center gap-2">
                                <h4 className={`font-semibold ${stale && !isSelected ? 'text-slate-600' : 'text-gray-900'}`}>{medicine.medicine_name || 'Medicine'}</h4>
                                {recent ? (
                                  <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                                    <Sparkles className="w-2.5 h-2.5" />
                                    NEW
                                  </span>
                                ) : null}
                              </div>
                              <span className={`text-base font-bold ${stale && !isSelected ? 'text-slate-500' : 'text-gray-900'}`}>
                                {pricing.discountAmount > 0 && <span className="mr-2 text-xs font-medium text-slate-400 line-through">{formatCurrency(pricing.standardTotal, currency)}</span>}
                                {formatCurrency(pricing.finalTotal, currency)}
                              </span>
                            </div>
                            <div className={`flex flex-wrap gap-4 text-sm ${stale && !isSelected ? 'text-slate-500' : 'text-gray-600'}`}>
                              <span>
                                Date: {new Date(medicine.date).toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric'
                                })}
                              </span>
                              <span>Qty: {medicine.quantity}</span>
                              <span>Unit: {formatCurrency(medicine.unit_price || 0, currency)}</span>
                              {pricing.note && <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${pricing.note === 'FOC' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{pricing.note}: -{formatCurrency(pricing.discountAmount, currency)}</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-between items-center">
          <div>
            <p className="text-sm text-gray-600">Total Selected:</p>
            <p className="text-lg font-bold text-gray-900">{formatCurrency(treatmentTotal + medicineTotal, currency)}</p>
            <p className="text-xs text-gray-500 mt-1">
              Treatments {formatCurrency(treatmentTotal, currency)} · Medicines {formatCurrency(medicineTotal, currency)}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(selectedTreatments, selectedMedicines)}
              disabled={selectedTreatmentIds.size === 0 && selectedMedicineIds.size === 0}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Generate Receipt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TreatmentSelectionModal;
