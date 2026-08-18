import React, { useState, useMemo } from 'react';
import { Beaker, Loader2, Download, CalendarDays, Stethoscope, ShieldCheck, Search, RotateCw, WalletCards, Printer, Pencil, Package } from 'lucide-react';
import { Appointment, AppointmentRescheduleLog, ClinicalRecord, PaymentRecord, TreatmentCostSummary } from '../types';
import { formatCurrency, Currency } from '../utils/currency';
import { exportClinicalRecordsToPDF } from '../utils/pdfExport';
import { exportClinicalRecordsToExcel } from '../utils/excelExport';
import { formatTeethWithPosition } from '../utils/toothNumbering';
import Pagination from './Pagination';
import ExportMenu from './ExportMenu';
import { toLocalISODate } from '../utils/auditLogFilters';
import { buildAuditLogRows, filterAuditLogRowsForExport, getAuditPaymentDiscount, type AuditExportRow, type AuditFilter } from '../utils/auditLogExport';
import { buildRecordsViewFilterOptions } from '../utils/recordsViewFilterOptions';
import { formatPaymentAllocations, formatPaymentMethod } from '../utils/paymentMethods';
import { formatDoctorName as formatDisplayDoctorName } from '../utils/doctorName';
import EditPaymentModal from './EditPaymentModal';
import { api } from '../services/api';
import { calculateMaterialAdjustedDoctorEarnings } from '../utils/materialCostCalculations';

interface RecordsViewProps {
  records: ClinicalRecord[];
  appointments?: Appointment[];
  rescheduleLogs?: AppointmentRescheduleLog[];
  payments?: PaymentRecord[];
  loading: boolean;
  onRefresh: () => void | Promise<void>;
  onDeleteAll: () => void;
  currency: Currency;
  isDoctor?: boolean;
  initialFilter?: AuditFilter;
  onOpenPaymentReceipt?: (payment: PaymentRecord) => void;
  canEditPayments?: boolean;
  onPaymentCorrected?: (payment: PaymentRecord) => void | Promise<void>;
  loadError?: string | null;
  onQueryChange?: (query: { dateFrom: string; dateTo: string; auditFilter: AuditFilter }) => void;
}

const RecordsView: React.FC<RecordsViewProps> = ({ records, appointments = [], rescheduleLogs = [], payments = [], loading, onRefresh, onDeleteAll, currency, isDoctor = false, initialFilter = 'all', onOpenPaymentReceipt, canEditPayments = false, onPaymentCorrected, loadError = null, onQueryChange }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [auditFilter, setAuditFilter] = useState<AuditFilter>(initialFilter);
  const [editingPayment, setEditingPayment] = useState<PaymentRecord | null>(null);
  const todayKey = useMemo(() => toLocalISODate(new Date()), []);
  const [dateFrom, setDateFrom] = useState(todayKey);
  const [dateTo, setDateTo] = useState(todayKey);
  const [materialSummaries, setMaterialSummaries] = useState<Record<string, TreatmentCostSummary>>({});
  const isTodayRange = dateFrom === todayKey && dateTo === todayKey;
  const itemsPerPage = 10;

  const handleDateFromChange = (value: string) => {
    setDateFrom(value);
    if (value > dateTo) {
      setDateTo(value);
    }
    setCurrentPage(1);
  };

  const handleDateToChange = (value: string) => {
    setDateTo(value);
    if (value < dateFrom) {
      setDateFrom(value);
    }
    setCurrentPage(1);
  };

  const handleResetToToday = () => {
    setDateFrom(todayKey);
    setDateTo(todayKey);
    setCurrentPage(1);
  };

  const formatCreatedAt = (value?: string | null) => {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const renderPatientBalance = (balance?: number | null) => {
    if (balance === null || balance === undefined) return <span className="text-gray-400">-</span>;
    const numericBalance = Number(balance || 0);
    return (
      <span className={numericBalance > 0 ? 'font-bold text-red-600' : 'font-semibold text-green-600'}>
        {numericBalance > 0 ? formatCurrency(numericBalance, currency) : 'Clear'}
      </span>
    );
  };

  const formatDoctorName = (doctorName?: string | null) => {
    return formatDisplayDoctorName(doctorName);
  };

  const renderPaymentCorrections = (payment: PaymentRecord) => {
    if (!payment.corrections || payment.corrections.length === 0) return null;

    return (
      <div className="mt-2 space-y-2">
        {payment.corrections.map((correction) => (
          <div key={correction.id} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span className="font-bold">Warning: Corrected by Admin</span>{' '}
            on {formatCreatedAt(correction.editedAt)}
            {' | '}Reason: {correction.reason}
            {' '}(
            Changed from {formatCurrency(correction.oldAmount, currency)}
            {' to '}
            {formatCurrency(correction.newAmount, currency)}
            )
            {correction.editorName ? ` by ${correction.editorName}` : ''}
            {correction.oldAllocations?.length || correction.newAllocations?.length ? (
              <span className="mt-1 block">
                Tender: {formatPaymentAllocations(correction.oldAllocations)} → {formatPaymentAllocations(correction.newAllocations)}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    );
  };

  const renderTreatmentDescriptionList = (rec: ClinicalRecord) => {
    const groupedRecords = (rec as any)._groupedRecords as ClinicalRecord[] | undefined;
    const descriptionRecords = groupedRecords?.length ? groupedRecords : [rec];

    return (
      <div className="space-y-1">
        {descriptionRecords.map((record, index) => (
          <div key={`${record.id || index}-${index}`} className="flex min-w-0 items-start gap-1.5">
            <span className="mt-0.5 shrink-0 text-blue-500">•</span>
            <span className="min-w-0 break-words">{record.description || 'Treatment record'}</span>
          </div>
        ))}
      </div>
    );
  };

  const getTreatmentRecordIds = (record: ClinicalRecord & { _groupedRecords?: ClinicalRecord[] }) => {
    const groupedRecords = record._groupedRecords?.length ? record._groupedRecords : [record];
    return groupedRecords.map((item) => item.id).filter(Boolean);
  };

  const getMaterialTotal = (record: ClinicalRecord & { _groupedRecords?: ClinicalRecord[] }) => {
    return getTreatmentRecordIds(record).reduce((sum, treatmentId) => (
      sum + Number(materialSummaries[treatmentId]?.totalAmount || 0)
    ), 0);
  };

  const getTypedCostTotal = (record: ClinicalRecord & { _groupedRecords?: ClinicalRecord[] }, costType: 'material' | 'lab') => {
    const key = costType === 'lab' ? 'labTotal' : 'materialTotal';
    return getTreatmentRecordIds(record).reduce((sum, treatmentId) => sum + Number(materialSummaries[treatmentId]?.[key] || 0), 0);
  };

  const getAdjustedDoctorEarned = (record: ClinicalRecord & { _groupedRecords?: ClinicalRecord[] }) => {
    const groupedRecords = record._groupedRecords?.length ? record._groupedRecords : [record];
    return calculateMaterialAdjustedDoctorEarnings(groupedRecords);
  };

  const auditRows = useMemo<AuditExportRow[]>(
    () => buildAuditLogRows(records, appointments, !isDoctor, payments, rescheduleLogs),
    [records, appointments, payments, rescheduleLogs, isDoctor]
  );

  const filteredRows = useMemo(() => {
    return filterAuditLogRowsForExport(auditRows, buildRecordsViewFilterOptions({ isDoctor, auditFilter, dateFrom, dateTo, searchTerm }));
  }, [auditRows, auditFilter, searchTerm, dateFrom, dateTo, isDoctor]);

  const paginatedRows = useMemo(() => {
    if (showAll) return filteredRows;
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredRows.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredRows, currentPage, showAll]);

  React.useEffect(() => {
    if (loading) return;

    const treatmentIds = paginatedRows.flatMap((row) => (
      row.kind === 'treatment' ? getTreatmentRecordIds(row.record) : []
    ));

    if (treatmentIds.length === 0) {
      setMaterialSummaries({});
      return;
    }

    let isMounted = true;
    void api.materialCosts.getTotalsByTreatmentIds(treatmentIds)
      .then((summaries) => {
        if (!isMounted) return;
        setMaterialSummaries((current) => {
          const next = { ...current };
          treatmentIds.forEach((treatmentId) => {
            delete next[treatmentId];
          });
          return { ...next, ...summaries };
        });
      })
      .catch((error) => {
        console.warn('Unable to load audit log material cost totals.', error);
      });

    return () => {
      isMounted = false;
    };
  }, [paginatedRows, loading]);

  const filteredSummary = useMemo(() => {
    return filteredRows.reduce(
      (summary, row) => {
        if (row.kind === 'appointment') summary.appointments += 1;
        if (row.kind === 'reschedule') summary.appointments += 1;
        if (row.kind === 'reschedule') summary.reschedules += 1;
        if (row.kind === 'treatment') summary.treatments += 1;
        if (row.kind === 'payment') summary.payments += 1;
        return summary;
      },
      { appointments: 0, reschedules: 0, treatments: 0, payments: 0 }
    );
  }, [filteredRows]);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [records, appointments, rescheduleLogs, payments, auditFilter, dateFrom, dateTo]);

  React.useEffect(() => {
    setAuditFilter(initialFilter);
    setCurrentPage(1);
  }, [initialFilter]);

  React.useEffect(() => {
    onQueryChange?.({ dateFrom, dateTo, auditFilter });
  }, [dateFrom, dateTo, auditFilter, onQueryChange]);

  const handleDownloadPDF = () => {
    exportClinicalRecordsToPDF(records, currency, {
      appointments,
      payments,
      rescheduleLogs,
      includeAppointments: !isDoctor,
      ...buildRecordsViewFilterOptions({ isDoctor, auditFilter, dateFrom, dateTo, searchTerm })
    });
  };

  const handleDownloadExcel = async () => {
    await exportClinicalRecordsToExcel(records, currency, {
      appointments,
      payments,
      rescheduleLogs,
      includeAppointments: !isDoctor,
      ...buildRecordsViewFilterOptions({ isDoctor, auditFilter, dateFrom, dateTo, searchTerm })
    });
  };

  const handleDownloadJSON = () => {
    const dataStr = JSON.stringify(filteredRows, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${isDoctor ? 'patient-records' : 'clinic-audit-logs'}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setTimeout(() => {
      if (confirm(`Download complete. Delete all ${records.length} clinical treatment records for this branch? Appointments and payment audit records will be kept. This cannot be undone.`)) {
        onDeleteAll();
      }
    }, 500);
  };

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm animate-fade-in">
      {loadError && (
        <div className="m-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 sm:m-4">
          {loadError}
        </div>
      )}
      <div className="border-b border-slate-200 bg-gradient-to-br from-slate-50 via-white to-blue-50/40">
        <div className="flex min-w-0 flex-col gap-4 p-3 sm:p-4 md:p-6 xl:flex-row xl:items-start xl:justify-between xl:gap-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="hidden sm:flex h-11 w-11 items-center justify-center rounded-2xl theme-accent-soft-bg theme-accent-text border theme-accent-border">
            <ShieldCheck size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] theme-accent-text sm:text-[11px] sm:tracking-[0.24em]">Clinical governance</p>
            <h2 className="break-words text-xl font-bold text-slate-900 sm:text-2xl">{isDoctor ? 'Patient Treatment Records' : 'Clinical Audit Trail'}</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500 sm:text-sm">
              {isDoctor ? 'Your completed treatments and patient clinical history.' : 'A daily operational record of appointments, treatments, responsible staff, and patient balances.'}
            </p>
            {!isDoctor && (
              <div className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-1 text-xs sm:flex-wrap sm:overflow-visible sm:pb-0">
                <span className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-center font-semibold text-slate-700 sm:text-left">{filteredRows.length} visible</span>
                <span className="shrink-0 rounded-full border theme-accent-border theme-accent-soft-bg px-3 py-1 text-center font-semibold theme-accent-text sm:text-left">{filteredSummary.appointments} appts</span>
                <span className="shrink-0 rounded-full border border-amber-100 bg-amber-50 px-3 py-1 text-center font-semibold text-amber-700 sm:text-left">{filteredSummary.reschedules} reschedules</span>
                <span className="shrink-0 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-center font-semibold text-emerald-700 sm:text-left">{filteredSummary.treatments} treatments</span>
                <span className="shrink-0 rounded-full border border-violet-100 bg-violet-50 px-3 py-1 text-center font-semibold text-violet-700 sm:text-left">{filteredSummary.payments} payments</span>
              </div>
            )}
          </div>
        </div>
        {!isDoctor && (
          <div className="w-full min-w-0 space-y-3 xl:max-w-5xl">
            <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm">
              <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <div className="min-w-0">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.16em] mb-1">From</label>
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo}
                  onChange={(e) => handleDateFromChange(e.target.value)}
                  className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-2.5 py-2.5 text-xs text-slate-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 min-[380px]:text-sm sm:w-36 sm:px-3"
                />
              </div>
              <div className="min-w-0">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.16em] mb-1">To</label>
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom}
                  onChange={(e) => handleDateToChange(e.target.value)}
                  className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-2.5 py-2.5 text-xs text-slate-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 min-[380px]:text-sm sm:w-36 sm:px-3"
                />
              </div>
              <button
                type="button"
                onClick={handleResetToToday}
                title={isTodayRange ? 'Showing today only' : 'Custom date range selected. Click to reset to today.'}
                className={`col-span-2 min-h-10 w-full self-end rounded-xl border px-4 py-2.5 text-xs font-bold transition-colors sm:col-span-1 sm:w-auto ${
                  isTodayRange
                    ? 'theme-accent-border theme-accent-soft-bg theme-accent-text hover:bg-blue-100'
                    : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                }`}
              >
                {isTodayRange ? 'Today' : 'Custom'}
              </button>
            </div>
                <div className="grid w-full grid-cols-2 rounded-xl border border-slate-200 bg-slate-50 p-1 min-[430px]:grid-cols-3 sm:inline-grid sm:w-auto sm:grid-cols-5">
              {[
                { value: 'all', label: 'All' },
                { value: 'appointments', label: 'Appointments' },
                { value: 'reschedules', label: 'Reschedule' },
                { value: 'treatments', label: 'Treatments' },
                { value: 'payments', label: 'Payments' }
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    setAuditFilter(item.value as AuditFilter);
                    setCurrentPage(1);
                  }}
                  className={`rounded-lg px-2 py-2 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--hover-300)] sm:px-3.5 ${
                    auditFilter === item.value ? 'bg-white theme-accent-text shadow-sm font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
                </div>
            </div>
            </div>
            <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full min-w-0 lg:max-w-md">
              <input
                type="text"
                placeholder="Search patient, doctor, staff, service..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--hover-300)]"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            </div>
            <div className="grid w-full grid-cols-1 gap-2 min-[420px]:grid-cols-3 lg:w-auto lg:flex lg:flex-row">
            <ExportMenu
              disabled={auditRows.length === 0}
              onExportPDF={handleDownloadPDF}
              onExportExcel={handleDownloadExcel}
              className="!w-full !rounded-xl !bg-slate-800 !font-semibold !shadow-sm hover:!bg-slate-900 lg:!w-auto"
              buttonLabelClassName="inline"
            />
            <button
              onClick={handleDownloadJSON}
              disabled={auditRows.length === 0}
              className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[var(--hover-300)] disabled:cursor-not-allowed disabled:opacity-50 sm:px-4"
            >
              <Download size={16} /> <span className="whitespace-nowrap">JSON Backup</span>
            </button>
            <button
              onClick={onRefresh}
              className="refresh-action-button flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[var(--hover-300)] sm:px-4"
            >
              <RotateCw size={16} className="refresh-action-icon" /> Refresh
            </button>
            </div>
            </div>
          </div>
        )}
        </div>
      </div>

      {loading ? (
        <div className="p-12 flex flex-col items-center justify-center gap-3 text-slate-500">
          <Loader2 className="animate-spin theme-accent-text" />
          <p className="text-sm font-medium">{isDoctor ? 'Loading patient records...' : 'Loading audit records...'}</p>
        </div>
      ) : (
        <>
          <div className="hidden lg:block overflow-x-auto">
            <table className="min-w-[1280px] w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-left text-[11px] font-black text-slate-500 uppercase tracking-[0.18em]">Type</th>
                  <th className="px-6 py-4 text-left text-[11px] font-black text-slate-500 uppercase tracking-[0.18em]">Date / Time</th>
                  <th className="px-6 py-4 text-left text-[11px] font-black text-slate-500 uppercase tracking-[0.18em]">Patient</th>
                  <th className="px-6 py-4 text-left text-[11px] font-black text-slate-500 uppercase tracking-[0.18em]">Clinician</th>
                  <th className="px-6 py-4 text-left text-[11px] font-black text-slate-500 uppercase tracking-[0.18em]">Clinical Activity</th>
                  <th className="px-6 py-4 text-left text-[11px] font-black text-slate-500 uppercase tracking-[0.18em]">Patient Type</th>
                  <th className="px-6 py-4 text-right text-[11px] font-black text-slate-500 uppercase tracking-[0.18em]">Patient Balance</th>
                  <th className="px-6 py-4 text-right text-[11px] font-black text-slate-500 uppercase tracking-[0.18em]">Amount</th>
                  <th className="px-6 py-4 text-right text-[11px] font-black text-amber-700 uppercase tracking-[0.18em]">Discount</th>
                  <th className="px-6 py-4 text-right text-[11px] font-black text-slate-500 uppercase tracking-[0.18em]">Service Charges</th>
                  <th className="px-6 py-4 text-right text-[11px] font-black text-slate-500 uppercase tracking-[0.18em]">Material & Lab</th>
                  <th className="px-6 py-4 text-right text-[11px] font-black text-slate-500 uppercase tracking-[0.18em]">Doctor Earned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-6 py-12 text-center">
                      <div className="mx-auto max-w-sm rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6">
                        <p className="text-sm font-semibold text-slate-600">{isDoctor ? 'No patient treatment records found' : 'No audit records found'}</p>
                        <p className="text-xs text-slate-400 mt-1">{isDoctor ? 'Completed treatments assigned to you will appear here.' : 'Try another date range or clear the search field.'}</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((row) => {
                    if (row.kind === 'payment') {
                      const payment = row.payment;
                      const paymentDiscount = getAuditPaymentDiscount(payment);
                      return (
                         <tr key={`payment-${payment.id}`} className="border-l-4 border-violet-300 transition-colors hover:bg-violet-50/40">
                          <td className="px-4 py-4 text-sm font-semibold text-violet-700 xl:px-6">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-xs font-bold">
                              <WalletCards size={14} /> Payment
                            </span>
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-500 whitespace-nowrap xl:px-6">{formatCreatedAt(payment.createdAt || payment.date)}</td>
                          <td className="px-4 py-4 font-bold text-slate-900 xl:px-6">{payment.patient_name || 'Unknown'}</td>
                          <td className="px-4 py-4 text-sm text-slate-400 xl:px-6">-</td>
                          <td className="px-4 py-4 text-sm text-slate-700 xl:px-6">
                            Patient paid {formatCurrency(payment.amount, currency)}{payment.receiptNumber ? ` · ${payment.receiptNumber}` : ''}
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-400 xl:px-6">-</td>
                          <td className="px-4 py-4 text-right text-sm xl:px-6">{renderPatientBalance(payment.remainingBalance)}</td>
                          <td className="px-4 py-4 text-right text-sm font-black text-violet-700 xl:px-6">{formatCurrency(payment.amount, currency)}</td>
                          <td className="px-4 py-4 text-right text-sm font-black text-amber-700 xl:px-6">{paymentDiscount > 0 ? `-${formatCurrency(paymentDiscount, currency)}` : '-'}</td>
                          <td className="px-4 py-4 text-right text-sm text-slate-400 xl:px-6">-</td>
                          <td className="px-4 py-4 text-right text-sm text-slate-400 xl:px-6">-</td>
                          <td className="px-4 py-4 text-sm font-bold text-slate-800 xl:px-6">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs font-semibold text-slate-500">{payment.createdByUserName || 'Unknown'} · {payment.allocations?.length ? formatPaymentAllocations(payment.allocations) : formatPaymentMethod(payment.paymentMethod)}</span>
                              <div className="flex items-center gap-2">
                                {canEditPayments ? (
                                  <button
                                    type="button"
                                    onClick={() => setEditingPayment(payment)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700 hover:bg-amber-100"
                                  >
                                    <Pencil size={12} />
                                    Edit
                                  </button>
                                ) : null}
                                {onOpenPaymentReceipt ? (
                                  <button
                                    type="button"
                                    onClick={() => onOpenPaymentReceipt(payment)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-bold text-violet-700 hover:bg-violet-100"
                                  >
                                    <Printer size={12} />
                                    Receipt
                                  </button>
                                ) : null}
                              </div>
                            </div>
                            {renderPaymentCorrections(payment)}
                          </td>
                        </tr>
                      );
                    }

                    if (row.kind === 'reschedule') {
                      const rescheduleLog = row.rescheduleLog;
                      return (
                        <tr key={`reschedule-${rescheduleLog.id}`} className="border-l-4 border-amber-300 transition-colors hover:bg-amber-50/40">
                          <td className="px-4 py-4 text-sm font-semibold text-amber-700 xl:px-6">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-xs font-bold">
                              <CalendarDays size={14} /> Rescheduled Appointment
                            </span>
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-500 whitespace-nowrap xl:px-6">{formatCreatedAt(rescheduleLog.created_at)}</td>
                          <td className="px-4 py-4 font-bold text-slate-900 xl:px-6">{rescheduleLog.patient_name || 'Unknown'}</td>
                          <td className="px-4 py-4 text-sm text-slate-700 xl:px-6">{formatDoctorName(rescheduleLog.doctor_name)}</td>
                          <td className="px-4 py-4 text-sm text-slate-700 max-w-md xl:px-6">
                            <div className="space-y-1">
                              <p className="font-semibold text-amber-800">Original Date: {rescheduleLog.original_date} -&gt; New Date: {rescheduleLog.new_date}</p>
                              <p>Reason: {rescheduleLog.reason || '-'}</p>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-400 xl:px-6">-</td>
                          <td className="px-4 py-4 text-right text-sm text-slate-400 xl:px-6">-</td>
                          <td className="px-4 py-4 text-right text-sm font-black text-slate-900 xl:px-6">-</td>
                          <td className="px-4 py-4 text-right text-sm text-slate-400 xl:px-6">-</td>
                          <td className="px-4 py-4 text-right text-sm text-slate-400 xl:px-6">-</td>
                          <td className="px-4 py-4 text-right text-sm text-slate-400 xl:px-6">-</td>
                          <td className="px-4 py-4 text-right text-sm text-slate-400 xl:px-6">-</td>
                        </tr>
                      );
                    }

                    if (row.kind === 'appointment') {
                      const appointment = row.appointment;
                      return (
                        <tr key={`appointment-${appointment.id}`} className="border-l-4 border-[var(--hover-300)] transition-colors hover:bg-[var(--hover-50)]/40">
                          <td className="px-4 py-4 text-sm theme-accent-text font-semibold xl:px-6">
                            <span className="inline-flex items-center gap-1.5 rounded-full border theme-accent-border theme-accent-soft-bg px-2.5 py-1 text-xs font-bold">
                              <CalendarDays size={14} /> Appointment
                            </span>
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-500 whitespace-nowrap xl:px-6">{appointment.date} {appointment.time}</td>
                          <td className="px-4 py-4 font-bold text-slate-900 xl:px-6">{appointment.patient_name || 'Unknown'}</td>
                          <td className="px-4 py-4 text-sm text-slate-700 xl:px-6">{formatDoctorName(appointment.doctor_name)}</td>
                          <td className="px-4 py-4 text-sm text-slate-700 max-w-md xl:px-6">
                            Appointment made for {appointment.date} at {appointment.time} ({appointment.type || 'Checkup'}, {appointment.status})
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-400 xl:px-6">-</td>
                          <td className="px-4 py-4 text-right text-sm xl:px-6">{renderPatientBalance(appointment.patient_balance)}</td>
                          <td className="px-4 py-4 text-right text-sm font-black text-slate-900 xl:px-6">-</td>
                          <td className="px-4 py-4 text-right text-sm text-slate-400 xl:px-6">-</td>
                          <td className="px-4 py-4 text-right text-sm text-slate-400 xl:px-6">-</td>
                          <td className="px-4 py-4 text-right text-sm text-slate-400 xl:px-6">-</td>
                          <td className="px-4 py-4 text-right text-sm text-slate-400 xl:px-6">-</td>
                        </tr>
                      );
                    }

                    const rec = row.record;
                    const materialOnlyTotal = getTypedCostTotal(rec, 'material');
                    const labTotal = getTypedCostTotal(rec, 'lab');
                    const adjustedDoctorEarned = getAdjustedDoctorEarned(rec);
                    return (
                      <tr key={`treatment-${rec.id}`} className="border-l-4 border-emerald-300 transition-colors hover:bg-emerald-50/30">
                        <td className="px-4 py-4 text-sm text-emerald-700 font-semibold xl:px-6">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-bold">
                            <Stethoscope size={14} /> Treatment
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-500 whitespace-nowrap xl:px-6">{rec.date}</td>
                        <td className="px-4 py-4 font-bold text-slate-900 xl:px-6">{rec.patient_name || 'Unknown'}</td>
                        <td className="px-4 py-4 text-sm text-slate-700 xl:px-6">{formatDoctorName(rec.doctor_name)}</td>
                        <td className="px-4 py-4 text-sm text-slate-700 max-w-md xl:px-6">
                          {renderTreatmentDescriptionList(rec)}
                          <span className="block text-xs font-mono text-gray-500 mt-1">
                            {rec.teeth && rec.teeth.length > 0 ? formatTeethWithPosition(rec.teeth) : 'General'}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm font-semibold text-slate-700 xl:px-6">{rec.patient_type || '-'}</td>
                        <td className="px-4 py-4 text-right text-sm xl:px-6">{renderPatientBalance(rec.patient_balance)}</td>
                        <td className="px-4 py-4 text-right text-sm font-black text-slate-900 xl:px-6">{formatCurrency(rec.cost || 0, currency)}</td>
                        <td className="px-4 py-4 text-right text-sm font-black text-amber-700 xl:px-6">{rec.discountAmount ? `-${formatCurrency(rec.discountAmount, currency)}` : '-'}</td>
                        <td className="px-4 py-4 text-right text-sm font-bold text-indigo-700 xl:px-6">{rec.serviceCharges ? formatCurrency(rec.serviceCharges, currency) : '-'}</td>
                        <td className="px-4 py-4 text-right text-xs font-bold xl:px-6">
                          {materialOnlyTotal > 0 || labTotal > 0 ? (
                            <div className="space-y-1">
                              {materialOnlyTotal > 0 && <div className="text-cyan-700">M: {formatCurrency(materialOnlyTotal, currency)}</div>}
                              {labTotal > 0 && <div className="text-violet-700">L: {formatCurrency(labTotal, currency)}</div>}
                            </div>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-4 text-right text-sm font-bold text-emerald-700 xl:px-6">{adjustedDoctorEarned ? formatCurrency(adjustedDoctorEarned, currency) : '-'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="lg:hidden bg-slate-50/60 p-2 sm:p-3">
            {filteredRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
                <p className="text-sm font-semibold text-slate-600">{isDoctor ? 'No patient treatment records found' : 'No audit records found'}</p>
                <p className="text-xs text-slate-400 mt-1">{isDoctor ? 'Completed treatments assigned to you will appear here.' : 'Try another date range or search term.'}</p>
              </div>
            ) : (
              paginatedRows.map((row) => {
                if (row.kind === 'payment') {
                  const payment = row.payment;
                  const paymentDiscount = getAuditPaymentDiscount(payment);
                  return (
                    <div key={`payment-${payment.id}`} className="my-2 min-w-0 overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm ring-1 ring-violet-50">
                      <div className="border-l-4 border-violet-400 p-3 min-[380px]:p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-black uppercase tracking-wider text-violet-600">Payment</p>
                          <p className="mt-0.5 break-words text-sm font-bold text-slate-900">{payment.patient_name || 'Unknown'}</p>
                          <p className="mt-1 text-xs text-slate-500">{formatCreatedAt(payment.createdAt || payment.date)}</p>
                        </div>
                        <p className="shrink-0 text-right text-sm font-black text-violet-700">{formatCurrency(payment.amount, currency)}</p>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-violet-50 p-3">
                          <p className="text-[11px] font-semibold uppercase text-violet-600">Payment Type</p>
                          <p className="mt-1 text-sm font-bold text-violet-900">{payment.allocations?.length ? formatPaymentAllocations(payment.allocations) : formatPaymentMethod(payment.paymentMethod)}</p>
                        </div>
                        <div className="rounded-xl bg-rose-50 p-3 text-right">
                          <p className="text-[11px] font-semibold uppercase text-rose-600">Balance</p>
                          <div className="mt-1 text-sm">{renderPatientBalance(payment.remainingBalance)}</div>
                        </div>
                      </div>
                      {paymentDiscount > 0 ? (
                        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-amber-50 p-3">
                          <span className="text-xs font-semibold text-amber-700">Overall Discount</span>
                          <span className="min-w-0 text-right text-sm font-black text-amber-800">-{formatCurrency(paymentDiscount, currency)}</span>
                        </div>
                      ) : null}
                      <p className="mt-3 text-xs text-slate-500">
                        {payment.receiptNumber || 'No receipt number'} · Recorded by {payment.createdByUserName || 'Unknown'}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {canEditPayments ? (
                          <button
                            type="button"
                            onClick={() => setEditingPayment(payment)}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100"
                          >
                            <Pencil size={13} />
                            Edit Payment
                          </button>
                        ) : null}
                        {onOpenPaymentReceipt ? (
                          <button
                            type="button"
                            onClick={() => onOpenPaymentReceipt(payment)}
                            className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 hover:bg-violet-100"
                          >
                            <Printer size={13} />
                            Reprint Receipt
                          </button>
                        ) : null}
                      </div>
                      {renderPaymentCorrections(payment)}
                      </div>
                    </div>
                  );
                }

                if (row.kind === 'reschedule') {
                  const rescheduleLog = row.rescheduleLog;
                  return (
                    <div key={`reschedule-${rescheduleLog.id}`} className="my-2 min-w-0 overflow-hidden rounded-2xl border border-amber-100 bg-white shadow-sm ring-1 ring-amber-50">
                      <div className="border-l-4 border-amber-400 p-3 min-[380px]:p-4">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-black uppercase tracking-wider text-amber-600">Rescheduled Appointment</p>
                          <p className="mt-0.5 break-words text-sm font-bold text-slate-900">{rescheduleLog.patient_name || 'Unknown'}</p>
                          <p className="mt-1 text-xs text-slate-500">{formatCreatedAt(rescheduleLog.created_at)}</p>
                        </div>
                        <p className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-700">Rescheduled</p>
                      </div>
                      <div className="mt-3 rounded-xl bg-amber-50 p-3">
                        <p className="text-[11px] font-semibold uppercase text-amber-700">Changes</p>
                        <p className="mt-1 break-words text-sm text-slate-800">
                          Original Date: {rescheduleLog.original_date} -&gt; New Date: {rescheduleLog.new_date}
                        </p>
                        <p className="mt-2 break-words text-xs text-slate-600">Reason: {rescheduleLog.reason || '-'}</p>
                        <p className="mt-2 text-xs text-slate-500">{rescheduleLog.doctor_name ? formatDoctorName(rescheduleLog.doctor_name) : 'No clinician assigned'}</p>
                      </div>
                      <div className="mt-3 rounded-xl bg-slate-50 p-3">
                        <p className="text-[11px] font-semibold text-slate-500 uppercase mb-1">Admin</p>
                        <p className="break-words text-sm text-slate-800">{rescheduleLog.admin_name || 'Unknown'}</p>
                        <p className="text-xs text-slate-500 mt-1">{formatCreatedAt(rescheduleLog.created_at)}</p>
                      </div>
                      </div>
                    </div>
                  );
                }

                if (row.kind === 'appointment') {
                  const appointment = row.appointment;
                  return (
                    <div key={`appointment-${appointment.id}`} className="my-2 min-w-0 overflow-hidden rounded-2xl border theme-accent-border bg-white shadow-sm ring-1 ring-[var(--hover-50)]">
                      <div className="border-l-4 border-[var(--hover-400)] p-3 min-[380px]:p-4">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-black uppercase tracking-wider theme-accent-text">Appointment</p>
                          <p className="mt-0.5 break-words text-sm font-bold text-slate-900">{appointment.patient_name || 'Unknown'}</p>
                          <p className="mt-1 break-words text-xs text-slate-500">{appointment.date} at {appointment.time || 'No time'}</p>
                        </div>
                        <p className="shrink-0 rounded-full theme-accent-soft-bg px-2 py-1 text-[11px] font-black theme-accent-text">{appointment.status}</p>
                      </div>
                      <div className="mt-3 rounded-xl bg-slate-50 p-3">
                        <p className="text-[11px] font-semibold uppercase text-slate-500">Clinical Activity</p>
                        <p className="mt-1 break-words text-sm text-slate-800">
                          Appointment made for {appointment.date} at {appointment.time || 'No time'} ({appointment.type || 'Checkup'}, {appointment.status})
                        </p>
                        <p className="mt-2 text-xs text-slate-500">{appointment.doctor_name ? formatDoctorName(appointment.doctor_name) : 'No clinician assigned'}</p>
                      </div>
                      <div className="mt-3 rounded-xl bg-slate-50 p-3">
                        <p className="text-[11px] font-semibold text-slate-500 uppercase mb-1">Recorded By</p>
                        <p className="break-words text-sm text-slate-800">{appointment.created_by_user_name || 'Unknown'}</p>
                        <p className="text-xs text-slate-500 mt-1">{formatCreatedAt(appointment.created_at)}</p>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-rose-50 p-3">
                        <span className="text-xs font-semibold text-rose-700">Patient Balance</span>
                        <span className="min-w-0 text-right text-sm">{renderPatientBalance(appointment.patient_balance)}</span>
                      </div>
                      </div>
                    </div>
                  );
                }

                const rec = row.record;
                const materialOnlyTotal = getTypedCostTotal(rec, 'material');
                const labTotal = getTypedCostTotal(rec, 'lab');
                const adjustedDoctorEarned = getAdjustedDoctorEarned(rec);
                return (
                  <div key={`treatment-${rec.id}`} className="my-2 min-w-0 overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm ring-1 ring-emerald-50">
                    <div className="border-l-4 border-emerald-400 p-3 min-[380px]:p-4">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-black uppercase tracking-wider text-emerald-500">Treatment</p>
                        <p className="mt-0.5 break-words text-sm font-bold text-slate-900">{rec.patient_name || 'Unknown'}</p>
                        <p className="mt-1 text-xs text-slate-500">{rec.date}</p>
                        <p className="mt-1 break-words text-xs text-slate-500">{rec.doctor_name ? formatDoctorName(rec.doctor_name) : 'No clinician assigned'}</p>
                      </div>
                      <p className="shrink-0 text-right text-sm font-black text-slate-900">{formatCurrency(rec.cost || 0, currency)}</p>
                    </div>
                    {rec.discountAmount ? (
                      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-amber-50 p-3">
                        <span className="text-xs font-semibold text-amber-700">Treatment Discount</span>
                        <span className="min-w-0 text-right text-sm font-black text-amber-800">-{formatCurrency(rec.discountAmount, currency)}</span>
                      </div>
                    ) : null}
                    {materialOnlyTotal > 0 ? (
                      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[var(--hover-50)] p-3">
                        <span className="text-xs font-semibold text-[var(--hover-700)]">Material Cost</span>
                        <span className="inline-flex min-w-0 items-center gap-1 text-right text-sm font-bold text-[var(--hover-800)]">
                          <Package size={14} />
                          {formatCurrency(materialOnlyTotal, currency)}
                        </span>
                      </div>
                    ) : null}
                    {labTotal > 0 ? (
                      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-violet-50 p-3">
                        <span className="text-xs font-semibold text-violet-700">Lab Cost</span>
                        <span className="inline-flex min-w-0 items-center gap-1 text-right text-sm font-bold text-violet-800">
                          <Beaker size={14} />
                          {formatCurrency(labTotal, currency)}
                        </span>
                      </div>
                    ) : null}
                    {adjustedDoctorEarned ? (
                      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-emerald-50 p-3">
                        <span className="text-xs font-semibold text-emerald-700">Doctor Earned</span>
                        <span className="min-w-0 text-right text-sm font-bold text-emerald-800">{formatCurrency(adjustedDoctorEarned, currency)}</span>
                      </div>
                    ) : null}
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-rose-50 p-3">
                      <span className="text-xs font-semibold text-rose-700">Patient Balance</span>
                      <span className="min-w-0 text-right text-sm">{renderPatientBalance(rec.patient_balance)}</span>
                    </div>
                    <div className="mt-3 rounded-xl bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase mb-1">Treatment</p>
                      <div className="break-words text-sm text-slate-800">{renderTreatmentDescriptionList(rec)}</div>
                      <p className="mt-2 break-words font-mono text-xs text-slate-500">
                        {rec.teeth && rec.teeth.length > 0 ? formatTeethWithPosition(rec.teeth) : 'General'}
                      </p>
                    </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {!loading && filteredRows.length > 0 && (
        <Pagination
          totalItems={filteredRows.length}
          itemsPerPage={itemsPerPage}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          showAll={showAll}
          onToggleShowAll={() => setShowAll(!showAll)}
        />
      )}

      <EditPaymentModal
        isOpen={!!editingPayment}
        payment={editingPayment}
        onClose={() => setEditingPayment(null)}
        onSaved={async (updatedPayment) => {
          await onPaymentCorrected?.(updatedPayment);
        }}
      />

    </div>
  );
};

export default RecordsView;

