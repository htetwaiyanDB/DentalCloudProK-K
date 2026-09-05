import type { TreatmentChargeLine } from '../types';

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const normalizeMoney = (value: unknown): number => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, roundMoney(numericValue)) : 0;
};

export const distributeOverallDiscount = <T extends { cost: number }>(
  lines: T[],
  requestedDiscount: number
): T[] => {
  const normalizedLines = lines.map((line) => ({ ...line, cost: normalizeMoney(line.cost) }));
  const subtotal = roundMoney(normalizedLines.reduce((sum, line) => sum + line.cost, 0));
  const discount = Math.min(subtotal, normalizeMoney(requestedDiscount));

  if (discount === 0 || subtotal === 0) return normalizedLines;

  let remainingDiscount = discount;
  let remainingSubtotal = subtotal;

  return normalizedLines.map((line, index) => {
    const isLastChargedLine = normalizedLines.slice(index + 1).every((candidate) => candidate.cost === 0);
    const lineDiscount = line.cost === 0
      ? 0
      : isLastChargedLine
        ? remainingDiscount
        : Math.min(line.cost, roundMoney((line.cost / remainingSubtotal) * remainingDiscount));

    remainingDiscount = roundMoney(remainingDiscount - lineDiscount);
    remainingSubtotal = roundMoney(remainingSubtotal - line.cost);
    return { ...line, cost: roundMoney(line.cost - lineDiscount) };
  });
};

export const distributeOverallTreatmentDiscount = (
  lines: TreatmentChargeLine[],
  requestedDiscount: number
): TreatmentChargeLine[] => distributeOverallDiscount(lines, requestedDiscount);
