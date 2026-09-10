import React from 'react';
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import type { MaterialLabCostPreset, MaterialLabCostPresetInput, TreatmentCostType } from '../types';
import { createPresetId, normalizeMaterialCostPresetInputs } from '../utils/materialCostPresets';
import { type Currency } from '../utils/currency';
import { Modal } from './Shared';

interface MaterialCostPresetManagerProps {
  isOpen: boolean;
  presets: MaterialLabCostPreset[];
  currency: Currency;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onReload: () => void | Promise<void>;
  onSave: (presets: MaterialLabCostPresetInput[]) => void | Promise<void>;
}

const MaterialCostPresetManager: React.FC<MaterialCostPresetManagerProps> = ({
  isOpen,
  presets,
  currency,
  saving,
  error,
  onClose,
  onReload,
  onSave
}) => {
  const [drafts, setDrafts] = React.useState<MaterialLabCostPresetInput[]>([]);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    setDrafts(presets.map((preset, index) => ({
      id: preset.id,
      costType: preset.costType,
      label: preset.label,
      amount: preset.amount,
      sortOrder: index
    })));
    setValidationError(null);
  }, [isOpen, presets]);

  if (!isOpen) return null;

  const updateDraft = (id: string, patch: Partial<MaterialLabCostPresetInput>) => {
    setDrafts((current) => current.map((preset) => preset.id === id ? { ...preset, ...patch } : preset));
    setValidationError(null);
  };
  const addDraft = () => setDrafts((current) => [
    ...current,
    { id: createPresetId(), costType: 'material', label: '', amount: 0, sortOrder: current.length }
  ]);
  const removeDraft = (id: string, label: string) => {
    if (!window.confirm(`Delete preset "${label || 'Untitled preset'}"?`)) return;
    setDrafts((current) => current.filter((preset) => preset.id !== id));
  };
  const moveDraft = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= drafts.length) return;
    setDrafts((current) => {
      const reordered = [...current];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      return reordered;
    });
  };
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      setValidationError(null);
      await onSave(normalizeMaterialCostPresetInputs(drafts));
    } catch (saveError: any) {
      setValidationError(saveError?.message || 'Unable to save presets.');
    }
  };

  const displayedError = validationError || error;
  const currencyLabel = currency === 'MMK' ? 'MMK' : 'USD';

  return <Modal title="Manage Cost Presets" onClose={onClose} closeDisabled={saving} maxWidthClassName="max-w-4xl">
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="rounded-2xl border border-[var(--hover-100)] bg-[var(--hover-50)] px-4 py-3 text-sm text-[var(--hover-800)]">
        Create frequently used treatment costs. Presets fill an editable cost row with quantity 1; they never save a treatment automatically.
      </div>

      <div className="space-y-3">
        {drafts.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="text-sm font-bold text-slate-700">No presets yet</p>
          <p className="mt-1 text-xs text-slate-500">Add your first frequently used cost.</p>
        </div> : drafts.map((preset, index) => {
          const lab = preset.costType === 'lab';
          const specialDoctor = preset.costType === 'special_doctor';
          return <div key={preset.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[140px_minmax(0,1fr)_150px_148px] sm:items-end">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">Category</span>
              <select value={preset.costType} onChange={(event) => updateDraft(preset.id, { costType: event.target.value as TreatmentCostType })} disabled={saving} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-[var(--hover-500)] focus:ring-4 focus:ring-[var(--hover-100)] disabled:bg-slate-100">
                <option value="material">Material</option>
                <option value="lab">Lab</option>
                <option value="special_doctor">Special Doctor</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">Button label</span>
              <input value={preset.label} maxLength={255} onChange={(event) => updateDraft(preset.id, { label: event.target.value })} disabled={saving} placeholder={lab ? 'e.g. Crown Lab' : specialDoctor ? 'e.g. Visiting Specialist' : 'e.g. Composite'} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[var(--hover-500)] focus:ring-4 focus:ring-[var(--hover-100)] disabled:bg-slate-100" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">Amount ({currencyLabel})</span>
              <input type="number" min="0.01" max="9999999999.99" step="0.01" value={preset.amount || ''} onChange={(event) => updateDraft(preset.id, { amount: Number(event.target.value || 0) })} disabled={saving} placeholder="0.00" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[var(--hover-500)] focus:ring-4 focus:ring-[var(--hover-100)] disabled:bg-slate-100" />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => moveDraft(index, -1)} disabled={saving || index === 0} className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35" aria-label={`Move ${preset.label || 'preset'} up`}><ArrowUp size={16} /></button>
              <button type="button" onClick={() => moveDraft(index, 1)} disabled={saving || index === drafts.length - 1} className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35" aria-label={`Move ${preset.label || 'preset'} down`}><ArrowDown size={16} /></button>
              <button type="button" onClick={() => removeDraft(preset.id, preset.label)} disabled={saving} className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-red-100 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50" aria-label={`Delete ${preset.label || 'preset'}`}><Trash2 size={16} /></button>
            </div>
          </div>;
        })}
      </div>

      <button type="button" onClick={addDraft} disabled={saving || drafts.length >= 100} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--hover-200)] bg-[var(--hover-50)] px-4 py-2.5 text-sm font-bold text-[var(--hover-700)] hover:bg-[var(--hover-100)] disabled:opacity-50"><Plus size={16} />Add Preset</button>

      {displayedError && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"><p>{displayedError}</p>{displayedError.includes('another device') && <button type="button" onClick={() => void onReload()} disabled={saving} className="mt-3 min-h-11 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-black text-red-700 hover:bg-red-100 disabled:opacity-50">Reload Latest Presets</button>}</div>}

      <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} disabled={saving} className="min-h-11 rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
        <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--hover-600)] px-5 py-3 text-sm font-black text-white hover:bg-[var(--hover-700)] disabled:bg-slate-300">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{saving ? 'Saving...' : 'Save Presets'}</button>
      </div>
    </form>
  </Modal>;
};

export default MaterialCostPresetManager;
