import React from 'react';
import { AlertTriangle, Ban, Loader2, X } from 'lucide-react';
import type { PaymentRecord } from '../types';
import { api } from '../services/api';
import { auth } from '../services/auth';
import { formatCurrency, type Currency } from '../utils/currency';

interface VoidPaymentModalProps {
  isOpen: boolean;
  payment: PaymentRecord | null;
  currency: Currency;
  onClose: () => void;
  onVoided: (updatedPayment: PaymentRecord) => void | Promise<void>;
}

const VoidPaymentModal: React.FC<VoidPaymentModalProps> = ({ isOpen, payment, currency, onClose, onVoided }) => {
  const [reason, setReason] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    setReason('');
    setSubmitting(false);
    setError(null);
  }, [isOpen, payment?.id]);

  if (!isOpen || !payment) return null;

  const normalizedReason = reason.trim();
  const canSubmit = !submitting && normalizedReason.length >= 10;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      const session = auth.getSession();
      if (!session?.userId || session.role !== 'admin') {
        throw new Error('Only logged-in admins can void payments.');
      }

      const updatedPayment = await api.finance.voidPayment({
        paymentId: payment.id,
        reason: normalizedReason,
        voidedByUserId: session.userId
      });
      await onVoided(updatedPayment);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to void payment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-red-600">Permanent financial reversal</p>
            <h2 className="mt-1 text-2xl font-bold text-slate-900">Void payment</h2>
            <p className="mt-1 text-sm text-slate-500">
              {payment.patient_name || 'Unknown patient'} {payment.receiptNumber ? `· ${payment.receiptNumber}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100" aria-label="Close void payment modal">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-6">
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-900">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">This will reverse {formatCurrency(payment.amount, currency)}.</p>
                <p className="mt-1 leading-5">The amount will return to the patient's outstanding balance. The payment stays in the audit log and cannot be voided twice.</p>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Reason for void</label>
            <textarea
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              maxLength={500}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-100"
              placeholder="Example: Duplicate payment collected from patient"
            />
            <p className={`mt-2 text-xs font-semibold ${normalizedReason.length >= 10 ? 'text-emerald-600' : 'text-slate-500'}`}>Minimum 10 characters required.</p>
          </div>

          {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div> : null}

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-5">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
            <button type="submit" disabled={!canSubmit} className="inline-flex items-center gap-2 rounded-2xl bg-red-600 px-5 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300">
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />}
              {submitting ? 'Voiding payment...' : 'Void & reverse payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default VoidPaymentModal;
