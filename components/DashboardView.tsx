import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DollarSign, Activity, Users, Calendar as CalendarIcon, PieChart as PieIcon, MapPin, TrendingDown, LineChart as LineChartIcon, Trophy, AlertTriangle, Clock, XCircle, ArrowUpRight, ChevronRight } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import { Patient, Appointment, ClinicalRecord, Location, Expense, PaymentRecord, CancellationOutcome } from '../types';
import { formatCurrency, Currency } from '../utils/currency';
import { formatPaymentMethod } from '../utils/paymentMethods';
import { appointmentPatientName, buildRecallsCancelsLists } from '../utils/recallsCancels';
import ExportMenu from './ExportMenu';
import TreatmentAnalysisView from './TreatmentAnalysisView';
import {
  buildDailyAppointmentData,
  buildDailyFinancialData,
  buildMonthlyProfitData,
  calculateDashboardRangeSummary,
  countPatientsCreatedInRange
} from '../utils/dashboardMath';
import { buildTreatmentAnalysis } from '../utils/treatmentAnalytics';
import type { MonthlyReport, MonthlyReportProgressCallback } from '../utils/monthlyReport';

interface DashboardViewProps {
  patients: Patient[];
  appointments: Appointment[];
  treatmentRecords: ClinicalRecord[];
  expenses: Expense[];
  paymentRecords: PaymentRecord[];
  currency: Currency;
  locations: Location[];
  selectedLocationId: string;
  allBranchesValue: string;
  canViewAllBranches: boolean;
  onLocationChange: (locationId: string) => void;
  onLoadTreatmentAnalysis: (dateFrom: string, dateTo: string) => Promise<ClinicalRecord[]>;
  onLoadMonthlyReport: (dateFrom: string, dateTo: string, onProgress: MonthlyReportProgressCallback) => Promise<MonthlyReport>;
  onSelectPatient: (patient: Patient) => void;
  onUpdateCancellationOutcome: (id: string, outcome: CancellationOutcome | null, completedLaterAppointmentId?: string | null) => Promise<void>;
  loading?: boolean;
}

const toLocalISODate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const DashboardView: React.FC<DashboardViewProps> = ({
  patients,
  appointments,
  treatmentRecords,
  expenses,
  paymentRecords,
  currency,
  locations,
  selectedLocationId,
  allBranchesValue,
  canViewAllBranches,
  onLocationChange,
  onLoadTreatmentAnalysis,
  onLoadMonthlyReport,
  onSelectPatient,
  onUpdateCancellationOutcome,
  loading = false
}) => {
  const selectedLocationName = useMemo(() => {
    if (selectedLocationId === allBranchesValue) return 'All Branches';
    return locations.find(location => location.id === selectedLocationId)?.name || 'Current Branch';
  }, [allBranchesValue, locations, selectedLocationId]);

  const todayKey = useMemo(() => toLocalISODate(new Date()), []);
  const [activeTab, setActiveTab] = useState<'overview' | 'recalls-cancels' | 'treatment-analysis'>('overview');
  const [exportingRecallsCancels, setExportingRecallsCancels] = useState(false);
  const [cancellationTab, setCancellationTab] = useState<'pending' | 'no-show' | 'rescheduled' | 'completed-later'>('pending');
  const [savingCancellationId, setSavingCancellationId] = useState<string | null>(null);
  const [completedLaterPickerId, setCompletedLaterPickerId] = useState<string | null>(null);
  const [exportingMonthlyReport, setExportingMonthlyReport] = useState(false);
  const [monthlyReportProgress, setMonthlyReportProgress] = useState({ percent: 0, label: '' });
  const [dateFrom, setDateFrom] = useState(todayKey);
  const [dateTo, setDateTo] = useState(todayKey);
  const [analysisRecords, setAnalysisRecords] = useState<ClinicalRecord[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const analysisRequestRef = useRef(0);
  const monthlyReportRequestRef = useRef(0);
  const monthlyReportResetTimerRef = useRef<number | null>(null);
  const analysisPanelRef = useRef<HTMLDivElement>(null);
  const moreDetailButtonRef = useRef<HTMLButtonElement>(null);

  const handleDateFromChange = (value: string) => {
    setDateFrom(value);
    const nextDateTo = value > dateTo ? value : dateTo;
    if (value > dateTo) {
      setDateTo(value);
    }
    if (activeTab === 'treatment-analysis') void loadTreatmentAnalysis(value, nextDateTo);
  };

  const handleDateToChange = (value: string) => {
    setDateTo(value);
    const nextDateFrom = value < dateFrom ? value : dateFrom;
    if (value < dateFrom) {
      setDateFrom(value);
    }
    if (activeTab === 'treatment-analysis') void loadTreatmentAnalysis(nextDateFrom, value);
  };

  const loadTreatmentAnalysis = async (from: string, to: string) => {
    const requestId = ++analysisRequestRef.current;
    setAnalysisLoading(true);
    setAnalysisError('');
    setAnalysisRecords([]);

    try {
      const records = await onLoadTreatmentAnalysis(from, to);
      if (requestId === analysisRequestRef.current) setAnalysisRecords(records);
    } catch (error) {
      if (requestId === analysisRequestRef.current) {
        setAnalysisError(error instanceof Error ? error.message : 'Treatment analysis could not be loaded.');
      }
    } finally {
      if (requestId === analysisRequestRef.current) setAnalysisLoading(false);
    }
  };

  const openTreatmentAnalysis = () => {
    setActiveTab('treatment-analysis');
    void loadTreatmentAnalysis(dateFrom, dateTo);
    requestAnimationFrame(() => analysisPanelRef.current?.focus());
  };

  const closeTreatmentAnalysis = () => {
    analysisRequestRef.current += 1;
    setActiveTab('overview');
    requestAnimationFrame(() => {
      moreDetailButtonRef.current?.focus();
      moreDetailButtonRef.current?.scrollIntoView({ block: 'center' });
    });
  };

  const handleMonthlyReportExport = async (format: 'pdf' | 'excel') => {
    if (exportingMonthlyReport) return;
    if (monthlyReportResetTimerRef.current !== null) {
      window.clearTimeout(monthlyReportResetTimerRef.current);
      monthlyReportResetTimerRef.current = null;
    }
    const requestId = ++monthlyReportRequestRef.current;
    setExportingMonthlyReport(true);
    setMonthlyReportProgress({ percent: 2, label: 'Starting report…' });
    try {
      const report = await onLoadMonthlyReport(dateFrom, dateTo, progress => {
        if (requestId !== monthlyReportRequestRef.current) return;
        setMonthlyReportProgress(current => progress.percent >= current.percent ? progress : current);
      });
      if (requestId !== monthlyReportRequestRef.current) return;
      const metadata = { dateFrom, dateTo, locationName: selectedLocationName, currency };
      setMonthlyReportProgress({ percent: 94, label: `Creating ${format === 'pdf' ? 'PDF' : 'Excel workbook'}…` });
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const exports = await import('../utils/monthlyReportExport');
      if (format === 'pdf') exports.exportMonthlyReportToPDF(report, metadata);
      else await exports.exportMonthlyReportToExcel(report, metadata);
      setMonthlyReportProgress({ percent: 100, label: 'Download ready' });
    } catch (error) {
      if (requestId !== monthlyReportRequestRef.current) return;
      console.error('Monthly report export failed:', error);
      alert(error instanceof Error ? error.message : 'Monthly report could not be generated. Please try again.');
    } finally {
      if (requestId === monthlyReportRequestRef.current) {
        setExportingMonthlyReport(false);
        monthlyReportResetTimerRef.current = window.setTimeout(() => {
          if (requestId === monthlyReportRequestRef.current) {
            setMonthlyReportProgress({ percent: 0, label: '' });
          }
          monthlyReportResetTimerRef.current = null;
        }, 1800);
      }
    }
  };

  useEffect(() => () => {
    analysisRequestRef.current += 1;
    monthlyReportRequestRef.current += 1;
    if (monthlyReportResetTimerRef.current !== null) window.clearTimeout(monthlyReportResetTimerRef.current);
  }, []);

  const isWithinRange = (dateStr?: string) => {
    if (!dateStr) return false;
    return dateStr >= dateFrom && dateStr <= dateTo;
  };

  const rangeDates = useMemo(() => {
    const start = new Date(dateFrom);
    const end = new Date(dateTo);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
    const dates: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      dates.push(cursor.toISOString().split('T')[0]);
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }, [dateFrom, dateTo]);

  const rangeMonths = useMemo(() => {
    const start = new Date(dateFrom);
    const end = new Date(dateTo);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
    const months: { key: string; label: string }[] = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const endCursor = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cursor <= endCursor) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      const label = `${cursor.toLocaleString('default', { month: 'short' })} ${cursor.getFullYear()}`;
      months.push({ key, label });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }, [dateFrom, dateTo]);

  const chartDates = useMemo(() => {
    if (rangeDates.length <= 31) return rangeDates;
    return rangeDates.slice(-31);
  }, [rangeDates]);

  const filteredTreatmentRecords = useMemo(
    () => treatmentRecords.filter(record => isWithinRange(record.date)),
    [treatmentRecords, dateFrom, dateTo]
  );

  const filteredExpenses = useMemo(
    () => expenses.filter(expense => isWithinRange(expense.date)),
    [expenses, dateFrom, dateTo]
  );

  const filteredAppointments = useMemo(
    () => appointments.filter(appointment => isWithinRange(appointment.date)),
    [appointments, dateFrom, dateTo]
  );

  const filteredPaymentRecords = useMemo(
    () => paymentRecords.filter(record => isWithinRange(record.date)),
    [paymentRecords, dateFrom, dateTo]
  );

  const recallsCancelsLists = useMemo(() => buildRecallsCancelsLists(appointments, todayKey), [appointments, todayKey]);
  const recallsCancelsTotal = recallsCancelsLists.recalls.length + recallsCancelsLists.late.length + recallsCancelsLists.cancelled.length + recallsCancelsLists.noShow.length + recallsCancelsLists.rescheduled.length + recallsCancelsLists.completedLater.length;

  const handleRecallsCancelsExport = async (format: 'pdf' | 'excel') => {
    if (exportingRecallsCancels || recallsCancelsTotal === 0) return;
    setExportingRecallsCancels(true);
    try {
      if (format === 'pdf') {
        const { exportRecallsCancelsToPDF } = await import('../utils/pdfExport');
        exportRecallsCancelsToPDF(appointments, todayKey, selectedLocationName);
      } else {
        const { exportRecallsCancelsToExcel } = await import('../utils/excelExport');
        await exportRecallsCancelsToExcel(appointments, todayKey, selectedLocationName);
      }
    } catch (error) {
      console.error(`Failed to export Recalls & Cancels as ${format}:`, error);
      window.alert('The report could not be downloaded. Please try again.');
    } finally {
      setExportingRecallsCancels(false);
    }
  };

  const formatAppointmentDate = (dateStr?: string) => {
    if (!dateStr) return 'No date';
    const date = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' });
  };

  const getRelativeDayLabel = (dateStr?: string) => {
    if (!dateStr) return 'Unscheduled';
    const date = new Date(`${dateStr}T00:00:00`);
    const today = new Date(`${todayKey}T00:00:00`);
    if (Number.isNaN(date.getTime()) || Number.isNaN(today.getTime())) return dateStr;
    const diffDays = Math.round((date.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays > 1) return `In ${diffDays} days`;
    if (diffDays === -1) return '1 day late';
    return `${Math.abs(diffDays)} days late`;
  };

  const triageToneClasses = {
    recall: {
      shell: 'border-emerald-100 bg-white',
      accent: 'bg-emerald-500',
      badge: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
      icon: 'bg-emerald-50 text-emerald-700',
      count: 'text-emerald-700',
      row: 'hover:bg-emerald-50/50'
    },
    late: {
      shell: 'border-amber-100 bg-white',
      accent: 'bg-amber-500',
      badge: 'bg-amber-50 text-amber-800 ring-amber-100',
      icon: 'bg-amber-50 text-amber-700',
      count: 'text-amber-700',
      row: 'hover:bg-amber-50/50'
    },
    cancelled: {
      shell: 'border-rose-100 bg-white',
      accent: 'bg-rose-500',
      badge: 'bg-rose-50 text-rose-700 ring-rose-100',
      icon: 'bg-rose-50 text-rose-700',
      count: 'text-rose-700',
      row: 'hover:bg-rose-50/50'
    }
  } as const;

  const renderTriagePanel = ({
    title,
    description,
    rows,
    emptyMessage,
    tone,
    icon
  }: {
    title: string;
    description: string;
    rows: Appointment[];
    emptyMessage: string;
    tone: keyof typeof triageToneClasses;
    icon: React.ReactNode;
  }) => {
    const classes = triageToneClasses[tone];

    return (
      <section className={`overflow-hidden rounded-2xl border shadow-sm ${classes.shell}`}>
        <div className={`h-1.5 ${classes.accent}`} />
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl ${classes.icon}`}>
              {icon}
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900">{title}</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
            </div>
          </div>
          <div className="text-right">
            <p className={`font-mono text-3xl font-black leading-none tabular-nums ${classes.count}`}>{rows.length}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">total</p>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-slate-400">{emptyMessage}</p>
          </div>
        ) : (
          <div className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto [scrollbar-width:thin]">
            {rows.map((appointment) => {
              const patientName = appointmentPatientName(appointment);
              const relativeLabel = getRelativeDayLabel(appointment.date);
              const patient = tone === 'cancelled' && appointment.patient_id
                ? patients.find(candidate => candidate.id === appointment.patient_id)
                : undefined;
              const rowContent = (
                <>
                  <div className="min-w-0 text-left">
                    <h4 className="truncate text-sm font-semibold text-slate-900">{patientName}</h4>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-slate-500">
                      <span className={`rounded-full px-2 py-0.5 ring-1 ${classes.badge}`}>{appointment.patient_id ? 'Patient' : 'Lead'}</span>
                      <span>{appointment.type || 'No type'}</span>
                      {patient && <span className="font-bold text-indigo-600">Open chart</span>}
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-right">
                    <div>
                      <p className="text-xs font-bold text-slate-700">{formatAppointmentDate(appointment.date)}</p>
                      <p className="mt-1 font-mono text-xs font-semibold text-slate-500 tabular-nums">{appointment.time || '--:--'}</p>
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{relativeLabel}</p>
                    </div>
                    {patient && <ArrowUpRight className="mt-0.5 h-4 w-4 flex-none text-indigo-500" aria-hidden="true" />}
                  </div>
                </>
              );

              return patient ? (
                <button
                  key={appointment.id}
                  type="button"
                  onClick={() => onSelectPatient(patient)}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 px-5 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${classes.row}`}
                  aria-label={`Open clinical chart for ${patientName}`}
                >
                  {rowContent}
                </button>
              ) : (
                <article
                  key={appointment.id}
                  className={`grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-5 py-3 transition-colors ${classes.row}`}
                >
                  {rowContent}
                </article>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  const appointmentDateTimeKey = (appointment: Appointment) => {
    const time = String(appointment.time || '00:00').slice(0, 5).padEnd(5, '0');
    return `${appointment.date}T${time}`;
  };

  const completedLaterCandidates = (appointment: Appointment) => appointments
    .filter((candidate) => {
      if (!appointment.patient_id || candidate.patient_id !== appointment.patient_id || candidate.status !== 'Completed') return false;
      return appointmentDateTimeKey(candidate) > appointmentDateTimeKey(appointment);
    })
    .sort((a, b) => appointmentDateTimeKey(a).localeCompare(appointmentDateTimeKey(b)));

  const saveCancellationOutcome = async (
    appointment: Appointment,
    outcome: CancellationOutcome | null,
    completedLaterAppointmentId?: string | null
  ) => {
    setSavingCancellationId(appointment.id);
    try {
      await onUpdateCancellationOutcome(appointment.id, outcome, completedLaterAppointmentId);
      setCompletedLaterPickerId(null);
    } catch (error: any) {
      console.error('Unable to save cancellation follow-up outcome:', error);
      window.alert(error?.message || 'The cancellation follow-up outcome could not be saved.');
    } finally {
      setSavingCancellationId(null);
    }
  };

  const cancellationPanels = {
    pending: {
      title: 'Needs Follow-up',
      description: 'Cancelled visits that still need an outcome.',
      rows: recallsCancelsLists.cancelled,
      emptyMessage: 'No cancelled appointments need follow-up.',
      tone: 'cancelled' as const
    },
    'no-show': {
      title: 'No Show',
      description: 'Cancelled visits confirmed as no-shows.',
      rows: recallsCancelsLists.noShow,
      emptyMessage: 'No no-show outcomes recorded.',
      tone: 'late' as const
    },
    rescheduled: {
      title: 'Rescheduled',
      description: 'Cancelled visits that have been rescheduled.',
      rows: recallsCancelsLists.rescheduled,
      emptyMessage: 'No rescheduled outcomes recorded.',
      tone: 'recall' as const
    },
    'completed-later': {
      title: 'Completed Later',
      description: 'Cancelled visits linked to a later completed appointment.',
      rows: recallsCancelsLists.completedLater,
      emptyMessage: 'No completed-later outcomes recorded.',
      tone: 'recall' as const
    }
  };

  const renderCancellationPanel = () => {
    const panel = cancellationPanels[cancellationTab];
    const classes = triageToneClasses[panel.tone];

    return (
      <section className={`overflow-hidden rounded-2xl border shadow-sm ${classes.shell}`}>
        <div className={`h-1.5 ${classes.accent}`} />
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl ${classes.icon}`}>
              <XCircle className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-base font-bold text-slate-900">{panel.title}</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">{panel.description}</p>
            </div>
          </div>
          <p className={`font-mono text-3xl font-black leading-none tabular-nums ${classes.count}`}>{panel.rows.length}</p>
        </div>

        {panel.rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm font-medium text-slate-400">{panel.emptyMessage}</div>
        ) : (
          <div className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto [scrollbar-width:thin]">
            {panel.rows.map((appointment) => {
              const patient = appointment.patient_id ? patients.find((candidate) => candidate.id === appointment.patient_id) : undefined;
              const candidates = completedLaterCandidates(appointment);
              const isSaving = savingCancellationId === appointment.id;
              const isPickerOpen = completedLaterPickerId === appointment.id;
              return (
                <article key={appointment.id} className={`px-5 py-4 ${classes.row}`}>
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="truncate text-sm font-semibold text-slate-900">{appointmentPatientName(appointment)}</h4>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${classes.badge}`}>{appointment.patient_id ? 'Patient' : 'Lead'}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{appointment.type || 'No type'} · {formatAppointmentDate(appointment.date)} · {appointment.time || '--:--'}</p>
                      {cancellationTab === 'completed-later' && appointment.completed_later_appointment_id ? (
                        <p className="mt-1 text-xs font-medium text-emerald-700">
                          Completed visit: {appointments.find((candidate) => candidate.id === appointment.completed_later_appointment_id)?.date || 'Linked appointment'}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {patient ? (
                        <button type="button" onClick={() => onSelectPatient(patient)} className="rounded-lg border border-indigo-200 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">Open chart</button>
                      ) : null}
                      {cancellationTab === 'pending' ? (
                        <select
                          value=""
                          disabled={isSaving}
                          onChange={(event) => {
                            const outcome = event.target.value as CancellationOutcome | '';
                            if (!outcome) return;
                            if (outcome === 'COMPLETED_LATER') {
                              setCompletedLaterPickerId(appointment.id);
                              return;
                            }
                            void saveCancellationOutcome(appointment, outcome);
                          }}
                          className="rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-60"
                          aria-label={`Set cancellation outcome for ${appointmentPatientName(appointment)}`}
                        >
                          <option value="">{isSaving ? 'Saving…' : 'Set outcome'}</option>
                          <option value="NO_SHOW">No Show</option>
                          <option value="RESCHEDULED">Rescheduled</option>
                          {appointment.patient_id ? <option value="COMPLETED_LATER">Completed on Later Date</option> : null}
                        </select>
                      ) : (
                        <button type="button" disabled={isSaving} onClick={() => void saveCancellationOutcome(appointment, null)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">Clear outcome</button>
                      )}
                    </div>
                  </div>
                  {isPickerOpen ? (
                    <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
                      <label className="block text-xs font-semibold text-indigo-900">Completed appointment on a later date</label>
                      {candidates.length === 0 ? (
                        <p className="mt-1 text-xs text-indigo-700">No later completed appointments are available for this patient.</p>
                      ) : (
                        <select
                          defaultValue=""
                          disabled={isSaving}
                          onChange={(event) => {
                            if (event.target.value) void saveCancellationOutcome(appointment, 'COMPLETED_LATER', event.target.value);
                          }}
                          className="mt-2 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="">Choose completed appointment…</option>
                          {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{formatAppointmentDate(candidate.date)} · {candidate.time || '--:--'} · {candidate.type || 'No type'}</option>)}
                        </select>
                      )}
                      <button type="button" disabled={isSaving} onClick={() => setCompletedLaterPickerId(null)} className="mt-2 text-xs font-semibold text-indigo-700 hover:text-indigo-900">Cancel</button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  const rangeSummary = useMemo(() => calculateDashboardRangeSummary({
    filteredTreatmentRecords,
    filteredPaymentRecords,
    filteredExpenses,
    filteredAppointments,
    patients,
    dateFrom,
    dateTo,
    rangeDates
  }), [filteredTreatmentRecords, filteredPaymentRecords, filteredExpenses, filteredAppointments, patients, dateFrom, dateTo, rangeDates]);

  const rangeCollectedPayments = rangeSummary.collectedPayments;
  const rangeRevenue = rangeSummary.revenue;
  const rangeExpenses = rangeSummary.expenses;
  const rangeProfit = rangeSummary.profit;
  const rangeAppointments = rangeSummary.appointments;
  const rangeNewPatients = rangeSummary.newPatients;
  const rangeDayCount = rangeSummary.dayCount;
  const avgDailyRevenue = rangeSummary.avgDailyRevenue;
  const patientBalanceStatuses = useMemo(() => [...patients]
    .map((patient) => ({
      patient,
      balance: Math.max(0, Number(patient.balance ?? 0)),
      hasOutstandingBalance: Number(patient.balance ?? 0) > 0
    }))
    .sort((a, b) => Number(b.hasOutstandingBalance) - Number(a.hasOutstandingBalance) || b.balance - a.balance || a.patient.name.localeCompare(b.patient.name)), [patients]);
  const patientsWithOutstandingBalances = patientBalanceStatuses.filter(({ hasOutstandingBalance }) => hasOutstandingBalance);

  const formatDateLabel = (dateStr: string) => new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const dailyFinancialData = useMemo(() => {
    return buildDailyFinancialData({
      chartDates,
      filteredTreatmentRecords,
      filteredPaymentRecords,
      filteredExpenses,
      formatDateLabel
    });
  }, [chartDates, filteredTreatmentRecords, filteredPaymentRecords, filteredExpenses]);

  const dailyAppointmentData = useMemo(() => {
    return buildDailyAppointmentData({
      chartDates,
      filteredTreatmentRecords,
      filteredPaymentRecords,
      filteredAppointments,
      formatDateLabel
    });
  }, [chartDates, filteredTreatmentRecords, filteredPaymentRecords, filteredAppointments]);

  // Patient Revenue Performance (top 10 patients by total revenue in range)
  const patientRevenueData = useMemo(() => {
    const patientMap = new Map<string, { name: string; revenue: number }>();
    
    filteredTreatmentRecords.forEach(record => {
      const patientId = record.patient_id;
      const patientName = record.patient_name || 'Unknown';
      
      if (!patientMap.has(patientId)) {
        patientMap.set(patientId, { name: patientName, revenue: 0 });
      }
      
      const patient = patientMap.get(patientId)!;
      patient.revenue += record.cost || 0;
    });
    
    return Array.from(patientMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
      .map((patient) => ({
        name: patient.name.length > 15 ? patient.name.substring(0, 15) + '...' : patient.name,
        revenue: patient.revenue
      }));
  }, [filteredTreatmentRecords]);

  // Appointment Status Distribution (range)
  const appointmentStatusData = useMemo(() => {
    const statusCounts: Record<string, number> = { Scheduled: 0, Completed: 0, Cancelled: 0 };

    filteredAppointments.forEach(apt => {
      statusCounts[apt.status] = (statusCounts[apt.status] || 0) + 1;
    });

    return Object.entries(statusCounts)
      .filter(([, value]) => value > 0)
      .map(([name, value]) => ({ name, value }));
  }, [filteredAppointments]);

  const appointmentStatusColors: Record<string, string> = {
    Scheduled: '#4F46E5',
    Completed: '#10B981',
    Cancelled: '#EF4444'
  };

  // Keep the overview and detailed page on one aggregation path so their counts cannot drift.
  const treatmentAnalysis = useMemo(
    () => buildTreatmentAnalysis(filteredTreatmentRecords, { combineAcrossLocations: selectedLocationId === allBranchesValue }),
    [allBranchesValue, filteredTreatmentRecords, selectedLocationId]
  );
  const treatmentMixData = useMemo(() => treatmentAnalysis.rows.slice(0, 8).map((row) => ({
    name: row.name.length > 18 ? `${row.name.substring(0, 18)}...` : row.name,
    count: row.count
  })), [treatmentAnalysis.rows]);

  const expenseCategoryData = useMemo(() => {
    const totals = new Map<string, number>();
    filteredExpenses.forEach(expense => {
      const key = expense.category?.trim() || 'Uncategorized';
      totals.set(key, (totals.get(key) || 0) + (expense.amount || 0));
    });

    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));
  }, [filteredExpenses]);

  const expenseCategoryColors = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#14B8A6', '#8B5CF6', '#0EA5E9', '#F97316'];
  const paymentMethodColors = ['#7C3AED', '#2563EB', '#059669', '#D97706', '#DB2777', '#0891B2', '#4F46E5', '#DC2626', '#64748B'];

  const paymentMethodData = useMemo(() => {
    const totals = new Map<string, { value: number; count: number }>();
    filteredPaymentRecords.forEach((payment) => {
      const allocations = payment.allocations?.length
        ? payment.allocations
        : [{ method: payment.paymentMethod || 'UNKNOWN' as const, amount: payment.amount }];
      allocations.forEach((allocation) => {
        const name = formatPaymentMethod(allocation.method);
        const current = totals.get(name) || { value: 0, count: 0 };
        current.value += Number(allocation.amount || 0);
        current.count += 1; // Tender-use count; parent payment count remains filteredPaymentRecords.length.
        totals.set(name, current);
      });
    });

    return Array.from(totals.entries())
      .map(([name, totalsForMethod]) => ({ name, ...totalsForMethod }))
      .sort((a, b) => b.value - a.value);
  }, [filteredPaymentRecords]);

  const recentPayments = useMemo(
    () => [...filteredPaymentRecords]
      .sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date))
      .slice(0, 10),
    [filteredPaymentRecords]
  );

  const topExpenses = useMemo(() => {
    return [...filteredExpenses]
      .sort((a, b) => (b.amount || 0) - (a.amount || 0))
      .slice(0, 8);
  }, [filteredExpenses]);

  const topPatientsByRevenue = useMemo(() => {
    const map = new Map<string, { name: string; revenue: number }>();
    filteredTreatmentRecords.forEach(record => {
      const name = record.patient_name || 'Unknown';
      const current = map.get(record.patient_id) || { name, revenue: 0 };
      current.revenue += record.cost || 0;
      map.set(record.patient_id, current);
    });
    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);
  }, [filteredTreatmentRecords]);

  const doctorEarningsData = useMemo(() => {
    const map = new Map<string, { name: string; earnings: number; treatmentIds: Set<string> }>();
    treatmentRecords.forEach(record => {
      (record.doctorEarningEntries || [])
        .filter((entry) => isWithinRange(entry.paymentDate))
        .forEach((entry) => {
          const doctorId = entry.doctorId || record.doctor_id || record.doctor_name || 'unknown';
          const current = map.get(doctorId) || {
            name: record.doctor_name || 'Unknown',
            earnings: 0,
            treatmentIds: new Set<string>()
          };
          current.earnings += Number(entry.earnings || 0);
          current.treatmentIds.add(record.id);
          map.set(doctorId, current);
        });
    });
    return Array.from(map.values())
      .map((doctor) => ({
        name: doctor.name,
        earnings: doctor.earnings,
        treatments: doctor.treatmentIds.size
      }))
      .sort((a, b) => b.earnings - a.earnings);
  }, [treatmentRecords, dateFrom, dateTo]);

  const doctorCommissionBreakdown = useMemo(() => treatmentRecords
    .map((record) => {
      const entries = (record.doctorEarningEntries || []).filter((entry) => isWithinRange(entry.paymentDate));
      return {
        record,
        paymentDate: entries.reduce((latest, entry) => entry.paymentDate > latest ? entry.paymentDate : latest, ''),
        earnings: entries.reduce((sum, entry) => sum + Number(entry.earnings || 0), 0)
      };
    })
    .filter((row) => row.earnings > 0)
    .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate))
    .slice(0, 50), [treatmentRecords, dateFrom, dateTo]);


  const topAppointmentCreators = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();

    filteredAppointments.forEach(appointment => {
      const key = appointment.created_by_user_id || appointment.created_by_user_name || 'unknown';
      const name = appointment.created_by_user_name || 'Unknown';
      const current = map.get(key) || { name, count: 0 };
      current.count += 1;
      map.set(key, current);
    });

    return Array.from(map.values())
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 8);
  }, [filteredAppointments]);

  // New Patients by Month (range)
  const newPatientsMonthlyData = useMemo(() => {
    return rangeMonths.map(month => {
      const monthStart = `${month.key}-01`;
      const monthEnd = `${month.key}-31`;
      const boundedFrom = dateFrom > monthStart ? dateFrom : monthStart;
      const boundedTo = dateTo < monthEnd ? dateTo : monthEnd;
      const count = countPatientsCreatedInRange(patients, boundedFrom, boundedTo);
      return { name: month.label, count };
    });
  }, [patients, rangeMonths, dateFrom, dateTo]);

  const monthlyProfitData = useMemo(() => {
    return buildMonthlyProfitData({
      rangeMonths,
      filteredTreatmentRecords,
      filteredExpenses
    });
  }, [filteredTreatmentRecords, filteredExpenses, rangeMonths]);

  const serviceMonitorData = useMemo(() => {
    const monitoredServices = ['X-ray (OBU)', 'X-ray (CBTC)', 'X Ray (Lateral)', 'X-ray (PA)'];

    return monitoredServices.map((service) => {
      const serviceRecords = filteredTreatmentRecords.filter((record) => (record.description || '').trim() === service);
      const count = serviceRecords.length;
      const revenue = serviceRecords.reduce((sum, record) => sum + (record.cost || 0), 0);
      return {
        name: service,
        patients: count,
        revenue
      };
    });
  }, [filteredTreatmentRecords]);

  const serviceMonitorHasData = useMemo(
    () => serviceMonitorData.some((item) => item.patients > 0),
    [serviceMonitorData]
  );

  const totalXrayPatients = useMemo(
    () => {
      const monitoredServices = new Set(['X-ray (OBU)', 'X-ray (CBTC)', 'X Ray (Lateral)', 'X-ray (PA)']);
      const uniquePatientIds = new Set<string>();

      filteredTreatmentRecords.forEach((record) => {
        const serviceName = (record.description || '').trim();
        if (!monitoredServices.has(serviceName)) return;
        if (record.patient_id) {
          uniquePatientIds.add(record.patient_id);
        }
      });

      return uniquePatientIds.size;
    },
    [filteredTreatmentRecords]
  );

  const totalXrayRevenue = useMemo(
    () => serviceMonitorData.reduce((sum, item) => sum + item.revenue, 0),
    [serviceMonitorData]
  );

  const topXrayService = useMemo(() => {
    const ranked = [...serviceMonitorData].sort((a, b) => b.patients - a.patients);
    return ranked[0];
  }, [serviceMonitorData]);

  const xrayXAxisMax = useMemo(() => {
    const currentMax = Math.max(...serviceMonitorData.map((item) => item.patients), 0);
    return Math.max(currentMax, 2);
  }, [serviceMonitorData]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-gray-400 mb-2">Overview</p>
            <h2 className="text-2xl font-bold text-gray-900">Performance Snapshot</h2>
            <p className="text-sm text-gray-500 mt-1">
              Showing results for <span className="font-semibold text-gray-700">{selectedLocationName}</span>.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full lg:w-auto">
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-2">
                Date From
              </label>
              <input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(e) => handleDateFromChange(e.target.value)}
                className="w-full bg-white text-gray-800 text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-2">
                Date To
              </label>
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                onChange={(e) => handleDateToChange(e.target.value)}
                className="w-full bg-white text-gray-800 text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-2">
                <span className="inline-flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5" />
                  Report Scope
                </span>
              </label>
              {canViewAllBranches ? (
                <select
                  value={selectedLocationId}
                  onChange={(e) => {
                    setActiveTab('overview');
                    analysisRequestRef.current += 1;
                    void onLocationChange(e.target.value);
                  }}
                  disabled={loading}
                  className="w-full bg-white text-gray-800 text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value={allBranchesValue}>All Branches</option>
                  {locations.map(location => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-700">
                  {selectedLocationName}
                </div>
              )}
              {loading && <p className="mt-2 text-xs text-[var(--hover-600)]">Refreshing dashboard data...</p>}
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-2">
                Report Export
              </label>
              <ExportMenu
                disabled={loading || exportingMonthlyReport}
                label={exportingMonthlyReport ? 'Preparing report…' : 'Professional Reporting'}
                buttonLabelClassName="inline font-semibold tracking-tight"
                className="!min-h-11 !w-full !rounded-xl !bg-gradient-to-r !from-indigo-600 !to-violet-600 !px-4 !py-2.5 !font-semibold shadow-md shadow-indigo-600/20 !transition-all !duration-200 hover:!from-indigo-700 hover:!to-violet-700 hover:shadow-lg hover:shadow-indigo-600/25 active:scale-[0.98] focus:!outline-none focus:!ring-2 focus:!ring-indigo-500 focus:!ring-offset-2 disabled:active:scale-100 disabled:!shadow-none"
                onExportPDF={() => void handleMonthlyReportExport('pdf')}
                onExportExcel={() => void handleMonthlyReportExport('excel')}
              />
              <p className="mt-2 text-[11px] text-gray-400">Uses the selected dates and scope.</p>
              {monthlyReportProgress.percent > 0 && (
                <div className="mt-3" aria-live="polite">
                  <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-semibold text-indigo-700">
                    <span className="truncate">{monthlyReportProgress.label}</span>
                    <span className="tabular-nums">{monthlyReportProgress.percent}%</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="Monthly report preparation progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={monthlyReportProgress.percent}
                    className="h-2 overflow-hidden rounded-full bg-indigo-100"
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-emerald-500 transition-[width] duration-300 ease-out"
                      style={{ width: `${monthlyReportProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-gray-100 bg-white p-2 shadow-sm">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'recalls-cancels', label: 'Recalls & Cancels' },
          ...(activeTab === 'treatment-analysis' ? [{ id: 'treatment-analysis', label: 'Treatment Analysis' }] : [])
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as 'overview' | 'recalls-cancels' | 'treatment-analysis')}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${activeTab === tab.id ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'treatment-analysis' ? (
        <div ref={analysisPanelRef} tabIndex={-1} className="focus:outline-none">
          <TreatmentAnalysisView
            records={analysisRecords}
            currency={currency}
            dateFrom={dateFrom}
            dateTo={dateTo}
            locationName={selectedLocationName}
            loading={analysisLoading}
            error={analysisError}
            combineAcrossLocations={selectedLocationId === allBranchesValue}
            onRetry={() => void loadTreatmentAnalysis(dateFrom, dateTo)}
            onBack={closeTreatmentAnalysis}
          />
        </div>
      ) : activeTab === 'recalls-cancels' ? (
        <div className="space-y-5">
          <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Recalls & Cancels</h3>
              <p className="mt-1 text-sm text-slate-500">
                Follow-up appointments for {selectedLocationName}, grouped by status for quick review.
              </p>
            </div>
            <ExportMenu
              disabled={loading || exportingRecallsCancels || recallsCancelsTotal === 0}
              onExportPDF={() => void handleRecallsCancelsExport('pdf')}
              onExportExcel={() => void handleRecallsCancelsExport('excel')}
              className="h-11 w-full sm:w-auto"
              buttonLabelClassName="inline"
            />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {renderTriagePanel({
              title: 'Upcoming Recalls',
              description: 'Scheduled patient follow-ups.',
              rows: recallsCancelsLists.recalls,
              emptyMessage: 'No upcoming recalls.',
              tone: 'recall',
              icon: <Clock className="h-4 w-4" />
            })}

            {renderTriagePanel({
              title: 'Late / No-show',
              description: 'Past scheduled visits to review.',
              rows: recallsCancelsLists.late,
              emptyMessage: 'No late or no-show appointments.',
              tone: 'late',
              icon: <AlertTriangle className="h-4 w-4" />
            })}

            <div className="xl:col-span-2">
              <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Cancelled appointment follow-up outcomes">
                {[
                  { id: 'pending', label: 'Needs Follow-up', count: recallsCancelsLists.cancelled.length },
                  { id: 'no-show', label: 'No Show', count: recallsCancelsLists.noShow.length },
                  { id: 'rescheduled', label: 'Rescheduled', count: recallsCancelsLists.rescheduled.length },
                  { id: 'completed-later', label: 'Completed Later', count: recallsCancelsLists.completedLater.length }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={cancellationTab === tab.id}
                    onClick={() => setCancellationTab(tab.id as typeof cancellationTab)}
                    className={`rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${cancellationTab === tab.id ? 'border-rose-500 bg-rose-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:bg-rose-50'}`}
                  >
                    {tab.label} <span className="ml-1 opacity-80">{tab.count}</span>
                  </button>
                ))}
              </div>
              {renderCancellationPanel()}
            </div>
          </div>
        </div>
      ) : (
        <>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-800">Collections by Payment Type</h3>
          <p className="mb-4 mt-1 text-xs text-gray-500">
            {formatCurrency(rangeCollectedPayments, currency)} collected across {filteredPaymentRecords.length} payments
          </p>
          <div className="h-[280px] min-h-[280px] w-full">
            {paymentMethodData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm italic text-gray-400">No payments in this range.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={paymentMethodData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={3}>
                    {paymentMethodData.map((entry, index) => (
                      <Cell key={entry.name} fill={paymentMethodColors[index % paymentMethodColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number | undefined, name?: string) => [formatCurrency(value ?? 0, currency), name || 'Payment']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-800">Recent Payment Collections</h3>
          <p className="mb-4 mt-1 text-xs text-gray-500">Latest collections within the selected range</p>
          {recentPayments.length === 0 ? (
            <p className="text-sm italic text-gray-400">No payments in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 text-xs uppercase text-gray-400">
                  <tr>
                    <th className="py-2 pr-4 text-left">Date</th>
                    <th className="py-2 pr-4 text-left">Patient</th>
                    <th className="py-2 pr-4 text-left">Payment Type</th>
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recentPayments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="whitespace-nowrap py-2 pr-4 text-gray-500">{payment.date}</td>
                      <td className="py-2 pr-4 font-medium text-gray-900">{payment.patient_name || 'Unknown'}</td>
                      <td className="py-2 pr-4 font-semibold text-gray-700">{payment.allocations?.length > 1 ? payment.allocations.map((allocation) => formatPaymentMethod(allocation.method)).join(' + ') : formatPaymentMethod(payment.paymentMethod)}</td>
                      <td className="py-2 text-right font-bold text-violet-700">{formatCurrency(payment.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-7 gap-4">
        {[
          { label: 'Production Revenue', value: formatCurrency(rangeRevenue, currency), note: `${rangeDayCount} days`, icon: <DollarSign className="w-4 h-4 text-emerald-600" /> },
          { label: 'Collections', value: formatCurrency(rangeCollectedPayments, currency), note: `${filteredPaymentRecords.length} payments`, icon: <DollarSign className="w-4 h-4 text-violet-600" /> },
          { label: 'Expenses (Range)', value: formatCurrency(rangeExpenses, currency), note: 'Operating spend', icon: <TrendingDown className="w-4 h-4 text-red-600" /> },
          { label: 'Net Profit', value: formatCurrency(rangeProfit, currency), note: 'Production - expenses', icon: <Activity className="w-4 h-4 text-indigo-600" /> },
          { label: 'Avg Daily Production', value: formatCurrency(avgDailyRevenue, currency), note: 'Daily average', icon: <LineChartIcon className="w-4 h-4 text-sky-600" /> },
          { label: 'Appointments', value: rangeAppointments.toString(), note: 'In selected range', icon: <CalendarIcon className="w-4 h-4 text-amber-600" /> },
          { label: 'New Patients', value: rangeNewPatients.toString(), note: 'Created in range', icon: <Users className="w-4 h-4 text-purple-600" /> }
        ].map(item => (
          <div key={item.label} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs text-gray-500 uppercase tracking-widest">
              <span>{item.label}</span>
              {item.icon}
            </div>
            <div className="mt-3 text-lg font-bold text-gray-900">{item.value}</div>
            <div className="mt-1 text-xs text-gray-500">{item.note}</div>
          </div>
        ))}
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Production vs Expenses</h3>
            <p className="text-xs text-gray-500">Daily production, collections, and operating spend within the selected range</p>
          </div>
          <span className="inline-flex items-center gap-2 text-xs text-gray-500">
            <LineChartIcon className="w-4 h-4" />
            Trend
          </span>
        </div>
        <div className="h-[320px] w-full min-h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyFinancialData}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.25}/>
                  <stop offset="95%" stopColor="#4F46E5" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#EF4444" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#EF4444" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#6B7280', fontSize: 11}} />
              <YAxis axisLine={false} tickLine={false} tick={{fill: '#6B7280', fontSize: 11}} />
              <Tooltip
                formatter={(value: number | undefined, name?: string) => {
                  const amount = value ?? 0;
                  if (name === 'revenue') return [formatCurrency(amount, currency), 'Production'];
                  if (name === 'collections') return [formatCurrency(amount, currency), 'Collections'];
                  if (name === 'expenses') return [formatCurrency(amount, currency), 'Expenses'];
                  return [formatCurrency(amount, currency), 'Profit'];
                }}
              />
              <Legend />
              <Area type="monotone" dataKey="revenue" stroke="#4F46E5" strokeWidth={2} fill="url(#colorRevenue)" />
              <Area type="monotone" dataKey="collections" stroke="#7C3AED" strokeWidth={2} fillOpacity={0} />
              <Area type="monotone" dataKey="expenses" stroke="#EF4444" strokeWidth={2} fill="url(#colorExpenses)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800 mb-2">Largest Expenses</h3>
          <p className="text-xs text-gray-500 mb-4">Highest single expenses in the selected range</p>
          {topExpenses.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No expenses recorded in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-gray-400 border-b border-gray-100">
                  <tr>
                    <th className="text-left py-2 pr-4">Date</th>
                    <th className="text-left py-2 pr-4">Description</th>
                    <th className="text-left py-2 pr-4">Category</th>
                    <th className="text-right py-2">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {topExpenses.map(expense => (
                    <tr key={expense.id} className="text-gray-700">
                      <td className="py-2 pr-4 whitespace-nowrap">{expense.date}</td>
                      <td className="py-2 pr-4 font-medium text-gray-900">{expense.description}</td>
                      <td className="py-2 pr-4">{expense.category || 'Uncategorized'}</td>
                      <td className="py-2 text-right font-semibold text-gray-900">{formatCurrency(expense.amount || 0, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800 mb-2">Top Patients (Table)</h3>
          <p className="text-xs text-gray-500 mb-4">Revenue contribution in the selected range</p>
          {topPatientsByRevenue.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No patient revenue data in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-gray-400 border-b border-gray-100">
                  <tr>
                    <th className="text-left py-2 pr-4">Patient</th>
                    <th className="text-right py-2">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {topPatientsByRevenue.map((patient, index) => (
                    <tr key={`${patient.name}-${index}`} className="text-gray-700">
                      <td className="py-2 pr-4 font-medium text-gray-900">{patient.name}</td>
                      <td className="py-2 text-right font-semibold text-gray-900">{formatCurrency(patient.revenue, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Patient Balance Status</h3>
            <p className="text-xs text-gray-500">Current balances for all patients in {selectedLocationName}</p>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold">
            <span className="rounded-full bg-rose-50 px-3 py-1.5 text-rose-700">{patientsWithOutstandingBalances.length} with debt</span>
            <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">{patientBalanceStatuses.length - patientsWithOutstandingBalances.length} clear</span>
          </div>
        </div>
        {patientBalanceStatuses.length === 0 ? (
          <p className="text-sm italic text-gray-400">No patients in this scope.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-100">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-xs uppercase text-gray-400 border-b border-gray-100">
                <tr>
                  <th className="text-left py-2 px-3">Patient</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-right py-2 px-3">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {patientBalanceStatuses.map(({ patient, balance, hasOutstandingBalance }) => (
                  <tr key={patient.id} className="cursor-pointer text-gray-700 hover:bg-indigo-50" onClick={() => onSelectPatient(patient)}>
                    <td className="py-2.5 px-3 font-medium text-gray-900">{patient.name}</td>
                    <td className="py-2.5 px-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${hasOutstandingBalance ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {hasOutstandingBalance ? 'Outstanding debt' : 'No debt'}
                      </span>
                    </td>
                    <td className={`py-2.5 px-3 text-right font-bold ${hasOutstandingBalance ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {formatCurrency(balance, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Doctor Earnings (Commission)</h3>
            <p className="text-xs text-gray-500">Calculated commission for each doctor in the selected range</p>
          </div>
          <span className="inline-flex items-center gap-2 text-xs text-gray-500">
            <DollarSign className="w-4 h-4 text-emerald-500" />
            Commission
          </span>
        </div>
        {doctorEarningsData.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No doctor earnings data in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-gray-400 border-b border-gray-100">
                <tr>
                  <th className="text-left py-2 pr-4">Doctor</th>
                  <th className="text-right py-2 pr-4">Treatments</th>
                  <th className="text-right py-2">Commission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {doctorEarningsData.map((doctor, index) => (
                  <tr key={`${doctor.name}-${index}`} className="text-gray-700">
                    <td className="py-2 pr-4 font-medium text-gray-900">{doctor.name}</td>
                    <td className="py-2 text-right text-gray-600">{doctor.treatments}</td>
                    <td className="py-2 text-right font-semibold text-emerald-700">{formatCurrency(doctor.earnings, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Per-Treatment Commission Breakdown</h3>
            <p className="text-xs text-gray-500">Individual treatment records with doctor commission in the selected range</p>
          </div>
          <span className="inline-flex items-center gap-2 text-xs text-gray-500">
            <DollarSign className="w-4 h-4 text-emerald-500" />
            Treatment Commission
          </span>
        </div>
        {doctorCommissionBreakdown.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No treatment records with commission in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-gray-400 border-b border-gray-100">
                <tr>
                  <th className="text-left py-2 pr-4">Payment Date</th>
                  <th className="text-left py-2 pr-4">Patient</th>
                  <th className="text-left py-2 pr-4">Doctor</th>
                  <th className="text-left py-2 pr-4">Treatment</th>
                  <th className="text-right py-2 pr-4">Fee</th>
                  <th className="text-right py-2">Commission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {doctorCommissionBreakdown.map(({ record, paymentDate, earnings }, index) => (
                  <tr key={record.id || index} className="text-gray-700">
                    <td className="py-2 pr-4 whitespace-nowrap text-gray-500">{paymentDate}</td>
                    <td className="py-2 pr-4 font-medium text-gray-900">{record.patient_name || "Unknown"}</td>
                    <td className="py-2 pr-4 text-gray-700">{record.doctor_name || "-"}</td>
                    <td className="py-2 pr-4 text-gray-600">{record.description}</td>
                    <td className="py-2 pr-4 text-right font-medium text-gray-900">{formatCurrency(record.cost || 0, currency)}</td>
                    <td className="py-2 text-right font-semibold text-emerald-700">{formatCurrency(earnings, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Appointment Makers</h3>
            <p className="text-xs text-gray-500">Users who created the most appointments in the selected range</p>
          </div>
          <span className="inline-flex items-center gap-2 text-xs text-gray-500">
            <Trophy className="w-4 h-4 text-amber-500" />
            Marketing performance
          </span>
        </div>
        {topAppointmentCreators.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No appointment creator data in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-gray-400 border-b border-gray-100">
                <tr>
                  <th className="text-left py-2 pr-4">Rank</th>
                  <th className="text-left py-2 pr-4">User</th>
                  <th className="text-right py-2">Appointments Made</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {topAppointmentCreators.map((creator, index) => (
                  <tr key={`${creator.name}-${index}`} className="text-gray-700">
                    <td className="py-2 pr-4 font-semibold text-gray-500">#{index + 1}</td>
                    <td className="py-2 pr-4 font-medium text-gray-900">{creator.name}</td>
                    <td className="py-2 text-right font-semibold text-gray-900">{creator.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800 mb-2">Appointments vs Production</h3>
          <p className="text-xs text-gray-500 mb-4">Daily appointment count compared to production revenue</p>
          <div className="h-[300px] w-full min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyAppointmentData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{fill: '#6B7280', fontSize: 10}}
                  angle={-30}
                  textAnchor="end"
                  height={70}
                />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#6B7280', fontSize: 12}} />
                <Tooltip
                  formatter={(value: number | undefined, name?: string) => {
                    const amount = value ?? 0;
                    if (name === 'revenue') return [formatCurrency(amount, currency), 'Production'];
                    return [amount, 'Appointments'];
                  }}
                />
                <Legend />
                <Bar dataKey="revenue" fill="#4F46E5" radius={[8, 8, 0, 0]} />
                <Bar dataKey="appointments" fill="#10B981" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800 mb-2">Top Patients by Revenue</h3>
          <p className="text-xs text-gray-500 mb-4">Highest contributors in the selected range</p>
          <div className="h-[300px] w-full min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={patientRevenueData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{fill: '#6B7280', fontSize: 12}} />
                <YAxis 
                  type="category" 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fill: '#6B7280', fontSize: 10}} 
                  width={120}
                />
                <Tooltip 
                  formatter={(value: number | undefined) => [formatCurrency(value ?? 0, currency), 'Revenue']}
                />
                <Bar dataKey="revenue" fill="#10B981" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-800">Appointment Status</h3>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500">
              <PieIcon className="w-3 h-3" /> Distribution
            </span>
          </div>
          <div className="h-[260px] w-full min-h-[260px] flex items-center justify-center">
            {appointmentStatusData.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No appointments in this range.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={appointmentStatusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={4}
                  >
                    {appointmentStatusData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={appointmentStatusColors[entry.name] || '#4B5563'}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number | undefined, name?: string) => [`${value ?? 0} appointments`, name || 'Appointments']}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800 mb-2">Treatment Mix (Range)</h3>
          <p className="text-xs text-gray-500 mb-4">Top procedures by frequency in the selected range</p>
          <div className="h-[260px] w-full min-h-[260px]">
            {treatmentMixData.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No treatment activity recorded in the selected range.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={treatmentMixData} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#6B7280', fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(value: number | undefined) => [`${value ?? 0} procedures`, 'Count']}
                  />
                  <Bar dataKey="count" fill="#6366F1" radius={[0, 8, 8, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-4 border-t border-gray-100 pt-4">
            <button
              ref={moreDetailButtonRef}
              type="button"
              onClick={openTreatmentAnalysis}
              className="group inline-flex items-center gap-1.5 text-sm font-bold text-indigo-600 transition-colors hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              aria-label="Open detailed treatment analysis"
            >
              More Detail
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800 mb-2">Expense Breakdown</h3>
          <p className="text-xs text-gray-500 mb-4">Category distribution in the selected range</p>
          <div className="h-[260px] w-full min-h-[260px] flex items-center justify-center">
            {expenseCategoryData.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No expense data available.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={expenseCategoryData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={95}
                    paddingAngle={3}
                  >
                    {expenseCategoryData.map((entry, index) => (
                      <Cell key={`expense-cell-${index}`} fill={expenseCategoryColors[index % expenseCategoryColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number | undefined, name?: string) => [formatCurrency(value ?? 0, currency), name || 'Expense']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800 mb-2">Net Profit by Month</h3>
          <p className="text-xs text-gray-500 mb-4">Production revenue minus expenses within the range</p>
          <div className="h-[260px] w-full min-h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyProfitData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number | undefined, name?: string) => {
                    const amount = value ?? 0;
                    if (name === 'profit') return [formatCurrency(amount, currency), 'Net Profit'];
                    if (name === 'revenue') return [formatCurrency(amount, currency), 'Production'];
                    return [formatCurrency(amount, currency), 'Expenses'];
                  }}
                />
                <Legend />
                <Bar dataKey="profit" fill="#10B981" radius={[8, 8, 0, 0]} />
                <Bar dataKey="expenses" fill="#EF4444" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">New Patients by Month</h3>
        <p className="text-xs text-gray-500 mb-4">Monthly intake within the selected range</p>
        <div className="h-[260px] w-full min-h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={newPatientsMonthlyData}>
              <defs>
                <linearGradient id="colorPatients" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} dy={10} />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} />
              <Tooltip formatter={(value: number | undefined) => [`${value ?? 0} patients`, 'New Patients']} />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#10B981"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#colorPatients)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col gap-2 mb-5">
          <h3 className="text-lg font-semibold text-gray-800">X-Ray Service Monitor</h3>
          <p className="text-xs text-gray-500">Daily usage visibility for key X-ray services in the selected date range</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4">
            <p className="text-[10px] uppercase tracking-wider font-bold text-indigo-500">Total X-Ray Patients</p>
            <p className="text-2xl font-bold text-indigo-700 mt-1">{totalXrayPatients}</p>
          </div>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
            <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-500">Total X-Ray Revenue</p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">{formatCurrency(totalXrayRevenue, currency)}</p>
          </div>
          <div className="rounded-lg border border-amber-100 bg-amber-50 p-4">
            <p className="text-[10px] uppercase tracking-wider font-bold text-amber-500">Top Service Today</p>
            <p className="text-sm font-bold text-amber-700 mt-1">{topXrayService?.name || 'N/A'}</p>
            <p className="text-xs text-amber-600 mt-1">{topXrayService?.patients || 0} patient(s)</p>
          </div>
        </div>

        <div className="h-[320px] w-full min-h-[320px]">
          {serviceMonitorHasData ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serviceMonitorData} layout="vertical" margin={{ top: 10, right: 24, left: 12, bottom: 10 }} barCategoryGap={20}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
                <XAxis
                  type="number"
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  domain={[0, xrayXAxisMax]}
                  tickCount={xrayXAxisMax + 1}
                  tick={{ fill: '#6B7280', fontSize: 12 }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#4B5563', fontSize: 12, fontWeight: 600 }}
                  width={140}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 12, borderColor: '#E5E7EB' }}
                  formatter={(value: number | undefined, name?: string) => {
                    const amount = value ?? 0;
                    if (name === 'patients') return [`${amount}`, 'Patients'];
                    return [formatCurrency(amount, currency), 'Revenue'];
                  }}
                  labelFormatter={(label) => `Service: ${label}`}
                />
                <Bar dataKey="patients" radius={[8, 8, 8, 8]}>
                  {serviceMonitorData.map((entry, index) => {
                    const colors = ['#6366F1', '#3B82F6', '#8B5CF6', '#14B8A6'];
                    return <Cell key={`xray-service-${entry.name}-${index}`} fill={colors[index % colors.length]} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50">
              <p className="text-sm text-gray-500 italic">No X-ray activity found for the selected date range.</p>
            </div>
          )}
        </div>
      </div>

        </>
      )}

    </div>
  );
};

export default DashboardView;
