import React from 'react';
import { Beaker, Loader2, Package, Plus, Settings2, Stethoscope, Trash2 } from 'lucide-react';
import type { ClinicalRecord, MaterialLabCostPreset, MaterialLabCostPresetInput, PatientMaterialCostInput, TreatmentCostSummary, TreatmentCostType } from '../types';
import { api } from '../services/api';
import { auth } from '../services/auth';
import { formatCurrency, type Currency } from '../utils/currency';
import { formatDoctorName } from '../utils/doctorName';
import { canManageMaterialCosts } from '../utils/permissions';
import { applyMaterialCostPreset, sortMaterialCostPresets, type MaterialCostDraftRow } from '../utils/materialCostPresets';
import { Modal } from './Shared';
import MaterialCostPresetManager from './MaterialCostPresetManager';

interface MaterialCostModalProps {
  isOpen: boolean;
  record: (ClinicalRecord & { _groupedRecords?: ClinicalRecord[] }) | null;
  currency: Currency;
  onClose: () => void;
  onSaved: (summary: TreatmentCostSummary & { treatmentId: string; patientId?: string | null }) => void | Promise<void>;
}

type CostDraft = PatientMaterialCostInput & MaterialCostDraftRow;
const createEmptyDraft = (costType: TreatmentCostType): CostDraft => ({ localId: `${costType}-${Date.now()}-${Math.random().toString(36).slice(2)}`, materialName: '', costType, costAmount: 0, quantity: 1, isPristine: true });
const isVisible = (item: CostDraft) => item.materialName.trim() || item.costAmount > 0 || item.quantity !== 1;
const getTotal = (items: CostDraft[]) => items.filter(isVisible).reduce((sum, item) => sum + Number(item.costAmount || 0) * Number(item.quantity || 0), 0);
const getRecordActivity = (record: MaterialCostModalProps['record']) => {
  if (!record) return '-';
  const rows = record._groupedRecords?.length ? record._groupedRecords : [record];
  return rows.map((item) => item.description).filter(Boolean).join(' + ') || 'Treatment record';
};

const MaterialCostModal: React.FC<MaterialCostModalProps> = ({ isOpen, record, currency, onClose, onSaved }) => {
  const [items, setItems] = React.useState<CostDraft[]>([createEmptyDraft('material'), createEmptyDraft('lab'), createEmptyDraft('special_doctor')]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [presets, setPresets] = React.useState<MaterialLabCostPreset[]>([]);
  const [presetRevision, setPresetRevision] = React.useState(0);
  const [presetsLoading, setPresetsLoading] = React.useState(false);
  const [presetError, setPresetError] = React.useState<string | null>(null);
  const [showPresetManager, setShowPresetManager] = React.useState(false);
  const [presetsSaving, setPresetsSaving] = React.useState(false);
  const [presetManagerError, setPresetManagerError] = React.useState<string | null>(null);
  const presetRequestVersion = React.useRef(0);

  React.useEffect(() => {
    if (!isOpen || !record) return;
    let cancelled = false;
    setLoading(true); setSaving(false); setError(null); setLoadFailed(false);
    api.materialCosts.getByTreatmentId(record.id).then(({ items: saved }) => {
      if (cancelled) return;
      const drafts: CostDraft[] = saved.map((item) => ({ localId: item.id, materialName: item.materialName, costType: item.costType, costAmount: item.costAmount, quantity: item.quantity, isPristine: false }));
      if (!drafts.some((item) => item.costType === 'material')) drafts.push(createEmptyDraft('material'));
      if (!drafts.some((item) => item.costType === 'lab')) drafts.push(createEmptyDraft('lab'));
      if (!drafts.some((item) => item.costType === 'special_doctor')) drafts.push(createEmptyDraft('special_doctor'));
      setItems(drafts);
    }).catch((err: any) => {
      if (!cancelled) { setError(err?.message || 'Failed to load treatment costs.'); setLoadFailed(true); setItems([createEmptyDraft('material'), createEmptyDraft('lab'), createEmptyDraft('special_doctor')]); }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, record]);

  const loadPresets = React.useCallback(async () => {
    const requestVersion = ++presetRequestVersion.current;
    const session = auth.getSession();
    if (!session?.userId || !session.staffAuthToken || !canManageMaterialCosts(session.role, session.allowed_tabs)) {
      setPresets([]);
      setPresetRevision(0);
      setPresetsLoading(false);
      setPresetError('Cost presets need a current staff session. Manual entry is still available.');
      return;
    }
    setPresetsLoading(true);
    setPresetError(null);
    try {
      const result = await api.materialCosts.getPresets({ userId: session.userId, authToken: session.staffAuthToken });
      if (requestVersion !== presetRequestVersion.current) return;
      setPresets(result.presets);
      setPresetRevision(result.revision);
    } catch (presetLoadError: any) {
      if (requestVersion !== presetRequestVersion.current) return;
      setPresets([]);
      setPresetRevision(0);
      setPresetError(`${presetLoadError?.message || 'Unable to load cost presets.'} Manual entry is still available.`);
    } finally {
      if (requestVersion === presetRequestVersion.current) setPresetsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!isOpen || !record) return;
    setShowPresetManager(false);
    setPresetManagerError(null);
    void loadPresets();
    return () => { presetRequestVersion.current += 1; };
  }, [isOpen, record, loadPresets]);

  if (!isOpen || !record) return null;
  const updateItem = (id: string, patch: Partial<CostDraft>) => setItems((current) => current.map((item) => item.localId === id ? { ...item, ...patch, isPristine: false } : item));
  const removeItem = (id: string, type: TreatmentCostType) => setItems((current) => {
    const remaining = current.filter((item) => item.localId !== id);
    return remaining.some((item) => item.costType === type) ? remaining : [...remaining, createEmptyDraft(type)];
  });
  const visibleItems = items.filter(isVisible);
  const materialTotal = getTotal(items.filter((item) => item.costType === 'material'));
  const labTotal = getTotal(items.filter((item) => item.costType === 'lab'));
  const specialDoctorTotal = getTotal(items.filter((item) => item.costType === 'special_doctor'));

  const handleApplyPreset = (preset: MaterialLabCostPreset) => {
    setItems((current) => applyMaterialCostPreset(current, preset, createEmptyDraft));
  };

  const handleSavePresets = async (nextPresets: MaterialLabCostPresetInput[]) => {
    const session = auth.getSession();
    if (!session?.userId || !session.staffAuthToken || !canManageMaterialCosts(session.role, session.allowed_tabs)) {
      throw new Error('You do not have a current staff session for managing presets.');
    }
    setPresetsSaving(true);
    setPresetManagerError(null);
    try {
      const result = await api.materialCosts.replacePresets(nextPresets, presetRevision, { userId: session.userId, authToken: session.staffAuthToken });
      setPresets(sortMaterialCostPresets(result.presets));
      setPresetRevision(result.revision);
      setPresetError(null);
      setShowPresetManager(false);
    } catch (presetSaveError: any) {
      const message = presetSaveError?.message || 'Unable to save cost presets.';
      setPresetManagerError(message);
      throw new Error(message);
    } finally {
      setPresetsSaving(false);
    }
  };

  if (showPresetManager) {
    return <MaterialCostPresetManager
      isOpen
      presets={presets}
      currency={currency}
      saving={presetsSaving || presetsLoading}
      error={presetManagerError}
      onClose={() => { if (!presetsSaving && !presetsLoading) setShowPresetManager(false); }}
      onReload={async () => { setPresetManagerError(null); await loadPresets(); }}
      onSave={handleSavePresets}
    />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const session = auth.getSession();
      if (!session?.userId || !canManageMaterialCosts(session.role, session.allowed_tabs)) throw new Error('You do not have permission to update treatment costs.');
      if (!session.staffAuthToken) throw new Error('Your staff session needs a one-time refresh. Sign out and sign back in, then save again.');
      const incomplete = visibleItems.find((item) => !item.materialName.trim() || Number(item.costAmount) <= 0 || Number(item.quantity) <= 0);
      if (incomplete) throw new Error(`Each ${incomplete.costType === 'lab' ? 'lab cost' : incomplete.costType === 'special_doctor' ? 'special doctor cost' : 'material'} needs a name, a cost greater than zero, and a quantity greater than zero.`);
      const result = await api.materialCosts.upsertForTreatment(record, visibleItems.map((item) => ({ materialName: item.materialName.trim(), costType: item.costType, costAmount: Number(item.costAmount), quantity: Number(item.quantity) })), { userId: session.userId, username: session.username, authToken: session.staffAuthToken });
      const materialRows = result.items.filter((item) => item.costType === 'material');
      const labRows = result.items.filter((item) => item.costType === 'lab');
      const specialDoctorRows = result.items.filter((item) => item.costType === 'special_doctor');
      const savedMaterialTotal = materialRows.reduce((sum, item) => sum + item.totalAmount, 0);
      const savedLabTotal = labRows.reduce((sum, item) => sum + item.totalAmount, 0);
      const savedSpecialDoctorTotal = specialDoctorRows.reduce((sum, item) => sum + item.totalAmount, 0);
      const summary = { treatmentId: record.id, patientId: record.patient_id || record._groupedRecords?.[0]?.patient_id || null, auditLogId: result.auditLogId, materialTotal: savedMaterialTotal, materialItemCount: materialRows.length, labTotal: savedLabTotal, labItemCount: labRows.length, specialDoctorTotal: savedSpecialDoctorTotal, specialDoctorItemCount: specialDoctorRows.length, totalAmount: savedMaterialTotal + savedLabTotal + savedSpecialDoctorTotal, itemCount: result.items.length };
      if (result.commissionRefreshPending) {
        setError('Treatment costs were saved, but doctor commission refresh is still pending. Keep this window open and select Save Treatment Costs again to retry.');
        return;
      }
      try {
        await onSaved(summary);
      } catch (refreshError) {
        console.warn('Costs were saved, but the table refresh needs retry.', refreshError);
        setError('Treatment costs were saved, but some screens could not refresh. Close this window and reopen MLS to refresh the latest totals.');
        return;
      }
      onClose();
    } catch (err: any) { setError(err?.message || 'Failed to save treatment costs.'); }
    finally { setSaving(false); }
  };

  const renderSection = (costType: TreatmentCostType) => {
    const lab = costType === 'lab';
    const specialDoctor = costType === 'special_doctor';
    const label = lab ? 'Lab Cost' : specialDoctor ? 'Special Doctor Cost' : 'Material Cost';
    return <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4" aria-labelledby={`${costType}-heading`}>
      <div className="flex items-center justify-between gap-3"><div><h3 id={`${costType}-heading`} className="text-sm font-black text-slate-900">{label}</h3><p className="mt-0.5 text-xs text-slate-500">{lab ? 'External laboratory services and fabrication costs.' : specialDoctor ? 'External or special doctor work for this treatment.' : 'Materials consumed for this treatment.'}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${lab ? 'bg-violet-50 text-violet-700' : specialDoctor ? 'bg-amber-50 text-amber-700' : 'bg-cyan-50 text-cyan-700'}`}>{formatCurrency(lab ? labTotal : specialDoctor ? specialDoctorTotal : materialTotal, currency)}</span></div>
      <div className="hidden grid-cols-[minmax(0,1fr)_150px_120px_44px] gap-3 px-1 text-[10px] font-black uppercase tracking-wider text-slate-400 sm:grid"><span>{lab ? 'Lab / Service' : specialDoctor ? 'Doctor / Service' : 'Material'}</span><span>Unit Cost</span><span>Quantity</span><span /></div>
      {items.filter((item) => item.costType === costType).map((item, index) => <div key={item.localId} className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 sm:grid-cols-[minmax(0,1fr)_150px_120px_44px] sm:border-0 sm:bg-transparent sm:p-0">
        <div><label className="mb-1 block text-xs font-bold text-slate-500 sm:hidden" htmlFor={`${item.localId}-name`}>{lab ? 'Lab / Service' : specialDoctor ? 'Doctor / Service' : 'Material'}</label><input id={`${item.localId}-name`} aria-label={`${label} row ${index + 1} name`} type="text" maxLength={255} value={item.materialName} onChange={(e) => updateItem(item.localId, { materialName: e.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--hover-500)] focus:ring-4 focus:ring-[var(--hover-100)]" placeholder={lab ? 'e.g. Crown fabrication' : specialDoctor ? 'e.g. Visiting surgeon' : 'e.g. Composite resin'} /></div>
        <div><label className="mb-1 block text-xs font-bold text-slate-500 sm:hidden" htmlFor={`${item.localId}-cost`}>Unit Cost</label><input id={`${item.localId}-cost`} aria-label={`${label} row ${index + 1} unit cost`} type="number" min="0.01" step="0.01" value={item.costAmount || ''} onChange={(e) => updateItem(item.localId, { costAmount: Number(e.target.value || 0) })} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--hover-500)] focus:ring-4 focus:ring-[var(--hover-100)]" placeholder="0" /></div>
        <div><label className="mb-1 block text-xs font-bold text-slate-500 sm:hidden" htmlFor={`${item.localId}-quantity`}>Quantity</label><input id={`${item.localId}-quantity`} aria-label={`${label} row ${index + 1} quantity`} type="number" min="0.01" step="0.01" value={item.quantity || ''} onChange={(e) => updateItem(item.localId, { quantity: Number(e.target.value || 0) })} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--hover-500)] focus:ring-4 focus:ring-[var(--hover-100)]" placeholder="1" /></div>
        <button type="button" onClick={() => removeItem(item.localId, costType)} className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-red-100 bg-red-50 text-red-600 hover:bg-red-100 sm:w-11" aria-label={`Remove ${label.toLowerCase()} row`}><Trash2 size={16} /></button>
      </div>)}
      <button type="button" onClick={() => setItems((current) => [...current, createEmptyDraft(costType)])} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--hover-200)] bg-[var(--hover-50)] px-4 py-2.5 text-sm font-bold text-[var(--hover-700)] hover:bg-[var(--hover-100)]"><Plus size={16} />Add {lab ? 'Lab Cost' : 'Material'}</button>
    </section>;
  };

  return <Modal title="MLS Costs" onClose={onClose} closeDisabled={saving || presetsSaving} maxWidthClassName="max-w-5xl"><form onSubmit={handleSubmit} className="space-y-5">
    <div className="grid gap-3 rounded-2xl border border-[var(--hover-100)] bg-[var(--hover-50)]/70 p-4 sm:grid-cols-3"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--hover-700)]">Patient</p><p className="mt-1 text-sm font-bold text-slate-900">{record.patient_name || 'Unknown'}</p></div><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--hover-700)]">Clinician</p><p className="mt-1 text-sm font-bold text-slate-900">{formatDoctorName(record.doctor_name)}</p></div><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--hover-700)]">Clinical Activity</p><p className="mt-1 text-sm font-bold text-slate-900">{getRecordActivity(record)}</p></div></div>
    <section aria-labelledby="cost-presets-heading" className="rounded-2xl border border-[var(--hover-100)] bg-[var(--hover-50)]/50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 id="cost-presets-heading" className="text-sm font-black text-slate-900">Frequently Used Costs</h3><p className="mt-0.5 text-xs text-slate-500">Select a preset to add an editable row with quantity 1.</p></div><button type="button" onClick={() => { setPresetManagerError(null); setShowPresetManager(true); }} disabled={presetsLoading || saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--hover-200)] bg-white px-4 py-2 text-sm font-bold text-[var(--hover-700)] hover:bg-[var(--hover-50)] disabled:opacity-50"><Settings2 size={16} />Manage Presets</button></div>
      {presetsLoading ? <div className="mt-3 flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-500"><Loader2 size={16} className="animate-spin" />Loading presets...</div> : presets.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">{presets.map((preset) => {
        const lab = preset.costType === 'lab';
        const specialDoctor = preset.costType === 'special_doctor';
        const presetLabel = lab ? 'Lab' : specialDoctor ? 'Special Doctor' : 'Material';
        return <button key={preset.id} type="button" onClick={() => handleApplyPreset(preset)} disabled={loading || saving} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${lab ? 'border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100' : specialDoctor ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100' : 'border-cyan-200 bg-cyan-50 text-cyan-800 hover:bg-cyan-100'}`} aria-label={`Add ${preset.label}, ${formatCurrency(preset.amount, currency)}, as ${presetLabel.toLowerCase()} cost`}>{lab ? <Beaker size={16} /> : specialDoctor ? <Stethoscope size={16} /> : <Package size={16} />}<span><span className="block text-xs font-black">{preset.label}</span><span className="block text-[11px] font-semibold opacity-80">{formatCurrency(preset.amount, currency)} · {presetLabel}</span></span></button>;
      })}</div> : !presetError && <p className="mt-3 text-xs font-semibold text-slate-500">No presets yet. Manual entry works as before, or select Manage Presets to create one.</p>}
      {presetError && <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{presetError}</div>}
    </section>
    {loading ? <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-8 text-sm font-semibold text-slate-500"><Loader2 size={18} className="animate-spin" />Loading treatment costs...</div> : <div className="space-y-4">{renderSection('material')}{renderSection('lab')}{renderSection('special_doctor')}</div>}
    <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-4"><div className="flex items-center justify-between gap-2 text-sm font-bold text-cyan-700"><span className="inline-flex items-center gap-2"><Package size={17} />Material</span><span>{formatCurrency(materialTotal, currency)}</span></div><div className="flex items-center justify-between gap-2 text-sm font-bold text-violet-700"><span className="inline-flex items-center gap-2"><Beaker size={17} />Lab</span><span>{formatCurrency(labTotal, currency)}</span></div><div className="flex items-center justify-between gap-2 text-sm font-bold text-amber-700"><span className="inline-flex items-center gap-2"><Stethoscope size={17} />Special Doctor</span><span>{formatCurrency(specialDoctorTotal, currency)}</span></div><div className="flex items-center justify-between gap-2 text-base font-black text-slate-900"><span>Combined total</span><span>{formatCurrency(materialTotal + labTotal + specialDoctorTotal, currency)}</span></div></div>
    {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">{error}{loadFailed ? ' Close this window and reopen the treatment to retry loading.' : ''}</div>}
    <div className="flex justify-end gap-3 border-t border-slate-200 pt-5"><button type="button" onClick={onClose} disabled={saving} className="min-h-11 rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Cancel</button><button type="submit" disabled={loading || saving || loadFailed} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--hover-600)] px-5 py-3 text-sm font-black text-white hover:bg-[var(--hover-700)] disabled:cursor-not-allowed disabled:bg-slate-300">{saving ? <Loader2 size={16} className="animate-spin" /> : <Package size={16} />}{saving ? 'Saving...' : loadFailed ? 'Reload Required' : 'Save Treatment Costs'}</button></div>
  </form></Modal>;
};

export default MaterialCostModal;