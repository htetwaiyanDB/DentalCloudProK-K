import type {
  ClinicalRecord,
  MedicineSale,
  Patient,
  PaymentRecord,
  PaymentReceiptSnapshot,
  PaymentMethod,
  PaymentAllocation,
  PaymentReceiptMedicineLine,
  PaymentReceiptTreatmentLine
} from '../types';
import type { Currency } from './currency';
import { getPaymentHeaderMethod, normalizePaymentAllocations, normalizePaymentMethod } from './paymentMethods';
import { resolveReceiptHeaderTitle } from './receiptPreferences';
import { resolveMedicineSalePricing } from './medicineSalePricing';

type ReceiptClinicContext = {
  appName: string;
  receiptHeaderTitle?: string;
  receiptInfo?: { email: string; phone: string };
  currency: Currency;
};

export const mergeTreatmentRecordsById = (
  existing: ClinicalRecord[],
  incoming: ClinicalRecord[]
): ClinicalRecord[] => Array.from(new Map([...existing, ...incoming].map((record) => [record.id, record])).values());

export const removePatientTreatmentRecords = (
  records: ClinicalRecord[],
  patientId: string
): ClinicalRecord[] => records.filter((record) => record.patient_id !== patientId);

export const removeTreatmentRecordById = (
  records: ClinicalRecord[],
  treatmentId: string
): ClinicalRecord[] => records.filter((record) => record.id !== treatmentId);

export const getUncapturedMedicineSalesForReceipt = (
  medicineSales: MedicineSale[],
  paymentRecords: PaymentRecord[],
  patientId: string,
  selectedTreatments: ClinicalRecord[],
  referenceDate?: string
): MedicineSale[] => {
  const capturedMedicineIds = new Set(paymentRecords
    .filter((payment) => payment.patientId === patientId)
    .flatMap((payment) => (payment.receiptSnapshot?.medicines || []).map((medicine) => medicine.id)));
  const selectedTreatmentIds = new Set(selectedTreatments.map((treatment) => treatment.id));
  const selectedDates = new Set(selectedTreatments.map((treatment) => treatment.date).filter(Boolean));

  return medicineSales.filter((sale) => {
    if (sale.patient_id !== patientId || capturedMedicineIds.has(sale.id)) return false;
    if (sale.treatment_id && selectedTreatmentIds.has(sale.treatment_id)) return true;
    if (sale.date && selectedDates.has(sale.date)) return true;
    return !sale.treatment_id && !!referenceDate && sale.date === referenceDate;
  });
};

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeNumber = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const normalizePaymentMethodValue = (value: unknown): PaymentMethod => normalizePaymentMethod(value);

const normalizeTreatmentLine = (value: any): PaymentReceiptTreatmentLine | null => {
  if (!value || typeof value !== 'object') return null;
  const id = normalizeString(value.id);
  const description = normalizeString(value.description);
  const date = normalizeString(value.date);
  if (!id || !description || !date) return null;

  return {
    id,
    date,
    description,
    teeth: Array.isArray(value.teeth) ? value.teeth.map((item: any) => normalizeNumber(item)).filter((item) => Number.isFinite(item)) : [],
    finalCost: normalizeNumber(value.finalCost ?? value.final_cost ?? value.cost),
    standardCost: normalizeNumber(value.standardCost ?? value.standard_cost ?? value.cost),
    discountAmount: normalizeNumber(value.discountAmount ?? value.discount_amount),
    pricingNote: value.pricingNote === 'FOC' || value.pricingNote === 'DISCOUNT'
      ? value.pricingNote
      : value.pricing_note === 'FOC' || value.pricing_note === 'DISCOUNT'
        ? value.pricing_note
        : null
  };
};

const normalizeMedicineLine = (value: any): PaymentReceiptMedicineLine | null => {
  if (!value || typeof value !== 'object') return null;
  const id = normalizeString(value.id);
  const date = normalizeString(value.date);
  const medicineName = normalizeString(value.medicineName ?? value.medicine_name);
  if (!id || !date || !medicineName) return null;

  const pricing = resolveMedicineSalePricing(value);
  return {
    id,
    date,
    medicineName,
    quantity: normalizeNumber(value.quantity),
    unitPrice: normalizeNumber(value.unitPrice ?? value.unit_price),
    totalPrice: pricing.finalTotal,
    standardTotal: pricing.standardTotal,
    discountAmount: pricing.discountAmount,
    pricingNote: pricing.note === 'FOC' ? 'FOC' : pricing.note === 'Discount' ? 'DISCOUNT' : null
  };
};

const buildTreatmentLines = (treatments: ClinicalRecord[] = []): PaymentReceiptTreatmentLine[] =>
  treatments.map((treatment) => ({
    id: treatment.id,
    date: normalizeString(treatment.date),
    description: normalizeString(treatment.description) || 'Treatment',
    teeth: Array.isArray(treatment.teeth) ? treatment.teeth : [],
    finalCost: normalizeNumber(treatment.cost),
    standardCost: normalizeNumber(treatment.standardCost ?? treatment.cost),
    discountAmount: normalizeNumber(treatment.discountAmount),
    pricingNote: treatment.pricingNote || null
  }));

const buildMedicineLines = (medicines: MedicineSale[] = []): PaymentReceiptMedicineLine[] =>
  medicines.map((medicine) => {
    const pricing = resolveMedicineSalePricing(medicine as MedicineSale & Record<string, unknown>);
    return {
      id: medicine.id,
      date: normalizeString(medicine.date),
      medicineName: normalizeString(medicine.medicine_name) || 'Medicine',
      quantity: normalizeNumber(medicine.quantity),
      unitPrice: normalizeNumber(medicine.unit_price),
      totalPrice: pricing.finalTotal,
      standardTotal: pricing.standardTotal,
      discountAmount: pricing.discountAmount,
      pricingNote: pricing.note === 'FOC' ? 'FOC' : pricing.note === 'Discount' ? 'DISCOUNT' : null
    };
  });

export const normalizePaymentReceiptSnapshot = (value: unknown): PaymentReceiptSnapshot | null => {
  if (!value || typeof value !== 'object') return null;

  const raw = value as Record<string, any>;
  const receiptNumber = normalizeString(raw.receiptNumber);
  const receiptDate = normalizeString(raw.receiptDate);
  const currency = raw.currency === 'MMK' ? 'MMK' : raw.currency === 'USD' ? 'USD' : null;
  const method = normalizePaymentMethodValue(raw.payment?.method);
  const amountPaid = normalizeNumber(raw.payment?.amountPaid);
  const allocations = normalizePaymentAllocations(raw.payment?.allocations, method, amountPaid);
  const status = raw.payment?.status === 'FULL' ? 'FULL' : raw.payment?.status === 'PARTIAL' ? 'PARTIAL' : null;

  if (!receiptNumber || !receiptDate || !currency || !status) return null;

  return {
    version: allocations.length > 1 || raw.version === 2 ? 2 : 1,
    ...(raw.allocationReconciled === true ? { allocationReconciled: true } : {}),
    receiptType: 'PAYMENT',
    receiptNumber,
    receiptDate,
    createdAt: normalizeString(raw.createdAt) || null,
    currency,
    clinic: {
      appName: normalizeString(raw.clinic?.appName) || 'DentalCloud Pro',
      headerTitle: normalizeString(raw.clinic?.headerTitle) || 'DentalCloud Pro',
      email: normalizeString(raw.clinic?.email),
      phone: normalizeString(raw.clinic?.phone)
    },
    patient: {
      id: normalizeString(raw.patient?.id),
      name: normalizeString(raw.patient?.name) || 'Unknown Patient',
      email: normalizeString(raw.patient?.email),
      phone: normalizeString(raw.patient?.phone),
      patientUniqueId: normalizeString(raw.patient?.patientUniqueId)
    },
    payment: {
      amountPaid,
      method: allocations.length > 1 ? 'MIXED' : method,
      ...(allocations.length > 1 || raw.version === 2 ? { allocations } : {}),
      status,
      balanceBefore: normalizeNumber(raw.payment?.balanceBefore),
      balanceAfter: normalizeNumber(raw.payment?.balanceAfter),
      serviceFeeAmount: normalizeNumber(raw.payment?.serviceFeeAmount),
      serviceFeeCategory: raw.payment?.serviceFeeCategory === 'NEW'
        ? 'NEW'
        : raw.payment?.serviceFeeCategory === 'RETURNING'
          ? 'RETURNING'
          : null,
      recordedByUserName: normalizeString(raw.payment?.recordedByUserName) || null
    },
    treatments: Array.isArray(raw.treatments) ? raw.treatments.map(normalizeTreatmentLine).filter(Boolean) as PaymentReceiptTreatmentLine[] : [],
    medicines: Array.isArray(raw.medicines) ? raw.medicines.map(normalizeMedicineLine).filter(Boolean) as PaymentReceiptMedicineLine[] : []
  };
};

export const buildPaymentReceiptSnapshot = (params: {
  patient: Patient;
  amountPaid: number;
  paymentMethod: PaymentMethod;
  allocations?: PaymentAllocation[];
  paymentDate: string;
  receiptNumber: string;
  balanceBefore: number;
  balanceAfter: number;
  paymentStatus: 'FULL' | 'PARTIAL';
  createdAt?: string | null;
  recordedByUserName?: string | null;
  serviceFeeAmount?: number;
  serviceFeeCategory?: 'NEW' | 'RETURNING' | null;
  treatments?: ClinicalRecord[];
  medicines?: MedicineSale[];
  clinic: ReceiptClinicContext;
}): PaymentReceiptSnapshot => {
  const clinicEmail = normalizeString(params.clinic.receiptInfo?.email);
  const clinicPhone = normalizeString(params.clinic.receiptInfo?.phone);
  const normalizedAppName = normalizeString(params.clinic.appName) || 'DentalCloud Pro';

  const allocations = normalizePaymentAllocations(params.allocations, params.paymentMethod, params.amountPaid);
  const treatments = buildTreatmentLines(params.treatments);
  const medicines = buildMedicineLines(params.medicines);
  const capturedTotal = treatments.reduce((sum, item) => sum + Math.max(0, item.finalCost), 0)
    + medicines.reduce((sum, item) => sum + Math.max(0, item.totalPrice), 0)
    + Math.max(0, normalizeNumber(params.serviceFeeAmount));
  return {
    version: allocations.length > 1 ? 2 : 1,
    ...(Math.abs(capturedTotal - Math.max(0, normalizeNumber(params.amountPaid))) <= 0.005
      ? { allocationReconciled: true as const }
      : {}),
    receiptType: 'PAYMENT',
    receiptNumber: params.receiptNumber,
    receiptDate: params.paymentDate,
    createdAt: params.createdAt || null,
    currency: params.clinic.currency,
    clinic: {
      appName: normalizedAppName,
      headerTitle: resolveReceiptHeaderTitle(params.clinic.receiptHeaderTitle, normalizedAppName),
      email: clinicEmail,
      phone: clinicPhone
    },
    patient: {
      id: params.patient.id,
      name: params.patient.name,
      email: normalizeString(params.patient.email),
      phone: normalizeString(params.patient.phone),
      patientUniqueId: normalizeString(params.patient.patient_unique_id)
    },
    payment: {
      amountPaid: Math.max(0, normalizeNumber(params.amountPaid)),
      method: getPaymentHeaderMethod(allocations),
      ...(allocations.length > 1 ? { allocations } : {}),
      status: params.paymentStatus,
      balanceBefore: Math.max(0, normalizeNumber(params.balanceBefore)),
      balanceAfter: Math.max(0, normalizeNumber(params.balanceAfter)),
      serviceFeeAmount: Math.max(0, normalizeNumber(params.serviceFeeAmount)),
      serviceFeeCategory: params.serviceFeeCategory === 'NEW' || params.serviceFeeCategory === 'RETURNING'
        ? params.serviceFeeCategory
        : null,
      recordedByUserName: normalizeString(params.recordedByUserName) || null
    },
    treatments,
    medicines
  };
};

export const getReceiptTreatmentAllocationAmount = (
  paymentAmount: unknown,
  receiptSnapshot: unknown
): number => {
  const collected = Math.max(0, normalizeNumber(paymentAmount));
  const snapshot = normalizePaymentReceiptSnapshot(receiptSnapshot);
  if (!snapshot) return collected;
  const treatmentTotal = (snapshot.treatments || []).reduce((sum, item) => sum + Math.max(0, item.finalCost), 0);
  const medicineTotal = (snapshot.medicines || []).reduce((sum, item) => sum + Math.max(0, item.totalPrice), 0);
  const serviceFee = Math.max(0, normalizeNumber(snapshot.payment.serviceFeeAmount));
  return Math.min(treatmentTotal, Math.max(0, collected - serviceFee - medicineTotal));
};

export const buildLegacyPaymentReceiptSnapshot = (
  payment: PaymentRecord,
  clinic: ReceiptClinicContext
): PaymentReceiptSnapshot => {
  const paymentDate = normalizeString(payment.date) || normalizeString(payment.createdAt).slice(0, 10);
  const receiptNumber = normalizeString(payment.receiptNumber) || `REC-${payment.id}`;
  const balanceAfter = Math.max(0, normalizeNumber(payment.remainingBalance));
  const balanceBefore = Math.max(balanceAfter, normalizeNumber(payment.balanceBefore ?? balanceAfter + normalizeNumber(payment.amount)));

  const allocations = normalizePaymentAllocations(payment.allocations, payment.paymentMethod, payment.amount);
  return {
    version: allocations.length > 1 ? 2 : 1,
    receiptType: 'PAYMENT',
    receiptNumber,
    receiptDate: paymentDate,
    createdAt: payment.createdAt || null,
    currency: clinic.currency,
    clinic: {
      appName: normalizeString(clinic.appName) || 'DentalCloud Pro',
      headerTitle: resolveReceiptHeaderTitle(clinic.receiptHeaderTitle, clinic.appName || 'DentalCloud Pro'),
      email: normalizeString(clinic.receiptInfo?.email),
      phone: normalizeString(clinic.receiptInfo?.phone)
    },
    patient: {
      id: payment.patientId,
      name: normalizeString(payment.patient_name) || 'Unknown Patient'
    },
    payment: {
      amountPaid: Math.max(0, normalizeNumber(payment.amount)),
      method: getPaymentHeaderMethod(allocations),
      ...(allocations.length > 1 ? { allocations } : {}),
      status: payment.type === 'FULL' ? 'FULL' : 'PARTIAL',
      balanceBefore,
      balanceAfter,
      serviceFeeAmount: 0,
      serviceFeeCategory: null,
      recordedByUserName: normalizeString(payment.createdByUserName) || null
    }
  };
};
