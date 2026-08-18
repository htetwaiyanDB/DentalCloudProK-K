-- One-time historical repair for percentage commissions.
-- Rule: (collected payment - material/lab cost) x commission rate.
-- Payment distribution matches the Material & Lab screen: a payment linked to
-- multiple treatments is split in proportion to treatment amounts.
-- Flat per-visit specialties (Ortho, Implant, Surgery) are excluded.
-- MANUAL ONE-TIME REPAIR: intentionally not named as an automatic Supabase
-- migration. Run this script before manual_20260802_02, which consumes its
-- recalculation snapshot. Do not rerun against production without review.

BEGIN;

CREATE TABLE IF NOT EXISTS public.doctor_earnings_backfill_20260802 AS
SELECT id AS treatment_id, doctor_earnings AS previous_doctor_earnings, NOW() AS backed_up_at
FROM public.treatments
WITH NO DATA;

INSERT INTO public.doctor_earnings_backfill_20260802 (treatment_id, previous_doctor_earnings, backed_up_at)
SELECT t.id, t.doctor_earnings, NOW()
FROM public.treatments AS t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.doctor_earnings_backfill_20260802 AS backup
  WHERE backup.treatment_id = t.id
);

CREATE TABLE IF NOT EXISTS public.doctor_commission_entries_backfill_20260802 AS
SELECT
  id AS commission_entry_id,
  material_deduction AS previous_material_deduction,
  commission_base AS previous_commission_base,
  earnings AS previous_earnings,
  NOW() AS backed_up_at
FROM public.doctor_commission_entries
WITH NO DATA;

INSERT INTO public.doctor_commission_entries_backfill_20260802 (
  commission_entry_id, previous_material_deduction, previous_commission_base, previous_earnings, backed_up_at
)
SELECT e.id, e.material_deduction, e.commission_base, e.earnings, NOW()
FROM public.doctor_commission_entries AS e
WHERE NOT EXISTS (
  SELECT 1
  FROM public.doctor_commission_entries_backfill_20260802 AS backup
  WHERE backup.commission_entry_id = e.id
);

DROP TABLE IF EXISTS public.recalculated_percentage_commissions_backfill_20260802;

CREATE TABLE public.recalculated_percentage_commissions_backfill_20260802 AS
WITH payment_targets AS (
  SELECT
    payment.id AS payment_id,
    treatment.id AS treatment_id,
    GREATEST(
      0,
      COALESCE(payment.cleared_amount, payment.amount, 0)
      - COALESCE(NULLIF(payment.receipt_snapshot #>> '{payment,serviceFeeAmount}', '')::NUMERIC, 0)
    ) AS collected_payment,
    GREATEST(0, COALESCE(treatment.cost, 0)) AS treatment_amount
  FROM public.payments AS payment
  JOIN public.treatments AS treatment ON (
    (COALESCE(cardinality(payment.treatment_ids), 0) > 0 AND treatment.id = ANY(payment.treatment_ids))
    OR (
      COALESCE(cardinality(payment.treatment_ids), 0) = 0
      AND payment.receipt_snapshot @> jsonb_build_object('treatments', jsonb_build_array(jsonb_build_object('id', treatment.id::TEXT)))
    )
    OR (
      COALESCE(cardinality(payment.treatment_ids), 0) = 0
      AND COALESCE(payment.receipt_snapshot -> 'treatments', '[]'::JSONB) = '[]'::JSONB
      AND treatment.patient_id = payment.patient_id
      AND treatment.date = payment.payment_date
    )
  )
), payment_totals AS (
  SELECT
    payment_id,
    SUM(treatment_amount) AS total_treatment_amount,
    COUNT(*) AS linked_treatment_count
  FROM payment_targets
  GROUP BY payment_id
), payment_allocations AS (
  SELECT
    target.treatment_id,
    SUM(
      CASE
        WHEN totals.total_treatment_amount > 0
          THEN target.collected_payment * target.treatment_amount / totals.total_treatment_amount
        ELSE target.collected_payment / NULLIF(totals.linked_treatment_count, 0)
      END
    ) AS collected_payment
  FROM payment_targets AS target
  JOIN payment_totals AS totals ON totals.payment_id = target.payment_id
  GROUP BY target.treatment_id
), material_costs AS (
  SELECT audit.source_id AS treatment_id, COALESCE(SUM(cost.total_amount), 0) AS material_lab_cost
  FROM public.audit_logs AS audit
  JOIN public.patient_material_costs AS cost ON cost.audit_log_id = audit.id
  WHERE audit.source_type = 'treatment'
  GROUP BY audit.source_id
), percentage_treatments AS (
  SELECT
    treatment.id AS treatment_id,
    GREATEST(0, COALESCE(payment_allocations.collected_payment, 0)) AS collected_payment,
    GREATEST(0, COALESCE(material_costs.material_lab_cost, 0)) AS material_lab_cost,
    COALESCE(
      (
        SELECT entry.commission_rate
        FROM public.doctor_commission_entries AS entry
        WHERE entry.treatment_id = treatment.id
          AND entry.calculation_mode = 'percentage'
        ORDER BY entry.payment_date, entry.created_at, entry.id
        LIMIT 1
      ),
      custom_rate.commission_rate,
      doctor.commission_percentage,
      0
    ) AS commission_rate
  FROM public.treatments AS treatment
  JOIN public.doctors AS doctor ON doctor.id = treatment.doctor_id
  LEFT JOIN payment_allocations ON payment_allocations.treatment_id = treatment.id
  LEFT JOIN material_costs ON material_costs.treatment_id = treatment.id
  LEFT JOIN public.doctor_treatment_commissions AS custom_rate
    ON custom_rate.doctor_id = treatment.doctor_id
   AND custom_rate.treatment_id = treatment.treatment_type_id
  WHERE COALESCE(BTRIM(doctor.specialization), '') NOT IN ('Ortho', 'Implant', 'Surgery')
)
SELECT
  treatment_id,
  collected_payment,
  material_lab_cost,
  commission_rate,
  ROUND(GREATEST(0, collected_payment - material_lab_cost) * (commission_rate / 100.0), 2) AS earnings
FROM percentage_treatments;

UPDATE public.treatments AS treatment
SET doctor_earnings = recalculated.earnings
FROM public.recalculated_percentage_commissions_backfill_20260802 AS recalculated
WHERE treatment.id = recalculated.treatment_id;

WITH ledger_totals AS (
  SELECT treatment_id, SUM(allocated_payment) AS allocated_payment_total
  FROM public.doctor_commission_entries
  WHERE calculation_mode = 'percentage'
  GROUP BY treatment_id
), recalculated_entries AS (
  SELECT
    entry.id,
    entry.allocated_payment,
    entry.commission_rate,
    recalculated.earnings AS treatment_earnings,
    ledger_totals.allocated_payment_total
  FROM public.doctor_commission_entries AS entry
  JOIN public.recalculated_percentage_commissions_backfill_20260802 AS recalculated ON recalculated.treatment_id = entry.treatment_id
  JOIN ledger_totals ON ledger_totals.treatment_id = entry.treatment_id
  WHERE entry.calculation_mode = 'percentage'
)
UPDATE public.doctor_commission_entries AS entry
SET
  earnings = ROUND(
    recalculated.treatment_earnings * entry.allocated_payment / NULLIF(recalculated.allocated_payment_total, 0),
    2
  ),
  commission_base = CASE
    WHEN entry.commission_rate > 0 THEN ROUND(
      recalculated.treatment_earnings * entry.allocated_payment / NULLIF(recalculated.allocated_payment_total, 0)
      / (entry.commission_rate / 100.0),
      2
    )
    ELSE 0
  END,
  material_deduction = GREATEST(
    0,
    entry.allocated_payment - CASE
      WHEN entry.commission_rate > 0 THEN ROUND(
        recalculated.treatment_earnings * entry.allocated_payment / NULLIF(recalculated.allocated_payment_total, 0)
        / (entry.commission_rate / 100.0),
        2
      )
      ELSE 0
    END
  )
FROM recalculated_entries AS recalculated
WHERE entry.id = recalculated.id;

COMMIT;
