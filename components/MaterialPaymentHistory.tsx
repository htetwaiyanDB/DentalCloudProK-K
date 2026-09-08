import React, { useEffect, useMemo, useState } from 'react';
import type { MaterialPaymentHistoryRow } from '../utils/materialPaymentHistory';
import type { Currency } from '../utils/currency';
import { formatCurrency } from '../utils/currency';
import { formatDoctorName } from '../utils/doctorName';
import { formatPaymentAllocations, formatPaymentMethod } from '../utils/paymentMethods';
import Pagination from './Pagination';

interface MaterialPaymentHistoryProps {
  rows: MaterialPaymentHistoryRow[];
  currency: Currency;
}

const MaterialPaymentHistory: React.FC<MaterialPaymentHistoryProps> = ({ rows, currency }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const itemsPerPage = 10;
  const paginatedRows = useMemo(() => {
    if (showAll) return rows;
    return rows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  }, [currentPage, rows, showAll]);

  useEffect(() => setCurrentPage(1), [rows]);

  const methodLabel = (row: MaterialPaymentHistoryRow) => row.payment.allocations?.length
    ? formatPaymentAllocations(row.payment.allocations)
    : formatPaymentMethod(row.payment.paymentMethod);
  const balanceLabel = (row: MaterialPaymentHistoryRow) => row.balanceAfter > 0
    ? formatCurrency(row.balanceAfter, currency)
    : 'Clear';

  return (
    <>
      <div className="hidden overflow-x-auto xl:block">
        <table className="w-full min-w-[1320px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {['Payment Date', 'Receipt', 'Patient', 'Clinician', 'Treatment', 'Method', 'Status', 'Total Paid', 'Applied to Treatment', 'Balance After', 'Doctor Earned'].map((label) => (
                <th key={label} className={`px-5 py-4 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500 ${['Total Paid', 'Applied to Treatment', 'Balance After', 'Doctor Earned'].includes(label) ? 'text-right' : 'text-left'}`}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.length === 0 ? (
              <tr><td colSpan={11} className="px-6 py-12 text-center text-sm font-semibold text-slate-500">No payment collections found for these filters.</td></tr>
            ) : paginatedRows.map((row) => (
              <tr key={`material-payment-${row.id}`} className="border-l-4 border-emerald-300 hover:bg-emerald-50/30">
                <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">{row.date}</td>
                <td className="whitespace-nowrap px-5 py-4 font-mono text-xs text-slate-500">{row.receiptNumber}</td>
                <td className="px-5 py-4"><p className="font-bold text-slate-900">{row.patientName}</p><p className="mt-0.5 font-mono text-xs text-slate-400">{row.patientUniqueId}</p></td>
                <td className="px-5 py-4 text-sm text-slate-700">{row.doctorNames.length ? row.doctorNames.map((name) => formatDoctorName(name)).join(', ') : '—'}</td>
                <td className="px-5 py-4 text-sm text-slate-700">{row.treatmentNames.length ? row.treatmentNames.map((name) => <div key={name}>• {name}</div>) : '—'}</td>
                <td className="px-5 py-4 text-sm text-slate-600">{methodLabel(row)}</td>
                <td className="px-5 py-4"><span className={`rounded-full border px-2 py-1 text-[10px] font-black ${row.payment.type === 'FULL' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>{row.payment.type}</span></td>
                <td className="whitespace-nowrap px-5 py-4 text-right text-sm font-black text-slate-900">{formatCurrency(row.totalPaid, currency)}</td>
                <td className="whitespace-nowrap px-5 py-4 text-right text-sm font-black text-green-700">{row.appliedToTreatment > 0 ? formatCurrency(row.appliedToTreatment, currency) : '—'}</td>
                <td className={`whitespace-nowrap px-5 py-4 text-right text-sm font-bold ${row.balanceAfter > 0 ? 'text-slate-700' : 'text-emerald-700'}`}>{balanceLabel(row)}</td>
                <td className="whitespace-nowrap px-5 py-4 text-right text-sm font-black text-emerald-700">{row.doctorEarned > 0 ? formatCurrency(row.doctorEarned, currency) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 bg-slate-50/70 p-3 sm:p-4 xl:hidden">
        {rows.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm font-semibold text-slate-500">No payment collections found for these filters.</div> : paginatedRows.map((row) => (
          <article key={`material-payment-card-${row.id}`} className="rounded-2xl border border-slate-200 border-l-4 border-l-emerald-300 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-slate-900">{row.patientName}</p><p className="mt-1 text-xs text-slate-500">{row.date} · {row.receiptNumber}</p></div><span className={`rounded-full border px-2 py-1 text-[10px] font-black ${row.payment.type === 'FULL' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>{row.payment.type}</span></div>
            <p className="mt-3 text-sm text-slate-700">{row.treatmentNames.join(', ') || 'No treatment allocation'}</p>
            <p className="mt-1 text-xs text-slate-500">{row.doctorNames.length ? row.doctorNames.map((name) => formatDoctorName(name)).join(', ') : 'No clinician'} · {methodLabel(row)}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><div className="rounded-xl bg-slate-50 p-3"><dt className="text-[10px] font-bold uppercase text-slate-500">Total paid</dt><dd className="mt-1 font-black">{formatCurrency(row.totalPaid, currency)}</dd></div><div className="rounded-xl bg-emerald-50 p-3"><dt className="text-[10px] font-bold uppercase text-emerald-700">Applied</dt><dd className="mt-1 font-black text-emerald-700">{formatCurrency(row.appliedToTreatment, currency)}</dd></div><div className="rounded-xl bg-slate-50 p-3"><dt className="text-[10px] font-bold uppercase text-slate-500">Balance after</dt><dd className="mt-1 font-bold">{balanceLabel(row)}</dd></div><div className="rounded-xl bg-emerald-50 p-3"><dt className="text-[10px] font-bold uppercase text-emerald-700">Doctor earned</dt><dd className="mt-1 font-black text-emerald-700">{row.doctorEarned > 0 ? formatCurrency(row.doctorEarned, currency) : '—'}</dd></div></dl>
          </article>
        ))}
      </div>

      {rows.length > 0 && <Pagination totalItems={rows.length} itemsPerPage={itemsPerPage} currentPage={currentPage} onPageChange={setCurrentPage} showAll={showAll} onToggleShowAll={() => setShowAll(!showAll)} />}
    </>
  );
};

export default MaterialPaymentHistory;
