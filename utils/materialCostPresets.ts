import type { MaterialLabCostPreset, MaterialLabCostPresetInput, TreatmentCostType } from '../types';

export interface MaterialCostDraftRow {
  localId: string;
  materialName: string;
  costType: TreatmentCostType;
  costAmount: number;
  quantity: number;
  isPristine: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PRESETS = 100;
const MAX_AMOUNT = 9_999_999_999.99;

export const createPresetId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

export const sortMaterialCostPresets = <T extends Pick<MaterialLabCostPreset, 'sortOrder' | 'label'>>(presets: T[]): T[] => (
  [...presets].sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label))
);

export const normalizeMaterialCostPresetInputs = (
  presets: MaterialLabCostPresetInput[]
): MaterialLabCostPresetInput[] => {
  if (!Array.isArray(presets)) throw new Error('Presets must be a list.');
  if (presets.length > MAX_PRESETS) throw new Error(`A maximum of ${MAX_PRESETS} presets is allowed.`);

  const seenIds = new Set<string>();
  const normalized = presets.map((preset, index) => {
    const id = String(preset.id || '').trim();
    const label = String(preset.label || '').trim();
    const amount = Number(preset.amount);
    const roundedAmount = Math.round((amount + Number.EPSILON) * 100) / 100;
    const costType = preset.costType;

    if (!UUID_PATTERN.test(id)) throw new Error(`Preset ${index + 1} has an invalid identifier.`);
    if (seenIds.has(id)) throw new Error('Each preset must have a unique identifier.');
    seenIds.add(id);
    if (costType !== 'material' && costType !== 'lab' && costType !== 'special_doctor') throw new Error(`Preset ${index + 1} needs a valid category.`);
    if (!label) throw new Error(`Preset ${index + 1} needs a label.`);
    if (label.length > 255) throw new Error(`Preset ${index + 1} label must be 255 characters or fewer.`);
    if (!Number.isFinite(amount) || roundedAmount <= 0 || roundedAmount > MAX_AMOUNT) {
      throw new Error(`Preset ${index + 1} needs an amount greater than zero.`);
    }

    return {
      id,
      costType,
      label,
      amount: roundedAmount,
      sortOrder: index
    };
  });

  return normalized;
};

export const applyMaterialCostPreset = (
  rows: MaterialCostDraftRow[],
  preset: Pick<MaterialLabCostPreset, 'id' | 'costType' | 'label' | 'amount'>,
  createEmptyRow: (costType: TreatmentCostType) => MaterialCostDraftRow
): MaterialCostDraftRow[] => {
  const targetIndex = rows.findIndex((row) => row.costType === preset.costType && row.isPristine);
  const populated = {
    ...(targetIndex >= 0 ? rows[targetIndex] : createEmptyRow(preset.costType)),
    materialName: preset.label,
    costAmount: preset.amount,
    quantity: 1,
    isPristine: false
  };

  if (targetIndex < 0) return [...rows, populated];
  return rows.map((row, index) => index === targetIndex ? populated : row);
};