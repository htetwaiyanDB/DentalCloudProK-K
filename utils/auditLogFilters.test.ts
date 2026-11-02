import { describe, expect, it } from 'vitest';
import { filterAuditRowsByDateRange, getAuditLogEventDate, isDateInRange, toLocalISODate } from './auditLogFilters';

describe('audit log date filtering', () => {
  const rows = [
    {
      kind: 'treatment' as const,
      sortDate: '2026-05-30T23:59:59',
      record: { date: '2026-05-30' }
    },
    {
      kind: 'appointment' as const,
      sortDate: '2026-05-30T09:00:00',
      appointment: { date: '2026-05-30', created_at: '2026-05-29T12:00:00Z' }
    },
    {
      kind: 'treatment' as const,
      sortDate: '2026-05-29T23:59:59',
      record: { date: '2026-05-29' }
    },
    {
      kind: 'appointment' as const,
      sortDate: '2026-06-01T10:30:00',
      appointment: { date: '2026-06-01', created_at: '2026-05-30T03:00:00Z' }
    },
    {
      kind: 'reschedule' as const,
      sortDate: '2026-05-30T11:00:00Z',
      rescheduleLog: { created_at: '2026-05-30T11:00:00Z' }
    }
  ];

  it('keeps only rows for a single selected day', () => {
    const filtered = filterAuditRowsByDateRange(rows, '2026-05-30', '2026-05-30');

    expect(filtered).toHaveLength(3);
    expect(filtered.map((row) => row.kind)).toEqual(['treatment', 'appointment', 'reschedule']);
  });

  it('keeps rows inside an inclusive day-to-day range', () => {
    const filtered = filterAuditRowsByDateRange(rows, '2026-05-30', '2026-06-01');

    expect(filtered).toHaveLength(4);
    expect(filtered.map(getAuditLogEventDate)).toEqual(['2026-05-30', '2026-05-30', '2026-06-01', '2026-05-30']);
  });

  it('uses appointment created_at date when appointment date is missing', () => {
    const filtered = filterAuditRowsByDateRange([
      {
        kind: 'appointment' as const,
        sortDate: '2026-05-30T03:00:00Z',
        appointment: { date: '', created_at: '2026-05-30T03:00:00Z' }
      }
    ], '2026-05-30', '2026-05-30');

    expect(filtered).toHaveLength(1);
  });

  it('uses reschedule created_at date for filtering', () => {
    const filtered = filterAuditRowsByDateRange([
      {
        kind: 'reschedule' as const,
        sortDate: '2026-05-30T03:00:00Z',
        rescheduleLog: { created_at: '2026-05-30T03:00:00Z' }
      }
    ], '2026-05-30', '2026-05-30');

    expect(filtered).toHaveLength(1);
  });

  it('uses the reversal date for a voided payment audit event', () => {
    const filtered = filterAuditRowsByDateRange([
      {
        kind: 'payment' as const,
        sortDate: '2026-05-30T03:00:00Z',
        payment: {
          date: '2026-05-01',
          createdAt: '2026-05-01T03:00:00Z',
          voidedAt: '2026-05-30T03:00:00Z'
        }
      }
    ], '2026-05-30', '2026-05-30');

    expect(filtered).toHaveLength(1);
    expect(getAuditLogEventDate(filtered[0])).toBe('2026-05-30');
  });

  it('compares ISO datetime strings by their date portion', () => {
    expect(isDateInRange('2026-05-30T23:59:59Z', '2026-05-30', '2026-05-30')).toBe(true);
    expect(isDateInRange('2026-05-31T00:00:00Z', '2026-05-30', '2026-05-30')).toBe(false);
  });

  it('formats local Date objects as YYYY-MM-DD', () => {
    expect(toLocalISODate(new Date(2026, 4, 3))).toBe('2026-05-03');
  });
});
