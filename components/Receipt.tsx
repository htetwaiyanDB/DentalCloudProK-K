import React from 'react';
import { createPortal } from 'react-dom';
import { X, Printer } from 'lucide-react';
import { Patient, ClinicalRecord, MedicineSale, PaymentAllocation, PaymentMethod, PaymentReceiptSnapshot, ReceiptSize, TreatmentType } from '../types';
import { formatCurrency, Currency } from '../utils/currency';
import { formatPaymentMethod } from '../utils/paymentMethods';
import { normalizePaymentAllocations } from '../utils/paymentMethods';
import { resolveReceiptHeaderTitle } from '../utils/receiptPreferences';
import { formatTeethWithPosition } from '../utils/toothNumbering';
import { getReceiptPageSize, getReceiptPrintPosition, getThermalPageHeightMm, getThermalReceiptTypography } from '../utils/receiptPrint';
import { resolveReceiptTreatmentPricing } from '../utils/receiptPricing';
import { resolveMedicineSalePricing } from '../utils/medicineSalePricing';

interface ReceiptProps {
  patient: Patient;
  treatments: ClinicalRecord[];
  medicines?: MedicineSale[];
  paymentAmount?: number;
  paymentMethod?: PaymentMethod;
  paymentAllocations?: PaymentAllocation[];
  receiptNumber?: string;
  paymentReceiptSnapshot?: PaymentReceiptSnapshot | null;
  treatmentTypes?: TreatmentType[];
  currency: Currency;
  appName?: string;
  receiptHeaderTitle?: string;
  receiptInfo?: { email: string; phone: string };
  receiptSize?: ReceiptSize;
  onClose: () => void;
}

const Receipt: React.FC<ReceiptProps> = ({
  patient,
  treatments,
  medicines = [],
  paymentAmount,
  paymentMethod,
  paymentAllocations,
  receiptNumber: persistedReceiptNumber,
  paymentReceiptSnapshot,
  treatmentTypes = [],
  currency,
  appName = 'DentalCloud Pro',
  receiptHeaderTitle,
  receiptInfo,
  receiptSize = 'A4',
  onClose
}) => {
  const paymentSnapshot = paymentReceiptSnapshot || null;
  const effectiveAppName = paymentSnapshot?.clinic.appName || appName;
  const receiptEmail = paymentSnapshot?.clinic.email || receiptInfo?.email || 'info@dentflowpro.com';
  const receiptPhone = paymentSnapshot?.clinic.phone || receiptInfo?.phone || '(555) 123-4567';
  const displayHeaderTitle = paymentSnapshot?.clinic.headerTitle || resolveReceiptHeaderTitle(receiptHeaderTitle, effectiveAppName);
  const receiptNumber = paymentSnapshot?.receiptNumber || persistedReceiptNumber || `REC-${Date.now().toString().slice(-8)}`;
  const effectiveCurrency = paymentSnapshot?.currency || currency;
  const formatLongDate = (value: string | Date) => {
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };
  const formatShortDate = (value: string | Date) => {
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };
  const displayDate = paymentSnapshot
    ? formatLongDate(`${paymentSnapshot.receiptDate}T00:00:00`)
    : formatLongDate(new Date());
  const patientDisplay = paymentSnapshot
    ? {
        name: paymentSnapshot.patient.name,
        email: paymentSnapshot.patient.email || '',
        phone: paymentSnapshot.patient.phone || '',
        patientUniqueId: paymentSnapshot.patient.patientUniqueId || ''
      }
    : {
        name: patient.name,
        email: patient.email || '',
        phone: patient.phone || '',
        patientUniqueId: patient.patient_unique_id || ''
      };
  const today = displayDate;
  const receiptTreatments = paymentSnapshot
    ? (paymentSnapshot.treatments || []).map((treatment) => ({
        id: treatment.id,
        date: treatment.date,
        description: treatment.description,
        teeth: treatment.teeth,
        cost: treatment.finalCost,
        standardCost: treatment.standardCost,
        discountAmount: treatment.discountAmount,
        pricingNote: treatment.pricingNote || null
      }))
    : treatments;
  const receiptMedicines = paymentSnapshot
    ? (paymentSnapshot.medicines || []).map((medicine) => ({
        id: medicine.id,
        location_id: patient.location_id,
        patient_id: patient.id,
        medicine_id: medicine.id,
        medicine_name: medicine.medicineName,
        quantity: medicine.quantity,
        unit_price: medicine.unitPrice,
        total_price: medicine.totalPrice,
        standard_total: medicine.standardTotal,
        discount_amount: medicine.discountAmount,
        pricing_note: medicine.pricingNote || null,
        date: medicine.date
      }))
    : medicines;

  const getTreatmentPricing = (
    treatment: Pick<ClinicalRecord, 'cost' | 'description' | 'teeth'> & Partial<ClinicalRecord>
  ) => resolveReceiptTreatmentPricing(treatment, treatmentTypes);
  const getMedicinePricing = (medicine: MedicineSale) => resolveMedicineSalePricing(medicine as MedicineSale & Record<string, unknown>);

  const totalTreatmentCost = receiptTreatments.reduce((sum, treatment) => sum + (treatment.cost || 0), 0);
  const totalTreatmentStandardCost = receiptTreatments.reduce((sum, treatment) => {
    return sum + getTreatmentPricing(treatment).standardCost;
  }, 0);
  const totalTreatmentDiscount = receiptTreatments.reduce((sum, treatment) => {
    return sum + getTreatmentPricing(treatment).discountAmount;
  }, 0);
  const totalMedicineCost = receiptMedicines.reduce((sum, medicine) => sum + getMedicinePricing(medicine).finalTotal, 0);
  const totalMedicineStandardCost = receiptMedicines.reduce((sum, medicine) => sum + getMedicinePricing(medicine).standardTotal, 0);
  const totalMedicineDiscount = receiptMedicines.reduce((sum, medicine) => sum + getMedicinePricing(medicine).discountAmount, 0);
  const paymentServiceFeeAmount = Math.max(0, Number(paymentSnapshot?.payment.serviceFeeAmount || 0));
  const paymentServiceFeeLabel = paymentSnapshot?.payment.serviceFeeCategory === 'NEW'
    ? 'New Patient Service Fee'
    : paymentSnapshot?.payment.serviceFeeCategory === 'RETURNING'
      ? 'Old Patient Service Fee'
      : 'Service Fee';
  const grandTotal = totalTreatmentCost + totalMedicineCost + paymentServiceFeeAmount;
  const totalPaid = paymentSnapshot?.payment.amountPaid || paymentAmount || 0;
  const receiptPaymentAllocations = normalizePaymentAllocations(
    paymentSnapshot?.payment.allocations || paymentAllocations,
    paymentSnapshot?.payment.method || paymentMethod,
    totalPaid
  );
  const renderPaymentAllocationRows = () => receiptPaymentAllocations.map((allocation) => (
    <div key={allocation.method} className="flex justify-between text-sm mt-1">
      <span className="text-gray-600">{formatPaymentMethod(allocation.method)}:</span>
      <span className="font-semibold text-gray-900">{formatCurrency(allocation.amount, effectiveCurrency)}</span>
    </div>
  ));
  const renderThermalPaymentAllocations = () => receiptPaymentAllocations.map((allocation) => (
    <React.Fragment key={allocation.method}>
      {thermalLine(`${formatPaymentMethod(allocation.method)}:`, formatCurrency(allocation.amount, effectiveCurrency))}
    </React.Fragment>
  ));
  
  // If this is a payment receipt (paymentAmount > 0), show patient's remaining balance
  // Otherwise, calculate balance based on selected treatments
  const remainingBalance = totalPaid > 0 
    ? (paymentSnapshot?.payment.balanceAfter ?? patient.balance)
    : Math.max(0, grandTotal - totalPaid); // For invoice, calculate from selected services and medicines

  const isThermal = receiptSize === 'THERMAL_55MM' || receiptSize === 'THERMAL_80MM';
  const isThermal80 = receiptSize === 'THERMAL_80MM';
  const thermalPaperWidth = isThermal80 ? '80mm' : '58mm';
  const thermalPreviewWidth = isThermal80 ? '90mm' : '68mm';
  const thermalContentPadding = isThermal80 ? '3mm 4mm' : '2mm 3mm';
  const thermalTypography = getThermalReceiptTypography(receiptSize);
  const thermalBaseFontSize = `${thermalTypography.base}px`;
  const thermalLineFontSize = `${thermalTypography.line}px`;
  const thermalSmallFontSize = `${thermalTypography.small}px`;
  const thermalHeaderFontSize = `${thermalTypography.header}px`;
  const thermalAmountFontSize = `${thermalTypography.amount}px`;
  const thermalPrintContentRef = React.useRef<HTMLDivElement>(null);
  const [thermalPageHeightMm, setThermalPageHeightMm] = React.useState(20);

  const measureThermalPage = React.useCallback(() => {
    if (!isThermal || !thermalPrintContentRef.current) return;
    setThermalPageHeightMm(getThermalPageHeightMm(thermalPrintContentRef.current.scrollHeight));
  }, [isThermal]);

  React.useLayoutEffect(() => {
    if (!isThermal || !thermalPrintContentRef.current) return;

    measureThermalPage();
    const content = thermalPrintContentRef.current;
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measureThermalPage);
    resizeObserver?.observe(content);

    return () => resizeObserver?.disconnect();
  }, [isThermal, measureThermalPage, paymentSnapshot, receiptTreatments.length, receiptMedicines.length]);

  const handlePrint = async () => {
    measureThermalPage();
    // Allow the measured @page height to reach the stylesheet before Chrome
    // builds its print preview. This also covers late font/layout rounding.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    window.print();
  };

  const renderServicesTable = (isPrint = false) => (
    <div className="mb-8">
      <h3 className="text-lg font-bold text-gray-900 mb-4 border-b border-gray-300 pb-2">Treatment Services</h3>
      <table className="w-full border-collapse" style={isPrint ? { borderCollapse: 'collapse' } : undefined}>
        <thead>
          <tr className="bg-gray-100 border-b-2 border-gray-800">
            <th className="text-left py-3 px-4 text-sm font-bold text-gray-900" style={isPrint ? { borderBottom: '2px solid #1f2937' } : undefined}>Date</th>
            <th className="text-left py-3 px-4 text-sm font-bold text-gray-900" style={isPrint ? { borderBottom: '2px solid #1f2937' } : undefined}>Description</th>
            <th className="text-left py-3 px-4 text-sm font-bold text-gray-900" style={isPrint ? { borderBottom: '2px solid #1f2937' } : undefined}>Teeth</th>
            <th className="text-right py-3 px-4 text-sm font-bold text-gray-900" style={isPrint ? { borderBottom: '2px solid #1f2937' } : undefined}>Standard</th>
            <th className="text-right py-3 px-4 text-sm font-bold text-gray-900" style={isPrint ? { borderBottom: '2px solid #1f2937' } : undefined}>Adjustment</th>
            <th className="text-right py-3 px-4 text-sm font-bold text-gray-900" style={isPrint ? { borderBottom: '2px solid #1f2937' } : undefined}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {receiptTreatments.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-6 text-center text-gray-500 italic" style={isPrint ? { padding: '24px 16px' } : undefined}>
                No treatment services recorded
              </td>
            </tr>
          ) : (
            receiptTreatments.map((treatment, index) => {
              const pricing = getTreatmentPricing(treatment);
              return (
                <tr key={index} className="border-b border-gray-200" style={isPrint ? { borderBottom: '1px solid #e5e7eb' } : undefined}>
                  <td className="py-3 px-4 text-sm text-gray-700" style={isPrint ? { padding: '12px 16px' } : undefined}>
                    {new Date(treatment.date).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-900 font-medium" style={isPrint ? { padding: '12px 16px' } : undefined}>{treatment.description}</td>
                  <td className="py-3 px-4 text-sm text-gray-600" style={isPrint ? { padding: '12px 16px' } : undefined}>
                    {treatment.teeth && treatment.teeth.length > 0
                      ? formatTeethWithPosition(treatment.teeth)
                      : 'General'}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-700 text-right" style={isPrint ? { padding: '12px 16px' } : undefined}>
                    {formatCurrency(pricing.standardCost, effectiveCurrency)}
                  </td>
                  <td className="py-3 px-4 text-sm text-right font-semibold" style={isPrint ? { padding: '12px 16px' } : undefined}>
                    {pricing.discountAmount > 0 ? (
                      <span className={pricing.note === 'FOC' ? 'text-amber-700' : 'text-emerald-700'}>
                        {pricing.note}: -{formatCurrency(pricing.discountAmount, effectiveCurrency)}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-900 text-right font-semibold" style={isPrint ? { padding: '12px 16px' } : undefined}>
                    {formatCurrency(pricing.finalCost, effectiveCurrency)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );

  const renderMedicinesTable = (isPrint = false) => (
    <div className="mb-8">
      <h3 className="text-lg font-bold text-gray-900 mb-4 border-b border-gray-300 pb-2">Medicines & Items</h3>
      <table className="w-full border-collapse" style={isPrint ? { borderCollapse: 'collapse' } : undefined}>
        <thead>
          <tr className="bg-gray-100 border-b-2 border-gray-800">
            <th className="text-left py-3 px-4 text-sm font-bold text-gray-900" style={isPrint ? { borderBottom: '2px solid #1f2937' } : undefined}>Date</th>
            <th className="text-left py-3 px-4 text-sm font-bold text-gray-900" style={isPrint ? { borderBottom: '2px solid #1f2937' } : undefined}>Item</th>
            <th className="text-right py-3 px-4 text-sm font-bold text-gray-900" style={isPrint ? { borderBottom: '2px solid #1f2937' } : undefined}>Qty</th>
            <th className="text-right py-3 px-4 text-sm font-bold text-gray-900" style={isPrint ? { borderBottom: '2px solid #1f2937' } : undefined}>Unit Price</th>
            <th className="text-right py-3 px-4 text-sm font-bold text-gray-900" style={isPrint ? { borderBottom: '2px solid #1f2937' } : undefined}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {receiptMedicines.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-6 text-center text-gray-500 italic" style={isPrint ? { padding: '24px 16px' } : undefined}>
                No medicines or items recorded
              </td>
            </tr>
          ) : (
            receiptMedicines.map((medicine, index) => {
              const pricing = getMedicinePricing(medicine);
              return (
              <tr key={index} className="border-b border-gray-200" style={isPrint ? { borderBottom: '1px solid #e5e7eb' } : undefined}>
                <td className="py-3 px-4 text-sm text-gray-700" style={isPrint ? { padding: '12px 16px' } : undefined}>
                  {new Date(medicine.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}
                </td>
                <td className="py-3 px-4 text-sm text-gray-900 font-medium" style={isPrint ? { padding: '12px 16px' } : undefined}>
                  {medicine.medicine_name || 'Medicine'}
                  {pricing.note && <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${pricing.note === 'FOC' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{pricing.note}</span>}
                </td>
                <td className="py-3 px-4 text-sm text-gray-600 text-right" style={isPrint ? { padding: '12px 16px' } : undefined}>{medicine.quantity}</td>
                <td className="py-3 px-4 text-sm text-gray-600 text-right" style={isPrint ? { padding: '12px 16px' } : undefined}>
                  {formatCurrency(medicine.unit_price || 0, effectiveCurrency)}
                </td>
                <td className="py-3 px-4 text-sm text-gray-900 text-right font-semibold" style={isPrint ? { padding: '12px 16px' } : undefined}>
                  {pricing.discountAmount > 0 && <div className="text-xs font-normal text-gray-400 line-through">{formatCurrency(pricing.standardTotal, effectiveCurrency)}</div>}
                  <div>{formatCurrency(pricing.finalTotal, effectiveCurrency)}</div>
                  {pricing.discountAmount > 0 && <div className="text-[10px] font-bold text-emerald-700">-{formatCurrency(pricing.discountAmount, effectiveCurrency)}</div>}
                </td>
              </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );

  // ─── Thermal helpers ───────────────────────────────────────────────────

  const thermalLine = (left: string, right: string, leftStyle?: React.CSSProperties, rightStyle?: React.CSSProperties) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4px', width: '100%', minWidth: 0, fontSize: thermalLineFontSize, lineHeight: '1.5' }}>
      <span style={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere', textAlign: 'left', ...leftStyle }}>{left}</span>
      <span style={{ flex: '0 1 auto', minWidth: 0, overflowWrap: 'anywhere', textAlign: 'right', ...rightStyle }}>{right}</span>
    </div>
  );

  const thermalDivider = () => (
    <div style={{ borderTop: '1px dashed #333', margin: '4px 0' }} />
  );

  const thermalThickDivider = () => (
    <div style={{ borderTop: '2px solid #333', margin: '4px 0' }} />
  );

  const renderThermalServices = () => (
    <div style={{ marginBottom: '6px' }}>
      <div style={{ fontSize: thermalBaseFontSize, fontWeight: 700, marginBottom: '2px' }}>-- TREATMENT SERVICES --</div>
      {receiptTreatments.length === 0 ? (
        <div style={{ fontSize: thermalSmallFontSize, fontStyle: 'italic', color: '#666' }}>No treatment services recorded</div>
      ) : (
        receiptTreatments.map((treatment, idx) => {
          const pricing = getTreatmentPricing(treatment);
          return (
            <div key={idx} style={{ marginBottom: '3px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4px', minWidth: 0, fontSize: thermalLineFontSize }}>
                <span style={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' }}>{treatment.description}</span>
                <span style={{ flex: '0 1 auto', minWidth: 0, overflowWrap: 'anywhere', textAlign: 'right', fontWeight: 700 }}>{formatCurrency(pricing.finalCost, effectiveCurrency)}</span>
              </div>
              <div style={{ fontSize: thermalSmallFontSize, color: '#555' }}>
                {new Date(treatment.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {treatment.teeth && treatment.teeth.length > 0 ? ` | ${formatTeethWithPosition(treatment.teeth)}` : ''}
              </div>
              {pricing.discountAmount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: thermalSmallFontSize, color: pricing.note === 'FOC' ? '#b45309' : '#15803d' }}>
                  <span>Std {formatCurrency(pricing.standardCost, effectiveCurrency)}</span>
                  <span>{pricing.note}: -{formatCurrency(pricing.discountAmount, effectiveCurrency)}</span>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  const renderThermalMedicines = () => (
    <div style={{ marginBottom: '6px' }}>
      <div style={{ fontSize: thermalBaseFontSize, fontWeight: 700, marginBottom: '2px' }}>-- MEDICINES & ITEMS --</div>
      {receiptMedicines.length === 0 ? (
        <div style={{ fontSize: thermalSmallFontSize, fontStyle: 'italic', color: '#666' }}>No medicines or items recorded</div>
      ) : (
        receiptMedicines.map((med, idx) => {
          const pricing = getMedicinePricing(med);
          return (
          <div key={idx} style={{ marginBottom: '2px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4px', minWidth: 0, fontSize: thermalLineFontSize }}>
              <span style={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' }}>{med.medicine_name || 'Medicine'} x{med.quantity}</span>
              <span style={{ flex: '0 1 auto', minWidth: 0, overflowWrap: 'anywhere', textAlign: 'right', fontWeight: 700 }}>{formatCurrency(pricing.finalTotal, effectiveCurrency)}</span>
            </div>
            <div style={{ fontSize: thermalSmallFontSize, color: '#555' }}>
              @ {formatCurrency(med.unit_price || 0, effectiveCurrency)}/ea
            </div>
            {pricing.discountAmount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '3px', fontSize: thermalSmallFontSize, color: pricing.note === 'FOC' ? '#b45309' : '#15803d' }}>
                <span>List {formatCurrency(pricing.standardTotal, effectiveCurrency)}</span>
                <span>{pricing.note}: -{formatCurrency(pricing.discountAmount, effectiveCurrency)}</span>
              </div>
            )}
          </div>
          );
        })
      )}
    </div>
  );

  // ─── A4 Preview ────────────────────────────────────────────────────────

  const renderA4Preview = () => (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 print:hidden">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-auto">
        {/* Header with controls */}
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex justify-between items-center z-10">
          <h2 className="text-xl font-bold text-gray-800">Receipt Preview</h2>
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Printer className="w-4 h-4" /> Print
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Receipt Content - A4 Size */}
        <div className="p-8 md:p-12 print:p-12" style={{ 
          width: '210mm', 
          minHeight: '297mm',
          margin: '0 auto',
          background: 'white'
        }}>
          {/* Clinic Header */}
          <div className="text-center mb-8 border-b-2 border-gray-800 pb-6">
            <h1 className="text-2xl font-black text-gray-900 mb-2">{displayHeaderTitle}</h1>
            <p className="text-sm text-gray-600">Professional Dental Care Services</p>
            <p className="text-xs text-gray-500 mt-2">Email: {receiptEmail} | Phone: {receiptPhone}</p>
          </div>

          {/* Receipt Info */}
          <div className="flex justify-between items-start mb-8">
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">BILL TO:</p>
              <p className="text-base font-bold text-gray-900">{patient.name}</p>
              <p className="text-sm text-gray-600">{patient.email}</p>
              <p className="text-sm text-gray-600">{patient.phone}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-600 mb-1">Receipt #: <span className="font-semibold">{receiptNumber}</span></p>
              <p className="text-sm text-gray-600">Date: <span className="font-semibold">{today}</span></p>
            </div>
          </div>

          {renderServicesTable()}
          {renderMedicinesTable()}

          {/* Summary */}
          <div className="mb-8">
            <div className="flex justify-end">
              <div className="w-64">
                <div className="flex justify-between py-2 border-b border-gray-300">
                  <span className="text-sm font-semibold text-gray-700">Treatment Services:</span>
                  <span className="text-sm font-semibold text-gray-900">
                    {formatCurrency(totalTreatmentStandardCost, currency)}
                  </span>
                </div>
                {totalTreatmentDiscount > 0 && (
                  <div className="flex justify-between py-2 border-b border-gray-300">
                    <span className="text-sm font-semibold text-gray-700">Treatment Discount:</span>
                    <span className="text-sm font-semibold text-amber-700">
                      -{formatCurrency(totalTreatmentDiscount, currency)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between py-2 border-b border-gray-300">
                  <span className="text-sm font-semibold text-gray-700">Medicines & Items:</span>
                  <span className="text-sm font-semibold text-gray-900">
                    {formatCurrency(totalMedicineStandardCost, effectiveCurrency)}
                  </span>
                </div>
                {totalMedicineDiscount > 0 && (
                  <div className="flex justify-between py-2 border-b border-gray-300">
                    <span className="text-sm font-semibold text-gray-700">Item Discount:</span>
                    <span className="text-sm font-semibold text-emerald-700">-{formatCurrency(totalMedicineDiscount, effectiveCurrency)}</span>
                  </div>
                )}
                <div className="flex justify-between py-2 border-b border-gray-300">
                  <span className="text-sm font-semibold text-gray-700">Subtotal:</span>
                  <span className="text-sm font-semibold text-gray-900">
                    {formatCurrency(grandTotal, currency)}
                  </span>
                </div>
                {totalPaid > 0 && (
                  <div className="flex justify-between py-2 border-b border-gray-300">
                    <span className="text-sm font-semibold text-gray-700">Payment Received:</span>
                    <span className="text-sm font-semibold text-green-600">
                      -{formatCurrency(totalPaid, currency)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between py-3 mt-2 border-t-2 border-gray-800">
                  <span className="text-base font-bold text-gray-900">Balance Due:</span>
                  <span className={`text-base font-bold ${remainingBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {formatCurrency(remainingBalance, currency)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Payment Details (if payment was made) */}
          {totalPaid > 0 && (
            <div className="mb-8 p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-sm font-semibold text-gray-900 mb-2">Payment Details:</p>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Payment Amount:</span>
                <span className="font-semibold text-gray-900">{formatCurrency(totalPaid, currency)}</span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span className="text-gray-600">Payment Date:</span>
                <span className="font-semibold text-gray-900">{today}</span>
              </div>
              {renderPaymentAllocationRows()}
              <div className="flex justify-between text-sm mt-1">
                <span className="text-gray-600">Payment Status:</span>
                <span className="font-semibold text-green-600">Paid</span>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="mt-12 pt-6 border-t-2 border-gray-800 text-center">
            <p className="text-xs text-gray-600 mb-2">
              Thank you for choosing {appName} for your dental care needs.
            </p>
            <p className="text-xs text-gray-500">
              This is a computer-generated receipt. No signature required.
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Please retain this receipt for your records.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  // ─── Thermal Preview ───────────────────────────────────────────────────

  const renderThermalPreview = () => (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 print:hidden">
      <div className="bg-white rounded-xl shadow-2xl w-full max-h-[90vh] overflow-auto" style={{ maxWidth: isThermal80 ? '520px' : '380px' }}>
        {/* Header with controls */}
        <div className="sticky top-0 bg-white border-b border-gray-200 p-3 flex justify-between items-center z-10">
          <h2 className="text-sm font-bold text-gray-800">{isThermal80 ? '80mm Thermal Receipt' : '55mm Thermal Receipt'}</h2>
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1 bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors text-xs"
            >
              <Printer className="w-3 h-3" /> Print
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Receipt Content - Thermal */}
        <div className="thermal-receipt-preview" style={{
          width: thermalPaperWidth,
          boxSizing: 'border-box',
          margin: '0 auto',
          background: 'white',
          padding: thermalContentPadding,
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: thermalBaseFontSize,
          fontWeight: thermalTypography.weight,
          lineHeight: '1.3',
          color: '#222'
        }}>
          {/* Clinic Header */}
          <div style={{ textAlign: 'center', marginBottom: '6px' }}>
            <div style={{ fontSize: thermalHeaderFontSize, fontWeight: 700, letterSpacing: '1px' }}>{displayHeaderTitle}</div>
            <div style={{ fontSize: thermalSmallFontSize, color: '#555' }}>Professional Dental Care Services</div>
            <div style={{ fontSize: thermalSmallFontSize, color: '#777', marginTop: '2px' }}>{receiptEmail} | {receiptPhone}</div>
          </div>

          {thermalThickDivider()}

          {/* Receipt Info */}
          <div style={{ marginBottom: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: thermalSmallFontSize }}>
              <span>Receipt #: {receiptNumber}</span>
              <span>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>
          </div>

          {thermalDivider()}

          {/* Patient Info */}
          <div style={{ marginBottom: '6px' }}>
            <div style={{ fontSize: thermalBaseFontSize, fontWeight: 700 }}>{patient.name}</div>
            <div style={{ fontSize: thermalSmallFontSize, color: '#555' }}>{patient.email}</div>
            <div style={{ fontSize: thermalSmallFontSize, color: '#555' }}>{patient.phone}</div>
          </div>

          {thermalDivider()}

          {/* Services */}
          {renderThermalServices()}

          {/* Medicines */}
          {renderThermalMedicines()}

          {thermalThickDivider()}

          {/* Summary */}
          <div style={{ marginBottom: '6px' }}>
            {thermalLine('Treatment Services:', formatCurrency(totalTreatmentStandardCost, currency))}
            {totalTreatmentDiscount > 0 && thermalLine('Treatment Discount:', `-${formatCurrency(totalTreatmentDiscount, effectiveCurrency)}`, undefined, { color: '#b45309' })}
            {thermalLine('Medicines & Items:', formatCurrency(totalMedicineStandardCost, effectiveCurrency))}
            {totalMedicineDiscount > 0 && thermalLine('Item Discount:', `-${formatCurrency(totalMedicineDiscount, effectiveCurrency)}`, undefined, { color: '#15803d' })}
            {thermalDivider()}
            {thermalLine('Subtotal:', formatCurrency(grandTotal, currency), undefined, { fontWeight: 700 })}
            {totalPaid > 0 && thermalLine('Payment Received:', `-${formatCurrency(totalPaid, currency)}`, undefined, { color: '#16a34a' })}
            {thermalThickDivider()}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: thermalBaseFontSize, fontWeight: 700, marginTop: '2px' }}>
              <span>BALANCE DUE</span>
              <span style={{ color: remainingBalance > 0 ? '#dc2626' : '#16a34a' }}>
                {formatCurrency(remainingBalance, currency)}
              </span>
            </div>
          </div>

          {thermalThickDivider()}

          {/* Payment Details */}
          {totalPaid > 0 && (
            <div style={{ marginBottom: '6px', fontSize: thermalSmallFontSize, lineHeight: '1.35' }}>
              <div style={{ fontSize: thermalLineFontSize, fontWeight: 700, marginBottom: '3px', letterSpacing: '0.3px' }}>-- PAYMENT DETAILS --</div>
              {thermalLine('Amount Paid:', formatCurrency(totalPaid, currency), { fontSize: thermalSmallFontSize }, { fontSize: thermalSmallFontSize, fontWeight: 700 })}
              {thermalLine('Date:', today, { fontSize: thermalSmallFontSize }, { fontSize: thermalSmallFontSize })}
              {renderThermalPaymentAllocations()}
              {thermalLine('Status:', 'Paid', undefined, { color: '#16a34a' })}
            </div>
          )}

          {/* Footer */}
          <div style={{ textAlign: 'center', marginTop: '8px', fontSize: thermalSmallFontSize, color: '#555' }}>
            <div style={{ fontWeight: 700, marginBottom: '2px' }}>Thank you for choosing {appName}!</div>
            <div>This is a computer-generated receipt.</div>
            <div>No signature required.</div>
          </div>

          {/* Receipt cut line */}
          <div style={{ textAlign: 'center', marginTop: '6px', fontSize: thermalSmallFontSize, color: '#999', letterSpacing: '2px' }}>
            - - - - - - - - - - - - - - - - -
          </div>
        </div>
      </div>
    </div>
  );

  // ─── A4 Print Version ──────────────────────────────────────────────────

  const renderA4Print = () => (
    <div className="receipt-print">
      <div className="receipt-content" style={{ 
        width: '210mm', 
        minHeight: '297mm',
        margin: '0 auto',
        padding: '12mm',
        background: 'white',
        fontSize: '12pt',
        fontFamily: 'system-ui, sans-serif'
      }}>
        {/* Clinic Header */}
        <div className="text-center mb-8 border-b-2 border-gray-800 pb-6">
          <h1 className="text-2xl font-black text-gray-900 mb-2">{displayHeaderTitle}</h1>
          <p className="text-sm text-gray-600">Professional Dental Care Services</p>
          <p className="text-xs text-gray-500 mt-2">Email: {receiptEmail} | Phone: {receiptPhone}</p>
        </div>

        {/* Receipt Info */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">BILL TO:</p>
            <p className="text-base font-bold text-gray-900">{patient.name}</p>
            <p className="text-sm text-gray-600">{patient.email}</p>
            <p className="text-sm text-gray-600">{patient.phone}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600 mb-1">Receipt #: <span className="font-semibold">{receiptNumber}</span></p>
            <p className="text-sm text-gray-600">Date: <span className="font-semibold">{today}</span></p>
          </div>
        </div>

        {renderServicesTable(true)}
        {renderMedicinesTable(true)}

        {/* Summary */}
        <div className="mb-8">
          <div className="flex justify-end">
            <div className="w-64">
              <div className="flex justify-between py-2 border-b border-gray-300" style={{ borderBottom: '1px solid #d1d5db', padding: '8px 0' }}>
                <span className="text-sm font-semibold text-gray-700">Treatment Services:</span>
                <span className="text-sm font-semibold text-gray-900">
                  {formatCurrency(totalTreatmentStandardCost, currency)}
                </span>
              </div>
              {totalTreatmentDiscount > 0 && (
                <div className="flex justify-between py-2 border-b border-gray-300" style={{ borderBottom: '1px solid #d1d5db', padding: '8px 0' }}>
                  <span className="text-sm font-semibold text-gray-700">Treatment Discount:</span>
                  <span className="text-sm font-semibold text-amber-700">
                    -{formatCurrency(totalTreatmentDiscount, currency)}
                  </span>
                </div>
              )}
              <div className="flex justify-between py-2 border-b border-gray-300" style={{ borderBottom: '1px solid #d1d5db', padding: '8px 0' }}>
                <span className="text-sm font-semibold text-gray-700">Medicines & Items:</span>
                <span className="text-sm font-semibold text-gray-900">
                  {formatCurrency(totalMedicineStandardCost, effectiveCurrency)}
                </span>
              </div>
              {totalMedicineDiscount > 0 && (
                <div className="flex justify-between py-2 border-b border-gray-300" style={{ borderBottom: '1px solid #d1d5db', padding: '8px 0' }}>
                  <span className="text-sm font-semibold text-gray-700">Item Discount:</span>
                  <span className="text-sm font-semibold text-emerald-700">-{formatCurrency(totalMedicineDiscount, effectiveCurrency)}</span>
                </div>
              )}
              <div className="flex justify-between py-2 border-b border-gray-300" style={{ borderBottom: '1px solid #d1d5db', padding: '8px 0' }}>
                <span className="text-sm font-semibold text-gray-700">Subtotal:</span>
                <span className="text-sm font-semibold text-gray-900">
                  {formatCurrency(grandTotal, currency)}
                </span>
              </div>
              {totalPaid > 0 && (
                <div className="flex justify-between py-2 border-b border-gray-300" style={{ borderBottom: '1px solid #d1d5db', padding: '8px 0' }}>
                  <span className="text-sm font-semibold text-gray-700">Payment Received:</span>
                  <span className="text-sm font-semibold text-green-600">
                    -{formatCurrency(totalPaid, currency)}
                  </span>
                </div>
              )}
              <div className="flex justify-between py-3 mt-2 border-t-2 border-gray-800" style={{ borderTop: '2px solid #1f2937', padding: '12px 0' }}>
                <span className="text-base font-bold text-gray-900">Balance Due:</span>
                <span className={`text-base font-bold ${remainingBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {formatCurrency(remainingBalance, currency)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Payment Details (if payment was made) */}
        {totalPaid > 0 && (
          <div className="mb-8 p-4 bg-gray-50 border border-gray-200 rounded-lg" style={{ padding: '16px', backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
            <p className="text-sm font-semibold text-gray-900 mb-2">Payment Details:</p>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Payment Amount:</span>
              <span className="font-semibold text-gray-900">{formatCurrency(totalPaid, currency)}</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-gray-600">Payment Date:</span>
              <span className="font-semibold text-gray-900">{today}</span>
            </div>
            {renderPaymentAllocationRows()}
            <div className="flex justify-between text-sm mt-1">
              <span className="text-gray-600">Payment Status:</span>
              <span className="font-semibold text-green-600">Paid</span>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 pt-6 border-t-2 border-gray-800 text-center" style={{ marginTop: '48px', paddingTop: '24px', borderTop: '2px solid #1f2937' }}>
          <p className="text-xs text-gray-600 mb-2">
            Thank you for choosing {appName} for your dental care needs.
          </p>
          <p className="text-xs text-gray-500">
            This is a computer-generated receipt. No signature required.
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Please retain this receipt for your records.
          </p>
        </div>
      </div>
    </div>
  );

  // ─── Thermal Print Version ─────────────────────────────────────────────

  const renderThermalPrint = () => (
    <div className="receipt-print">
      <div ref={thermalPrintContentRef} className="thermal-receipt-content" style={{
        width: thermalPaperWidth,
        boxSizing: 'border-box',
        margin: '0 auto',
        padding: thermalContentPadding,
        background: 'white',
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: thermalBaseFontSize,
        fontWeight: thermalTypography.weight,
        lineHeight: '1.3',
        color: '#222'
      }}>
        {/* Clinic Header */}
        <div style={{ textAlign: 'center', marginBottom: '6px' }}>
          <div style={{ fontSize: thermalHeaderFontSize, fontWeight: 700, letterSpacing: '1px' }}>{displayHeaderTitle}</div>
          <div style={{ fontSize: thermalSmallFontSize, color: '#555' }}>Professional Dental Care Services</div>
          <div style={{ fontSize: thermalSmallFontSize, color: '#777', marginTop: '2px' }}>{receiptEmail} | {receiptPhone}</div>
        </div>

        <div style={{ borderTop: '2px solid #333', margin: '4px 0' }} />

        {/* Receipt Info */}
        <div style={{ marginBottom: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: thermalSmallFontSize }}>
            <span>Receipt #: {receiptNumber}</span>
            <span>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
        </div>

        <div style={{ borderTop: '1px dashed #333', margin: '4px 0' }} />

        {/* Patient Info */}
        <div style={{ marginBottom: '6px' }}>
          <div style={{ fontSize: thermalBaseFontSize, fontWeight: 700 }}>{patient.name}</div>
          <div style={{ fontSize: thermalSmallFontSize, color: '#555' }}>{patient.email}</div>
          <div style={{ fontSize: thermalSmallFontSize, color: '#555' }}>{patient.phone}</div>
        </div>

        <div style={{ borderTop: '1px dashed #333', margin: '4px 0' }} />

        {/* Services */}
        {renderThermalServices()}

        {/* Medicines */}
        {renderThermalMedicines()}

        <div style={{ borderTop: '2px solid #333', margin: '4px 0' }} />

        {/* Summary */}
        <div style={{ marginBottom: '6px' }}>
          {thermalLine('Treatment Services:', formatCurrency(totalTreatmentStandardCost, currency))}
            {totalTreatmentDiscount > 0 && thermalLine('Treatment Discount:', `-${formatCurrency(totalTreatmentDiscount, effectiveCurrency)}`, undefined, { color: '#b45309' })}
            {thermalLine('Medicines & Items:', formatCurrency(totalMedicineStandardCost, effectiveCurrency))}
            {totalMedicineDiscount > 0 && thermalLine('Item Discount:', `-${formatCurrency(totalMedicineDiscount, effectiveCurrency)}`, undefined, { color: '#15803d' })}
          <div style={{ borderTop: '1px dashed #333', margin: '4px 0' }} />
          {thermalLine('Subtotal:', formatCurrency(grandTotal, currency), undefined, { fontWeight: 700 })}
          {totalPaid > 0 && thermalLine('Payment Received:', `-${formatCurrency(totalPaid, currency)}`, undefined, { color: '#16a34a' })}
          <div style={{ borderTop: '2px solid #333', margin: '4px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: thermalBaseFontSize, fontWeight: 700, marginTop: '2px' }}>
            <span>BALANCE DUE</span>
            <span style={{ color: remainingBalance > 0 ? '#dc2626' : '#16a34a' }}>
              {formatCurrency(remainingBalance, currency)}
            </span>
          </div>
        </div>

        <div style={{ borderTop: '2px solid #333', margin: '4px 0' }} />

        {/* Payment Details */}
        {totalPaid > 0 && (
          <div style={{ marginBottom: '6px', fontSize: thermalSmallFontSize, lineHeight: '1.35' }}>
            <div style={{ fontSize: thermalLineFontSize, fontWeight: 700, marginBottom: '3px', letterSpacing: '0.3px' }}>-- PAYMENT DETAILS --</div>
            {thermalLine('Amount Paid:', formatCurrency(totalPaid, currency), { fontSize: thermalSmallFontSize }, { fontSize: thermalSmallFontSize, fontWeight: 700 })}
            {thermalLine('Date:', today, { fontSize: thermalSmallFontSize }, { fontSize: thermalSmallFontSize })}
            {renderThermalPaymentAllocations()}
            {thermalLine('Status:', 'Paid', undefined, { color: '#16a34a' })}
          </div>
        )}

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: '8px', fontSize: thermalSmallFontSize, color: '#555' }}>
          <div style={{ fontWeight: 700, marginBottom: '2px' }}>Thank you for choosing {appName}!</div>
          <div>This is a computer-generated receipt.</div>
          <div>No signature required.</div>
        </div>

        {/* Receipt cut line */}
        <div style={{ textAlign: 'center', marginTop: '6px', fontSize: thermalSmallFontSize, color: '#999', letterSpacing: '2px' }}>
          - - - - - - - - - - - - - - - - -
        </div>
      </div>
    </div>
  );

  const renderPaymentA4Content = (isPrint = false) => {
    if (!paymentSnapshot) return null;

    return (
      <div
        className={isPrint ? 'receipt-content' : 'p-8 md:p-12 print:p-12'}
        style={{
          width: '210mm',
          minHeight: '297mm',
          margin: '0 auto',
          padding: isPrint ? '12mm' : undefined,
          background: 'white',
          fontSize: isPrint ? '12pt' : undefined,
          fontFamily: isPrint ? 'system-ui, sans-serif' : undefined
        }}
      >
        <div className="text-center mb-8 border-b-2 border-gray-800 pb-6">
          <h1 className="text-2xl font-black text-gray-900 mb-2">{displayHeaderTitle}</h1>
          <p className="text-sm text-gray-600">Official Payment Receipt</p>
          <p className="text-xs text-gray-500 mt-2">Email: {receiptEmail} | Phone: {receiptPhone}</p>
        </div>

        <div className="flex justify-between items-start mb-8">
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">RECEIVED FROM:</p>
            <p className="text-base font-bold text-gray-900">{patientDisplay.name}</p>
            {patientDisplay.patientUniqueId ? <p className="text-sm text-gray-600">Patient ID: {patientDisplay.patientUniqueId}</p> : null}
            {patientDisplay.email ? <p className="text-sm text-gray-600">{patientDisplay.email}</p> : null}
            {patientDisplay.phone ? <p className="text-sm text-gray-600">{patientDisplay.phone}</p> : null}
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600 mb-1">Receipt #: <span className="font-semibold">{receiptNumber}</span></p>
            <p className="text-sm text-gray-600">Date: <span className="font-semibold">{displayDate}</span></p>
          </div>
        </div>

        <div className="mb-8 rounded-2xl border border-emerald-100 bg-emerald-50 p-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Amount Received</p>
          <p className="mt-2 text-4xl font-black tracking-tight text-emerald-950">
            {formatCurrency(paymentSnapshot.payment.amountPaid, effectiveCurrency)}
          </p>
        </div>

        {renderServicesTable(isPrint)}
        {renderMedicinesTable(isPrint)}

        <div className="mb-8">
          <div className="flex justify-end">
            <div className="w-72">
              <div className="flex justify-between py-2 border-b border-gray-300">
                <span className="text-sm font-semibold text-gray-700">Treatment Services:</span>
                <span className="text-sm font-semibold text-gray-900">{formatCurrency(totalTreatmentStandardCost, effectiveCurrency)}</span>
              </div>
              {totalTreatmentDiscount > 0 ? (
                <div className="flex justify-between py-2 border-b border-gray-300">
                  <span className="text-sm font-semibold text-gray-700">Treatment Discount:</span>
                  <span className="text-sm font-semibold text-amber-700">-{formatCurrency(totalTreatmentDiscount, effectiveCurrency)}</span>
                </div>
              ) : null}
              <div className="flex justify-between py-2 border-b border-gray-300">
                <span className="text-sm font-semibold text-gray-700">Medicines & Items:</span>
                <span className="text-sm font-semibold text-gray-900">{formatCurrency(totalMedicineStandardCost, effectiveCurrency)}</span>
              </div>
              {totalMedicineDiscount > 0 ? (
                <div className="flex justify-between py-2 border-b border-gray-300">
                  <span className="text-sm font-semibold text-gray-700">Item Discount:</span>
                  <span className="text-sm font-semibold text-emerald-700">-{formatCurrency(totalMedicineDiscount, effectiveCurrency)}</span>
                </div>
              ) : null}
              {paymentServiceFeeAmount > 0 ? (
                <div className="flex justify-between py-2 border-b border-gray-300">
                  <span className="text-sm font-semibold text-gray-700">{paymentServiceFeeLabel}:</span>
                  <span className="text-sm font-semibold text-gray-900">{formatCurrency(paymentServiceFeeAmount, effectiveCurrency)}</span>
                </div>
              ) : null}
              <div className="flex justify-between py-2 border-b border-gray-300">
                <span className="text-sm font-semibold text-gray-700">Subtotal:</span>
                <span className="text-sm font-semibold text-gray-900">{formatCurrency(grandTotal, effectiveCurrency)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-300">
                <span className="text-sm font-semibold text-gray-700">Payment Received:</span>
                <span className="text-sm font-semibold text-emerald-700">-{formatCurrency(paymentSnapshot.payment.amountPaid, effectiveCurrency)}</span>
              </div>
              <div className="flex justify-between py-3 mt-2 border-t-2 border-gray-800">
                <span className="text-base font-bold text-gray-900">Remaining Balance:</span>
                <span className={`text-base font-bold ${paymentSnapshot.payment.balanceAfter > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {paymentSnapshot.payment.balanceAfter > 0 ? formatCurrency(paymentSnapshot.payment.balanceAfter, effectiveCurrency) : 'Clear'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Payment Details</p>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Payment Method</span>
                <span className="font-semibold text-slate-900">{formatPaymentMethod(paymentSnapshot.payment.method)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Payment Date</span>
                <span className="font-semibold text-slate-900">{displayDate}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Status</span>
                <span className="font-semibold text-emerald-700">{paymentSnapshot.payment.status === 'FULL' ? 'Paid in Full' : 'Partial Payment'}</span>
              </div>
              {paymentSnapshot.payment.recordedByUserName ? (
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Recorded By</span>
                  <span className="font-semibold text-slate-900">{paymentSnapshot.payment.recordedByUserName}</span>
                </div>
              ) : null}
              {paymentServiceFeeAmount > 0 ? (
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">{paymentServiceFeeLabel}</span>
                  <span className="font-semibold text-slate-900">{formatCurrency(paymentServiceFeeAmount, effectiveCurrency)}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Balance Summary</p>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Balance Before Payment</span>
                <span className="font-semibold text-slate-900">{formatCurrency(paymentSnapshot.payment.balanceBefore, effectiveCurrency)}</span>
              </div>
              {paymentServiceFeeAmount > 0 ? (
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">{paymentServiceFeeLabel}</span>
                  <span className="font-semibold text-slate-900">{formatCurrency(paymentServiceFeeAmount, effectiveCurrency)}</span>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Payment Received</span>
                <span className="font-semibold text-emerald-700">-{formatCurrency(paymentSnapshot.payment.amountPaid, effectiveCurrency)}</span>
              </div>
              <div className="flex justify-between gap-4 border-t border-slate-200 pt-3">
                <span className="text-slate-700 font-semibold">Remaining Balance</span>
                <span className={`font-black ${paymentSnapshot.payment.balanceAfter > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {paymentSnapshot.payment.balanceAfter > 0 ? formatCurrency(paymentSnapshot.payment.balanceAfter, effectiveCurrency) : 'Clear'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-900">
          This payment receipt reflects the amount collected, the treatment and medicine lines included at payment time, and the updated account balance at that moment.
        </div>

        <div className="mt-12 pt-6 border-t-2 border-gray-800 text-center">
          <p className="text-xs text-gray-600 mb-2">Thank you for choosing {effectiveAppName} for your dental care needs.</p>
          <p className="text-xs text-gray-500">This is a computer-generated payment receipt. No signature required.</p>
          <p className="text-xs text-gray-500 mt-2">Please retain this receipt for your records.</p>
        </div>
      </div>
    );
  };

  const renderPaymentThermalContent = (isPrint = false) => {
    if (!paymentSnapshot) return null;

    return (
      <div
        ref={isPrint ? thermalPrintContentRef : undefined}
        className="thermal-receipt-content"
        style={{
          width: thermalPaperWidth,
          boxSizing: 'border-box',
          margin: '0 auto',
          padding: thermalContentPadding,
          background: 'white',
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: thermalBaseFontSize,
          fontWeight: thermalTypography.weight,
          lineHeight: '1.3',
          color: '#222'
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '6px' }}>
          <div style={{ fontSize: thermalHeaderFontSize, fontWeight: 700, letterSpacing: '1px' }}>{displayHeaderTitle}</div>
          <div style={{ fontSize: thermalSmallFontSize, color: '#555' }}>PAYMENT RECEIPT</div>
          <div style={{ fontSize: thermalSmallFontSize, color: '#777', marginTop: '2px' }}>{receiptEmail} | {receiptPhone}</div>
        </div>

        {thermalThickDivider()}
        {thermalLine('Receipt #:', receiptNumber, { fontSize: thermalSmallFontSize }, { fontSize: thermalSmallFontSize })}
        {thermalLine('Date:', formatShortDate(`${paymentSnapshot.receiptDate}T00:00:00`), { fontSize: thermalSmallFontSize }, { fontSize: thermalSmallFontSize })}
        {thermalDivider()}

        <div style={{ marginBottom: '6px' }}>
          <div style={{ fontSize: thermalBaseFontSize, fontWeight: 700 }}>{patientDisplay.name}</div>
          {patientDisplay.patientUniqueId ? <div style={{ fontSize: thermalSmallFontSize, color: '#555' }}>ID: {patientDisplay.patientUniqueId}</div> : null}
          {patientDisplay.phone ? <div style={{ fontSize: thermalSmallFontSize, color: '#555' }}>{patientDisplay.phone}</div> : null}
          {patientDisplay.email ? <div style={{ fontSize: thermalSmallFontSize, color: '#555' }}>{patientDisplay.email}</div> : null}
        </div>

        {thermalDivider()}
        <div style={{ textAlign: 'center', margin: '6px 0' }}>
          <div style={{ fontSize: thermalSmallFontSize, color: '#555' }}>AMOUNT RECEIVED</div>
          <div style={{ fontSize: thermalAmountFontSize, fontWeight: 700 }}>{formatCurrency(paymentSnapshot.payment.amountPaid, effectiveCurrency)}</div>
        </div>

        {thermalDivider()}
        {renderThermalServices()}
        {renderThermalMedicines()}

        {thermalThickDivider()}
        <div style={{ marginBottom: '6px' }}>
          {thermalLine('Treatment Services:', formatCurrency(totalTreatmentStandardCost, effectiveCurrency))}
          {totalTreatmentDiscount > 0 ? thermalLine('Treatment Discount:', `-${formatCurrency(totalTreatmentDiscount, effectiveCurrency)}`, undefined, { color: '#b45309' }) : null}
          {thermalLine('Medicines & Items:', formatCurrency(totalMedicineStandardCost, effectiveCurrency))}
          {totalMedicineDiscount > 0 ? thermalLine('Item Discount:', `-${formatCurrency(totalMedicineDiscount, effectiveCurrency)}`, undefined, { color: '#15803d' }) : null}
          {paymentServiceFeeAmount > 0 ? thermalLine(`${paymentServiceFeeLabel}:`, formatCurrency(paymentServiceFeeAmount, effectiveCurrency)) : null}
          {thermalDivider()}
          {thermalLine('Subtotal:', formatCurrency(grandTotal, effectiveCurrency), undefined, { fontWeight: 700 })}
          {thermalLine('Payment Received:', `-${formatCurrency(paymentSnapshot.payment.amountPaid, effectiveCurrency)}`, undefined, { color: '#16a34a' })}
        </div>

        {thermalThickDivider()}
        <div style={{ marginBottom: '6px', fontSize: thermalSmallFontSize, lineHeight: '1.35' }}>
          <div style={{ fontSize: thermalLineFontSize, fontWeight: 700, marginBottom: '3px', letterSpacing: '0.3px' }}>-- PAYMENT DETAILS --</div>
          {thermalLine('Method:', formatPaymentMethod(paymentSnapshot.payment.method))}
          {thermalLine('Status:', paymentSnapshot.payment.status === 'FULL' ? 'Paid in Full' : 'Partial Payment')}
          {paymentServiceFeeAmount > 0 ? thermalLine('Fee:', `${paymentServiceFeeLabel} ${formatCurrency(paymentServiceFeeAmount, effectiveCurrency)}`) : null}
          {paymentSnapshot.payment.recordedByUserName ? thermalLine('Recorded By:', paymentSnapshot.payment.recordedByUserName) : null}
        </div>

        {thermalDivider()}
        <div style={{ marginBottom: '6px', fontSize: thermalSmallFontSize, lineHeight: '1.35' }}>
          <div style={{ fontSize: thermalLineFontSize, fontWeight: 700, marginBottom: '3px', letterSpacing: '0.3px' }}>-- BALANCE SUMMARY --</div>
          {thermalLine('Before Payment:', formatCurrency(paymentSnapshot.payment.balanceBefore, effectiveCurrency))}
          {thermalLine('Payment Received:', `-${formatCurrency(paymentSnapshot.payment.amountPaid, effectiveCurrency)}`, undefined, { color: '#16a34a' })}
          {thermalThickDivider()}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: thermalBaseFontSize, fontWeight: 700, marginTop: '2px' }}>
            <span>REMAINING</span>
            <span style={{ color: paymentSnapshot.payment.balanceAfter > 0 ? '#b45309' : '#16a34a' }}>
              {paymentSnapshot.payment.balanceAfter > 0 ? formatCurrency(paymentSnapshot.payment.balanceAfter, effectiveCurrency) : 'Clear'}
            </span>
          </div>
        </div>

        {thermalThickDivider()}
        <div style={{ textAlign: 'center', marginTop: '8px', fontSize: thermalSmallFontSize, color: '#555' }}>
          <div style={{ fontWeight: 700, marginBottom: '2px' }}>Thank you for choosing {effectiveAppName}.</div>
          <div>This is a computer-generated payment receipt.</div>
          <div>No signature required.</div>
        </div>

        <div style={{ textAlign: 'center', marginTop: '6px', fontSize: thermalSmallFontSize, color: '#999', letterSpacing: '2px' }}>
          - - - - - - - - - - - - - - - - -
        </div>
      </div>
    );
  };

  const renderPaymentA4Preview = () => (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 print:hidden">
      <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex justify-between items-center z-10">
          <h2 className="text-xl font-bold text-gray-800">Payment Receipt</h2>
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Printer className="w-4 h-4" /> Print
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        {renderPaymentA4Content()}
      </div>
    </div>
  );

  const renderPaymentA4Print = () => (
    <div className="receipt-print">
      {renderPaymentA4Content(true)}
    </div>
  );

  const renderPaymentThermalPreview = () => (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 print:hidden">
      <div className="bg-white rounded-xl shadow-2xl w-full max-h-[90vh] overflow-auto" style={{ maxWidth: isThermal80 ? '520px' : '380px' }}>
        <div className="sticky top-0 bg-white border-b border-gray-200 p-3 flex justify-between items-center z-10">
          <h2 className="text-sm font-bold text-gray-800">{isThermal80 ? '80mm Payment Receipt' : 'Payment Receipt'}</h2>
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1 bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors text-xs"
            >
              <Printer className="w-3 h-3" /> Print
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="p-4 bg-slate-100">
          <div className="mx-auto rounded-lg bg-white p-4 shadow-sm" style={{ width: thermalPreviewWidth }}>
            {renderPaymentThermalContent()}
          </div>
        </div>
      </div>
    </div>
  );

  const renderPaymentThermalPrint = () => (
    <div className="receipt-print">
      {renderPaymentThermalContent(true)}
    </div>
  );

  // ─── Main Return ───────────────────────────────────────────────────────

  const printReceipt = paymentSnapshot
    ? (isThermal ? renderPaymentThermalPrint() : renderPaymentA4Print())
    : (isThermal ? renderThermalPrint() : renderA4Print());
  const printPageSize = getReceiptPageSize(receiptSize, thermalPageHeightMm);
  const printPosition = getReceiptPrintPosition(receiptSize);
  const printPortal = typeof document === 'undefined'
    ? null
    : createPortal(
      <>
        {printReceipt}
        <style>{`
        /* Keep the print copy measurable so its roll-paper height is exact,
           but move it completely outside the visible application canvas. */
        .receipt-print {
          position: fixed;
          left: -10000px;
          top: 0;
          visibility: hidden;
          pointer-events: none;
        }

        @media print {
          html,
          body {
            width: auto !important;
            min-height: 0 !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
          }

          /* Remove the application and every modal portal from print layout.
             visibility:hidden preserves their height and creates blank pages. */
          body > * {
            display: none !important;
          }

          body > .receipt-print {
            display: block !important;
            /* Normal flow starts the only printable body child at page origin.
               Absolute/fixed paged-media elements can be offset, centred, or
               repeated by Chromium and thermal printer drivers. */
            position: ${printPosition} !important;
            top: 0 !important;
            left: 0 !important;
            visibility: visible !important;
            pointer-events: auto !important;
            width: ${isThermal ? thermalPaperWidth : '210mm'} !important;
            min-height: 0 !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
          }

          .receipt-content {
            position: relative;
            margin: 0 auto;
          }

          .thermal-receipt-content {
            position: relative;
            display: block !important;
            width: ${thermalPaperWidth} !important;
            max-width: ${thermalPaperWidth} !important;
            min-height: 0 !important;
            height: auto !important;
            margin: 0 !important;
            overflow: visible !important;
            overflow-wrap: anywhere;
            color: #000 !important;
            font-weight: 600 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          /* Low-cost thermal heads lose gray pixels. Print every receipt glyph
             and rule as solid black while preserving the softer screen preview. */
          .thermal-receipt-content,
          .thermal-receipt-content * {
            color: #000 !important;
            border-color: #000 !important;
            text-shadow: 0 0 0 #000;
          }

          .thermal-receipt-content > * {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          @page {
            size: ${printPageSize};
            margin: 0;
          }
        }
      `}</style>
      </>,
      document.body
    );

  return (
    <>
      {paymentSnapshot
        ? (isThermal ? renderPaymentThermalPreview() : renderPaymentA4Preview())
        : (isThermal ? renderThermalPreview() : renderA4Preview())}
      {printPortal}
    </>
  );
};

export default Receipt;
