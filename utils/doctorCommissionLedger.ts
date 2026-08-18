import { usesFlatVisitCommission, type DoctorCommissionType } from './doctorCommission';

export interface CommissionTreatmentInput {
  id: string;
  patientId: string;
  doctorId?: string | null;
  treatmentTypeId?: string | null;
  date: string;
  cost: number;
  materialCost?: number;
  commissionType?: DoctorCommissionType | string | null;
  specialization?: string | null;
  commissionPercentage?: number | null;
  commissionPerVisit?: number | null;
  customCommissionPercentage?: number | null;
}

export interface CommissionPaymentInput {
  id: string;
  patientId: string;
  date: string;
  createdAt?: string | null;
  commissionableAmount: number;
  treatmentIds: string[];
}

export interface ExistingCommissionEntryInput {
  id?: string;
  paymentId: string;
  treatmentId: string;
  commissionRate: number;
  calculationMode: 'percentage' | 'flat_visit';
  visitKey?: string;
}

export interface TreatmentPaymentAllocation {
  paymentId: string;
  treatmentId: string;
  paymentDate: string;
  amount: number;
}

export interface CalculatedCommissionEntry extends TreatmentPaymentAllocation {
  doctorId: string;
  patientId: string;
  treatmentDate: string;
  visitKey: string;
  calculationMode: 'percentage' | 'flat_visit';
  commissionRate: number;
  materialDeduction: number;
  commissionBase: number;
  earnings: number;
}

const roundMoney = (amount: number): number => Math.round(amount * 100) / 100;

const toNonNegativeFiniteNumber = (value: unknown): number => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;
};

const toPercentageRate = (value: unknown): number => (
  Math.min(100, toNonNegativeFiniteNumber(value))
);

// Percentage commission is paid only from the amount left after every cost
// recorded for the treatment (both material and lab) has been recovered.
// Applying this per payment also makes partial payments deterministic: the
// cost is deducted once, from the earliest collected amount(s).
const calculatePercentageCommissionBase = (
  allocatedPayment: number,
  remainingTreatmentCost: number
): { materialDeduction: number; commissionBase: number } => {
  const safeAllocation = toNonNegativeFiniteNumber(allocatedPayment);
  const safeCost = toNonNegativeFiniteNumber(remainingTreatmentCost);
  const materialDeduction = Math.min(safeCost, safeAllocation);

  return {
    materialDeduction: roundMoney(materialDeduction),
    commissionBase: roundMoney(Math.max(0, safeAllocation - materialDeduction))
  };
};

const byPaymentOrder = (a: CommissionPaymentInput, b: CommissionPaymentInput) => (
  a.date.localeCompare(b.date) ||
  String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
  a.id.localeCompare(b.id)
);

const byTreatmentOrder = (a: CommissionTreatmentInput, b: CommissionTreatmentInput) => (
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
);

export const allocateCommissionablePayments = (
  treatments: CommissionTreatmentInput[],
  payments: CommissionPaymentInput[]
): TreatmentPaymentAllocation[] => {
  const treatmentById = new Map(treatments.map((treatment) => [treatment.id, treatment]));
  const remainingByTreatment = new Map(
    treatments.map((treatment) => [treatment.id, Math.max(0, Number(treatment.cost || 0))])
  );
  const treatmentsByPatient = new Map<string, CommissionTreatmentInput[]>();

  treatments.forEach((treatment) => {
    const rows = treatmentsByPatient.get(treatment.patientId) || [];
    rows.push(treatment);
    treatmentsByPatient.set(treatment.patientId, rows);
  });
  treatmentsByPatient.forEach((rows) => rows.sort(byTreatmentOrder));

  const allocations: TreatmentPaymentAllocation[] = [];
  [...payments].sort(byPaymentOrder).forEach((payment) => {
    let amountLeft = Math.max(0, Number(payment.commissionableAmount || 0));
    if (amountLeft <= 0) return;

    const explicitTreatmentIds = Array.from(new Set(payment.treatmentIds || []));
    const explicitTreatments = explicitTreatmentIds
      .map((id) => treatmentById.get(id))
      .filter((treatment): treatment is CommissionTreatmentInput => (
        !!treatment && treatment.patientId === payment.patientId
      ));

    // Explicit links must never silently become an unlinked balance payment or
    // be partially redistributed within a scoped dataset. This matters for
    // location/date-scoped reports where one referenced treatment may be absent.
    if (explicitTreatments.length !== explicitTreatmentIds.length) return;

    if (explicitTreatments.length > 0) {
      const eligible = explicitTreatments.filter((treatment) => (remainingByTreatment.get(treatment.id) || 0) > 0);
      const totalRemaining = eligible.reduce(
        (sum, treatment) => sum + (remainingByTreatment.get(treatment.id) || 0),
        0
      );
      const allocatable = Math.min(amountLeft, totalRemaining);

      eligible.forEach((treatment, index) => {
        const remaining = remainingByTreatment.get(treatment.id) || 0;
        const proportional = totalRemaining > 0 ? allocatable * (remaining / totalRemaining) : 0;
        const alreadyAllocated = allocations
          .filter((row) => row.paymentId === payment.id)
          .reduce((sum, row) => sum + row.amount, 0);
        const share = index === eligible.length - 1
          ? Math.min(remaining, allocatable - alreadyAllocated)
          : Math.min(remaining, roundMoney(proportional));

        if (share <= 0) return;
        remainingByTreatment.set(treatment.id, roundMoney(remaining - share));
        allocations.push({
          paymentId: payment.id,
          treatmentId: treatment.id,
          paymentDate: payment.date,
          amount: roundMoney(share)
        });
      });
      amountLeft = roundMoney(amountLeft - allocatable);
      if (amountLeft <= 0) return;
    }

    // After explicitly selected treatments are covered, apply any remaining payment
    // to the patient's oldest outstanding treatments. This supports a checkout that
    // collects both a new treatment and an older balance in one payment. Any amount
    // left after all treatment debt is covered belongs to non-commissionable charges.
    const candidates = (treatmentsByPatient.get(payment.patientId) || [])
      .filter((treatment) => treatment.date <= payment.date);
    for (const treatment of candidates) {
      const remaining = remainingByTreatment.get(treatment.id) || 0;
      if (remaining <= 0 || amountLeft <= 0) continue;
      const share = Math.min(remaining, amountLeft);
      remainingByTreatment.set(treatment.id, roundMoney(remaining - share));
      amountLeft = roundMoney(amountLeft - share);
      allocations.push({
        paymentId: payment.id,
        treatmentId: treatment.id,
        paymentDate: payment.date,
        amount: roundMoney(share)
      });
    }
  });

  return allocations;
};

export const calculateCommissionLedgerEntries = (
  treatments: CommissionTreatmentInput[],
  allocations: TreatmentPaymentAllocation[],
  existingEntries: ExistingCommissionEntryInput[] = []
): CalculatedCommissionEntry[] => {
  const treatmentById = new Map(treatments.map((treatment) => [treatment.id, treatment]));
  const existingByAllocation = new Map(
    existingEntries.map((entry) => [`${entry.paymentId}|${entry.treatmentId}`, entry])
  );
  const existingModeByVisit = new Map<string, ExistingCommissionEntryInput['calculationMode']>();
  existingEntries.forEach((entry) => {
    if (!entry.visitKey) return;
    const existingMode = existingModeByVisit.get(entry.visitKey);
    if (existingMode && existingMode !== entry.calculationMode) {
      throw new Error(`Conflicting historical commission modes for visit ${entry.visitKey}.`);
    }
    existingModeByVisit.set(entry.visitKey, entry.calculationMode);
  });
  const existingPercentageByVisitAndTreatment = new Map(
    existingEntries
      .filter((entry) => entry.calculationMode === 'percentage' && entry.visitKey)
      .map((entry) => [`${entry.visitKey}|${entry.treatmentId}`, entry])
  );
  const resolveTreatmentMode = (treatment: CommissionTreatmentInput): ExistingCommissionEntryInput['calculationMode'] =>
    usesFlatVisitCommission({
      commissionType: treatment.commissionType,
      specialization: treatment.specialization
    }) ? 'flat_visit' : 'percentage';
  const percentageRows: CalculatedCommissionEntry[] = [];
  const percentageCandidates: Array<TreatmentPaymentAllocation & {
    treatment: CommissionTreatmentInput;
    rate: number;
    visitKey: string;
  }> = [];
  const percentageTreatmentIds = new Set<string>();
  const flatCandidates = new Map<string, Array<TreatmentPaymentAllocation & { treatment: CommissionTreatmentInput }>>();
  const allocationKeys = new Set(allocations.map((allocation) => `${allocation.paymentId}|${allocation.treatmentId}`));
  const orphanedFlatVisitKeys = new Set(existingEntries
    .filter((entry) => entry.calculationMode === 'flat_visit' && entry.visitKey && !allocationKeys.has(`${entry.paymentId}|${entry.treatmentId}`))
    .map((entry) => entry.visitKey as string));
  const orphanedFlatTargetByVisit = new Map<string, string>();
  [...allocations]
    .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate) || a.paymentId.localeCompare(b.paymentId) || a.treatmentId.localeCompare(b.treatmentId))
    .forEach((allocation) => {
      const treatment = treatmentById.get(allocation.treatmentId);
      if (!treatment?.doctorId) return;
      const visitKey = `${treatment.doctorId}|${treatment.patientId}|${treatment.date}`;
      if (orphanedFlatVisitKeys.has(visitKey) && !orphanedFlatTargetByVisit.has(visitKey)) {
        orphanedFlatTargetByVisit.set(visitKey, `${allocation.paymentId}|${allocation.treatmentId}`);
      }
    });

  [...allocations]
    .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate) || a.paymentId.localeCompare(b.paymentId))
    .forEach((allocation) => {
      const treatment = treatmentById.get(allocation.treatmentId);
      if (!treatment?.doctorId || allocation.amount <= 0) return;
      const visitKey = `${treatment.doctorId}|${treatment.patientId}|${treatment.date}`;
      const exactExisting = existingByAllocation.get(`${allocation.paymentId}|${allocation.treatmentId}`);
      const existing = exactExisting
        || existingPercentageByVisitAndTreatment.get(`${visitKey}|${allocation.treatmentId}`);
      // Existing rows are immutable rate/mode snapshots. A later doctor setting
      // change applies to NEW payments, not previously earned amounts.
      const calculationMode = exactExisting?.calculationMode
        || (orphanedFlatTargetByVisit.get(visitKey) === `${allocation.paymentId}|${allocation.treatmentId}`
          ? 'flat_visit'
          : resolveTreatmentMode(treatment));

      if (calculationMode === 'flat_visit') {
        const candidates = flatCandidates.get(visitKey) || [];
        candidates.push({ ...allocation, treatment });
        flatCandidates.set(visitKey, candidates);
        return;
      }

      const rawRate = existing?.calculationMode === 'percentage'
        ? Number(existing.commissionRate || 0)
        : Number(treatment.customCommissionPercentage ?? treatment.commissionPercentage ?? 0);
      const rate = toPercentageRate(rawRate);
      percentageCandidates.push({ ...allocation, treatment, rate, visitKey });
      percentageTreatmentIds.add(treatment.id);
    });

  const percentageCandidatesByVisit = new Map<string, typeof percentageCandidates>();
  percentageCandidates.forEach((candidate) => {
    const candidates = percentageCandidatesByVisit.get(candidate.visitKey) || [];
    candidates.push(candidate);
    percentageCandidatesByVisit.set(candidate.visitKey, candidates);
  });

  percentageCandidatesByVisit.forEach((visitCandidates) => {
    const rates = new Set(visitCandidates.map((candidate) => candidate.rate));

    if (rates.size === 1) {
      const rate = visitCandidates[0].rate;
      const sample = visitCandidates[0].treatment;
      const visitMaterialCost = treatments.reduce((sum, treatment) => {
        const sameVisit = treatment.doctorId === sample.doctorId
          && treatment.patientId === sample.patientId
          && treatment.date === sample.date
          && percentageTreatmentIds.has(treatment.id);
        if (!sameVisit) return sum;

        const treatmentCandidate = visitCandidates.find(
          (candidate) => candidate.treatment.id === treatment.id
        );
        const treatmentRate = treatmentCandidate?.rate ?? toPercentageRate(
          treatment.customCommissionPercentage ?? treatment.commissionPercentage ?? 0
        );
        return treatmentRate === rate
          ? sum + toNonNegativeFiniteNumber(treatment.materialCost)
          : sum;
      }, 0);
      const visitCollected = roundMoney(visitCandidates.reduce(
        (sum, candidate) => sum + toNonNegativeFiniteNumber(candidate.amount),
        0
      ));
      const visitCommissionBase = roundMoney(Math.max(0, visitCollected - visitMaterialCost));
      const visitEarnings = roundMoney(visitCommissionBase * (rate / 100));
      let distributedBase = 0;
      let distributedEarnings = 0;

      visitCandidates.forEach((candidate, index) => {
        const { treatment, rate: _candidateRate, visitKey, ...allocation } = candidate;
        const isLast = index === visitCandidates.length - 1;
        const share = visitCollected > 0 ? candidate.amount / visitCollected : 0;
        const commissionBase = isLast
          ? roundMoney(visitCommissionBase - distributedBase)
          : roundMoney(visitCommissionBase * share);
        const earnings = isLast
          ? roundMoney(visitEarnings - distributedEarnings)
          : roundMoney(visitEarnings * share);
        distributedBase = roundMoney(distributedBase + commissionBase);
        distributedEarnings = roundMoney(distributedEarnings + earnings);

        percentageRows.push({
          ...allocation,
          doctorId: treatment.doctorId as string,
          patientId: treatment.patientId,
          treatmentDate: treatment.date,
          visitKey,
          calculationMode: 'percentage',
          commissionRate: rate,
          materialDeduction: roundMoney(Math.max(0, candidate.amount - commissionBase)),
          commissionBase,
          earnings
        });
      });
      return;
    }

    const materialRemainingByTreatment = new Map<string, number>();
    visitCandidates.forEach((candidate) => {
      const { treatment, rate, visitKey, ...allocation } = candidate;
      if (!materialRemainingByTreatment.has(treatment.id)) {
        materialRemainingByTreatment.set(
          treatment.id,
          toNonNegativeFiniteNumber(treatment.materialCost)
        );
      }
      const materialRemaining = materialRemainingByTreatment.get(treatment.id) || 0;
      const { materialDeduction, commissionBase } = calculatePercentageCommissionBase(
        candidate.amount,
        materialRemaining
      );
      materialRemainingByTreatment.set(
        treatment.id,
        roundMoney(materialRemaining - materialDeduction)
      );
      percentageRows.push({
        ...allocation,
        doctorId: treatment.doctorId as string,
        patientId: treatment.patientId,
        treatmentDate: treatment.date,
        visitKey,
        calculationMode: 'percentage',
        commissionRate: rate,
        materialDeduction,
        commissionBase,
        earnings: roundMoney(commissionBase * (rate / 100))
      });
    });
  });

  const flatRows: CalculatedCommissionEntry[] = [];
  flatCandidates.forEach((candidates, visitKey) => {
    const sorted = [...candidates].sort((a, b) => (
      a.paymentDate.localeCompare(b.paymentDate) ||
      a.paymentId.localeCompare(b.paymentId) ||
      a.treatment.id.localeCompare(b.treatment.id)
    ));
    const existing = existingEntries.find((entry) => (
      entry.calculationMode === 'flat_visit' && entry.visitKey === visitKey
    )) || existingEntries.find((entry) => (
      entry.calculationMode === 'flat_visit' && candidates.some((candidate) => (
        candidate.paymentId === entry.paymentId && candidate.treatment.id === entry.treatmentId
      ))
    ));
    const selected = existing
      ? sorted.find((candidate) => candidate.paymentId === existing.paymentId && candidate.treatment.id === existing.treatmentId) || sorted[0]
      : sorted[0];
    if (!selected?.treatment.doctorId) return;
    const rawFlatAmount = existing
      ? Number(existing.commissionRate || 0)
      : Math.max(0, Number(selected.treatment.commissionPerVisit || 0));
    const flatAmount = toNonNegativeFiniteNumber(rawFlatAmount);

    flatRows.push({
      paymentId: selected.paymentId,
      treatmentId: selected.treatment.id,
      paymentDate: selected.paymentDate,
      amount: selected.amount,
      doctorId: selected.treatment.doctorId,
      patientId: selected.treatment.patientId,
      treatmentDate: selected.treatment.date,
      visitKey,
      calculationMode: 'flat_visit',
      commissionRate: flatAmount,
      materialDeduction: 0,
      commissionBase: selected.amount,
      earnings: roundMoney(flatAmount)
    });
  });

  return [...percentageRows, ...flatRows].sort((a, b) => (
    a.paymentDate.localeCompare(b.paymentDate) ||
    a.paymentId.localeCompare(b.paymentId) ||
    a.treatmentId.localeCompare(b.treatmentId)
  ));
};
