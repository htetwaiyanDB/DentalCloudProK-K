import React, { useMemo } from 'react';
import {
  Activity, CalendarDays, CheckCircle2, CircleDollarSign, Clock3, FileHeart,
  Download, Pill, Stethoscope, UserRound, WalletCards
} from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { Appointment, ClinicalRecord, Doctor, MedicineSale, Patient, PaymentAllocation, PaymentMethod, PaymentRecord } from '../types';
import type { Currency } from '../utils/currency';
import { formatCurrency } from '../utils/currency';
import { formatDoctorName } from '../utils/doctorName';
import { formatMedicineQuantity } from '../utils/medicineHistory';
import { formatPaymentAllocations, formatPaymentMethod } from '../utils/paymentMethods';
import { buildPatientReport, type PatientReportTimelineKind } from '../utils/patientReport';
import { formatTeethWithPosition } from '../utils/toothNumbering';
import { Modal } from './Shared';

interface AboutPatientReportProps {
  patient: Patient;
  appointments: Appointment[];
  treatments: ClinicalRecord[];
  medicineSales: MedicineSale[];
  payments: PaymentRecord[];
  paymentsAvailable: boolean;
  doctors: Doctor[];
  currency: Currency;
  onClose: () => void;
}

const CARE_COLORS: Record<string, string> = {
  Treatments: '#4f46e5', Medicines: '#10b981', 'Service fees': '#f59e0b'
};
const STATUS_COLORS: Record<string, string> = {
  Completed: '#10b981', Scheduled: '#4f46e5', Cancelled: '#ef4444'
};

const formatReportDate = (date: string | null): string => {
  if (!date) return 'Not recorded';
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

const formatPaymentMethodSummary = (payment: { paymentMethod?: PaymentMethod; allocations?: PaymentAllocation[] }): string => {
  const methods = payment.allocations?.map((allocation) => formatPaymentMethod(allocation.method)).filter(Boolean) || [];
  return methods.length ? methods.join(' + ') : formatPaymentMethod(payment.paymentMethod);
};

const timelineStyle: Record<PatientReportTimelineKind, { label: string; dot: string; icon: React.ReactNode }> = {
  appointment: { label: 'Appointment', dot: 'bg-indigo-500', icon: <CalendarDays size={15} /> },
  treatment: { label: 'Treatment', dot: 'bg-sky-500', icon: <Stethoscope size={15} /> },
  medicine: { label: 'Medicine', dot: 'bg-emerald-500', icon: <Pill size={15} /> }
};

const EmptyPanel = ({ children }: { children: React.ReactNode }) => (
  <div className="flex min-h-36 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 text-center text-sm font-medium text-slate-500">
    {children}
  </div>
);

const ChartLegend = ({
  items,
  colors,
  formatValue
}: {
  items: Array<{ name: string; value: number }>;
  colors: Record<string, string>;
  formatValue: (value: number) => string;
}) => (
  <ul aria-label="Chart legend" className="mt-3 flex flex-wrap gap-2" role="list">
    {items.map((item) => (
      <li key={item.name} className="flex min-w-0 flex-1 basis-36 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colors[item.name] }} aria-hidden="true" />
          <span className="truncate text-xs font-semibold text-slate-700" title={item.name}>{item.name}</span>
        </span>
        <span className="shrink-0 text-xs font-black tabular-nums text-slate-950">{formatValue(item.value)}</span>
      </li>
    ))}
  </ul>
);

const AboutPatientReport: React.FC<AboutPatientReportProps> = ({
  patient, appointments, treatments, medicineSales, payments, paymentsAvailable, doctors, currency, onClose
}) => {
  const report = useMemo(() => buildPatientReport({
    patient, appointments, treatments, medicineSales, payments, paymentsAvailable, doctors, currency
  }), [patient, appointments, treatments, medicineSales, payments, paymentsAvailable, doctors, currency]);

  const careComposition = [
    { name: 'Treatments', value: report.treatmentValue },
    { name: 'Medicines', value: report.medicineValue },
    { name: 'Service fees', value: report.serviceFeeValue }
  ].filter((item) => item.value > 0);

  const [isExportingPdf, setIsExportingPdf] = React.useState(false);
  const handleExportPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const { exportAboutPatientToPDF } = await import('../utils/pdfExport');
      exportAboutPatientToPDF({ patient, appointments, treatments, medicineSales, payments, paymentsAvailable, doctors, currency });
    } catch (error) {
      console.error('Failed to export patient report PDF:', error);
      window.alert('The patient report PDF could not be created. Please try again.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <Modal title="About this patient" onClose={onClose} maxWidthClassName="max-w-7xl">
      <div className="space-y-6 text-slate-900">
        <section className="relative overflow-hidden rounded-3xl bg-slate-950 px-5 py-6 text-white sm:px-7">
          <div className="absolute -right-12 -top-16 h-48 w-48 rounded-full border-[28px] border-cyan-400/10" aria-hidden="true" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-cyan-300 text-xl font-black text-slate-950">
                {patient.name.trim().charAt(0).toUpperCase() || <UserRound size={24} />}
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-300">Patient case briefing</p>
                <h2 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">{patient.name}</h2>
                <p className="mt-1 text-sm text-slate-300">
                  {patient.patient_unique_id || `ID ${patient.id.slice(0, 8)}`} · {patient.phone || 'No phone recorded'}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-stretch gap-3 sm:items-end">
              <button type="button" onClick={handleExportPdf} disabled={isExportingPdf} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-black text-slate-950 transition-colors hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-70">
                <Download size={16} aria-hidden="true" />{isExportingPdf ? 'Preparing PDF…' : 'Export PDF'}
              </button>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-xs text-slate-400">First visit</p>
                <p className="mt-1 font-bold">{formatReportDate(report.firstVisitDate)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-xs text-slate-400">Latest visit</p>
                <p className="mt-1 font-bold">{formatReportDate(report.lastVisitDate)}</p>
              </div>
              <div className="col-span-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 sm:col-span-1">
                <p className="text-xs text-slate-400">Patient type</p>
                <p className="mt-1 font-bold">{patient.patient_type || 'Not assigned'}</p>
              </div>
              </div>
            </div>
          </div>
        </section>

        <section aria-label="Patient summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: 'Visits', value: String(report.visitDates.length), note: 'Unique care dates', icon: <CalendarDays size={18} />, tone: 'text-indigo-700 bg-indigo-50' },
            { label: 'Amount paid', value: report.totalPaid === null ? 'Restricted' : formatCurrency(report.totalPaid, currency), note: report.totalPaid === null ? 'Not available in this role' : `${report.paymentHistory?.length || 0} payments`, icon: <WalletCards size={18} />, tone: 'text-emerald-700 bg-emerald-50' },
            { label: 'Care value', value: formatCurrency(report.careValue, currency), note: 'Treatment, medicine & fees', icon: <Activity size={18} />, tone: 'text-sky-700 bg-sky-50' },
            { label: 'Current debt', value: formatCurrency(report.currentDebt, currency), note: report.currentDebt > 0 ? 'Outstanding balance' : 'Balance is clear', icon: <CircleDollarSign size={18} />, tone: report.currentDebt > 0 ? 'text-rose-700 bg-rose-50' : 'text-emerald-700 bg-emerald-50' }
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <span className={`inline-flex rounded-xl p-2.5 ${item.tone}`}>{item.icon}</span>
              <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
              <p className="mt-1 break-words text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{item.value}</p>
              <p className="mt-1 text-xs text-slate-500">{item.note}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-3">
              <h3 className="font-black text-slate-950">Care value composition</h3>
              <p className="mt-1 text-xs text-slate-500">Billed clinical care, not cash collected.</p>
            </div>
            <div className="min-h-64">
              {careComposition.length ? (
                <>
                  <div className="h-48" aria-label="Care value composition chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                        <Pie data={careComposition} dataKey="value" nameKey="name" innerRadius={50} outerRadius={76} paddingAngle={4}>
                          {careComposition.map((entry) => <Cell key={entry.name} fill={CARE_COLORS[entry.name]} />)}
                        </Pie>
                        <Tooltip formatter={(value: number | undefined) => formatCurrency(Number(value || 0), currency)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ChartLegend items={careComposition} colors={CARE_COLORS} formatValue={(value) => formatCurrency(value, currency)} />
                </>
              ) : <EmptyPanel>No treatment, medicine, or service-fee value has been recorded.</EmptyPanel>}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-3">
              <h3 className="font-black text-slate-950">Appointment outcomes</h3>
              <p className="mt-1 text-xs text-slate-500">All appointments currently available for this patient.</p>
            </div>
            <div className="min-h-64">
              {report.appointmentStatus.length ? (
                <>
                  <div className="h-48" aria-label="Appointment outcomes chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                        <Pie data={report.appointmentStatus} dataKey="value" nameKey="name" innerRadius={50} outerRadius={76} paddingAngle={4}>
                          {report.appointmentStatus.map((entry) => <Cell key={entry.name} fill={STATUS_COLORS[entry.name]} />)}
                        </Pie>
                        <Tooltip formatter={(value: number | undefined) => [`${Number(value || 0)} appointments`, 'Count']} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ChartLegend items={report.appointmentStatus} colors={STATUS_COLORS} formatValue={(value) => `${value}`} />
                </>
              ) : <EmptyPanel>No appointments have been recorded for this patient.</EmptyPanel>}
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2"><Stethoscope className="text-indigo-600" size={19} /><h3 className="font-black">Treatments received</h3></div>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
              {report.treatments.length ? report.treatments.map((item) => (
                <div key={item.name.toLocaleLowerCase()} className="rounded-2xl bg-slate-50 p-3">
                  <div className="flex justify-between gap-3"><p className="font-bold text-slate-900">{item.name}</p><span className="text-sm font-black text-indigo-700">×{item.count}</span></div>
                  <div className="mt-1 flex justify-between gap-3 text-xs text-slate-500"><span>{item.dates.map(formatReportDate).join(', ')}</span><span className="shrink-0 font-bold">{formatCurrency(item.total, currency)}</span></div>
                </div>
              )) : <EmptyPanel>No treatments recorded.</EmptyPanel>}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2"><Pill className="text-emerald-600" size={19} /><h3 className="font-black">Medicines given</h3></div>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
              {report.medicines.length ? report.medicines.map((item) => (
                <div key={item.id} className="rounded-2xl bg-emerald-50/70 p-3">
                  <div className="flex justify-between gap-3"><p className="font-bold text-slate-900">{item.name}</p><span className="text-sm font-black text-emerald-700">{formatMedicineQuantity(item.quantity, item.unit)}</span></div>
                  <div className="mt-1 flex justify-between gap-3 text-xs text-slate-500"><span>{item.dates.map(formatReportDate).join(', ')}</span><span className="shrink-0 font-bold">{formatCurrency(item.total, currency)}</span></div>
                </div>
              )) : <EmptyPanel>No medicines or inventory items recorded.</EmptyPanel>}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2"><UserRound className="text-sky-600" size={19} /><h3 className="font-black">Doctors involved</h3></div>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
              {report.doctors.length ? report.doctors.map((doctor) => (
                <div key={doctor.id} className="rounded-2xl bg-sky-50/70 p-3">
                  <p className="font-bold text-slate-900">{formatDoctorName(doctor.name)}</p>
                  <p className="mt-1 text-xs text-slate-600">{doctor.appointmentCount} appointments · {doctor.treatmentCount} treatments</p>
                  <p className="mt-1 text-[11px] text-slate-500">{doctor.dates.map(formatReportDate).join(', ')}</p>
                </div>
              )) : <EmptyPanel>No doctor has been linked to this patient's care.</EmptyPanel>}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="font-black text-slate-950">Treatment amounts & payments</h3>
              <p className="mt-1 text-xs text-slate-500">Treatment fees, linked collections, remaining amounts, and payment details.</p>
            </div>
            <span className="w-fit rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700">{report.treatmentLedger.length} treatments</span>
          </div>
          {!paymentsAvailable && <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">Paid amounts, remaining treatment amounts, and payment details are not available to your role. Treatment fees remain visible.</div>}
          {report.treatmentLedger.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[64rem] text-left text-sm">
                <thead className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                  <tr><th className="py-3 pr-4">Treatment</th><th className="px-4 py-3">Date & clinician</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3 text-right">Paid</th><th className="px-4 py-3 text-right">Remaining</th><th className="py-3 pl-4">Payment dates & info</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.treatmentLedger.map((item) => (
                    <tr key={item.id} className="align-top">
                      <td className="py-4 pr-4"><p className="font-bold text-slate-950">{item.name}</p><p className="mt-1 text-xs text-slate-500">{item.teeth.length ? formatTeethWithPosition(item.teeth) : 'No teeth recorded'}</p></td>
                      <td className="px-4 py-4"><p className="whitespace-nowrap font-semibold">{formatReportDate(item.date)}</p><p className="mt-1 text-xs text-slate-500">{formatDoctorName(item.doctorName)}</p></td>
                      <td className="whitespace-nowrap px-4 py-4 text-right font-bold">{formatCurrency(item.amount, currency)}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-right font-bold text-emerald-700">{item.paid === null ? <span className="text-xs text-slate-400">Restricted</span> : formatCurrency(item.paid, currency)}</td>
                      <td className={`whitespace-nowrap px-4 py-4 text-right font-black ${item.balance === null ? 'text-slate-400' : item.balance > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{item.balance === null ? <span className="text-xs">Restricted</span> : formatCurrency(item.balance, currency)}</td>
                      <td className="py-4 pl-4">
                        {!paymentsAvailable ? <span className="text-xs font-medium text-slate-400">Restricted</span> : item.payments.length ? <div className="space-y-2">{item.payments.map((payment) => (
                          <div key={`${item.id}-${payment.id}`} className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold text-slate-800">{formatReportDate(payment.date)}</span><span className="font-black text-emerald-700">{formatCurrency(payment.amount, currency)}</span></div>
                            <p className="mt-1 text-xs text-slate-500">{formatPaymentMethodSummary(payment)}{payment.receiptNumber ? ` · ${payment.receiptNumber}` : ''}</p>
                          </div>
                        ))}</div> : <span className="text-xs font-medium text-slate-400">No linked payment</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyPanel>No treatments recorded.</EmptyPanel>}
          {paymentsAvailable && report.treatmentLedger.length > 0 && <p className="mt-4 text-xs text-slate-500">Remaining amounts are calculated from payments linked to each treatment. Current debt above is the authoritative patient account balance and may also include medicines or service fees.</p>}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div><h3 className="font-black text-slate-950">Payment history</h3><p className="mt-1 text-xs text-slate-500">All collections available for this patient, including legacy payments not linked to a treatment.</p></div>
            {report.paymentHistory && <span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">{report.paymentHistory.length} payments</span>}
          </div>
          {!report.paymentHistory ? <EmptyPanel>Payment history is not available to your role.</EmptyPanel> : report.paymentHistory.length ? (
            <div className="overflow-x-auto"><table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="py-3 pr-4">Payment date</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">Receipt</th><th className="px-4 py-3 text-right">Amount</th><th className="py-3 pl-4 text-right">Patient balance after</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{report.paymentHistory.map((payment) => (
                <tr key={payment.id} className={payment.voidedAt ? 'bg-red-50/40' : ''}><td className="whitespace-nowrap py-3 pr-4 font-semibold">{formatReportDate(payment.date)}</td><td className={`px-4 py-3 font-medium ${payment.voidedAt ? 'text-red-700' : ''}`}>{payment.voidedAt ? 'VOID' : payment.allocations?.length ? formatPaymentAllocations(payment.allocations) : formatPaymentMethod(payment.paymentMethod)}</td><td className="px-4 py-3 text-slate-500">{payment.receiptNumber || payment.receiptSnapshot?.receiptNumber || '—'}</td><td className={`whitespace-nowrap px-4 py-3 text-right font-black ${payment.voidedAt ? 'text-red-700' : 'text-emerald-700'}`}>{payment.voidedAt ? `Reversed ${formatCurrency(payment.voidedAmount ?? payment.originalAmount ?? 0, currency)}` : formatCurrency(payment.clearedAmount ?? payment.amount, currency)}</td><td className="whitespace-nowrap py-3 pl-4 text-right font-bold">{formatCurrency(payment.patientCurrentBalance ?? payment.remainingBalance, currency)}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <EmptyPanel>No payments recorded for this patient.</EmptyPanel>}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div><h3 className="font-black text-slate-950">Appointment ledger</h3><p className="mt-1 text-xs text-slate-500">Dates, times, doctors, types, and current status.</p></div>
            <span className="w-fit rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">{report.appointments.length} appointments</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="py-3 pr-4">Date & time</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Doctor</th><th className="px-4 py-3">Status</th><th className="py-3 pl-4">Notes</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {report.appointments.length ? report.appointments.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap py-3 pr-4 font-semibold">{formatReportDate(item.date)}<span className="ml-2 text-xs font-normal text-slate-500">{item.time || 'No time'}</span></td>
                    <td className="px-4 py-3 font-medium">{item.type || 'Appointment'}</td>
                    <td className="px-4 py-3">{formatDoctorName(item.doctor_name)}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${item.status === 'Completed' ? 'bg-emerald-50 text-emerald-700' : item.status === 'Cancelled' ? 'bg-rose-50 text-rose-700' : 'bg-indigo-50 text-indigo-700'}`}>{item.status}</span></td>
                    <td className="max-w-sm truncate py-3 pl-4 text-slate-500" title={item.notes}>{item.notes || '—'}</td>
                  </tr>
                )) : <tr><td colSpan={5} className="py-10 text-center text-slate-500">No appointments recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5"><h3 className="font-black text-slate-950">Care trail</h3><p className="mt-1 text-xs text-slate-500">Appointments, treatments, and medicines in one date-ordered history.</p></div>
          {report.timeline.length ? (
            <ol className="relative ml-3 border-l border-slate-200">
              {report.timeline.map((item) => {
                const style = timelineStyle[item.kind];
                return (
                  <li key={item.id} className="relative mb-5 ml-6 last:mb-0">
                    <span className={`absolute -left-[1.92rem] top-1 h-3 w-3 rounded-full ring-4 ring-white ${style.dot}`} />
                    <div className="flex flex-col gap-2 rounded-2xl bg-slate-50 p-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500">{style.icon}{style.label}</span>{item.status && <span className="text-xs font-bold text-slate-500">· {item.status}</span>}</div>
                        <p className="mt-1 font-bold text-slate-950">{item.title}</p>
                        <p className="mt-1 text-xs text-slate-600">{item.detail}{item.doctorName ? ` · ${formatDoctorName(item.doctorName)}` : ''}</p>
                      </div>
                      <div className="shrink-0 text-left sm:text-right"><p className="inline-flex items-center gap-1 text-xs font-bold text-slate-600"><Clock3 size={13} />{formatReportDate(item.date)}{item.time ? ` · ${item.time}` : ''}</p>{item.amount !== undefined && <p className="mt-1 text-sm font-black text-slate-900">{formatCurrency(item.amount, currency)}</p>}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : <EmptyPanel>No clinical activity has been recorded for this patient.</EmptyPanel>}
        </section>

        <div className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-2"><FileHeart size={16} />This report reflects records currently available to your role and branch.</span>
          <span className="hidden items-center gap-1 font-semibold sm:inline-flex"><CheckCircle2 size={14} className="text-emerald-600" />Live summary</span>
        </div>
      </div>
    </Modal>
  );
};

export default AboutPatientReport;
