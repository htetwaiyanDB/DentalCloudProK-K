-- Correct the first historical backfill for visits containing several
-- treatments. Material/lab cost is deducted once from the whole
-- patient + doctor + treatment-date visit, then the resulting commission is
-- distributed across that visit's treatments by their collected-payment share.
-- This is the same total shown by Material & Lab.
-- MANUAL ONE-TIME REPAIR: depends on
-- manual_20260802_01_recalculate_historical_percentage_commissions_by_visit.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS public.doctor_earnings_visit_group_backup_20260802 AS
SELECT id AS treatment_id, doctor_earnings AS previous_doctor_earnings, NOW() AS backed_up_at
FROM public.treatments
WITH NO DATA;

INSERT INTO public.doctor_earnings_visit_group_backup_20260802 (treatment_id, previous_doctor_earnings, backed_up_at)
SELECT t.id, t.doctor_earnings, NOW()
FROM public.treatments AS t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.doctor_earnings_visit_group_backup_20260802 AS backup
  WHERE backup.treatment_id = t.id
);

DROP TABLE IF EXISTS public.doctor_visit_commission_correction_20260802;

CREATE TABLE public.doctor_visit_commission_correction_20260802 AS
WITH visit_totals AS (
  SELECT
    treatment.patient_id,
    treatment.doctor_id,
    treatment.date,
    SUM(recalculated.collected_payment) AS collected_payment,
    SUM(recalculated.material_lab_cost) AS material_lab_cost,
    MIN(recalculated.commission_rate) AS commission_rate,
    MAX(recalculated.commission_rate) AS max_commission_rate
  FROM public.recalculated_percentage_commissions_backfill_20260802 AS recalculated
  JOIN public.treatments AS treatment ON treatment.id = recalculated.treatment_id
  GROUP BY treatment.patient_id, treatment.doctor_id, treatment.date
  HAVING MIN(recalculated.commission_rate) = MAX(recalculated.commission_rate)
), provisional AS (
  SELECT
    recalculated.treatment_id,
    treatment.patient_id,
    treatment.doctor_id,
    treatment.date AS treatment_date,
    recalculated.collected_payment,
    visit.collected_payment AS visit_collected_payment,
    ROUND(
      GREATEST(0, visit.collected_payment - visit.material_lab_cost)
      * (visit.commission_rate / 100.0),
      2
    ) AS visit_earnings,
    ROW_NUMBER() OVER (
      PARTITION BY treatment.patient_id, treatment.doctor_id, treatment.date
      ORDER BY treatment.id
    ) AS row_number,
    COUNT(*) OVER (
      PARTITION BY treatment.patient_id, treatment.doctor_id, treatment.date
    ) AS treatment_count,
    ROUND(
      CASE
        WHEN visit.collected_payment > 0
          THEN GREATEST(0, visit.collected_payment - visit.material_lab_cost)
            * (visit.commission_rate / 100.0)
            * recalculated.collected_payment / visit.collected_payment
        ELSE 0
      END,
      2
    ) AS provisional_earnings
  FROM public.recalculated_percentage_commissions_backfill_20260802 AS recalculated
  JOIN public.treatments AS treatment ON treatment.id = recalculated.treatment_id
  JOIN visit_totals AS visit
    ON visit.patient_id = treatment.patient_id
   AND visit.doctor_id = treatment.doctor_id
   AND visit.date = treatment.date
), distributed AS (
  SELECT
    treatment_id,
    CASE
      WHEN row_number = treatment_count THEN visit_earnings - COALESCE(
        SUM(provisional_earnings) OVER (
          PARTITION BY patient_id, doctor_id, treatment_date
          ORDER BY row_number
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ),
        0
      )
      ELSE provisional_earnings
    END AS earnings
  FROM provisional
)
SELECT treatment_id, ROUND(GREATEST(0, earnings), 2) AS earnings
FROM distributed;

UPDATE public.treatments AS treatment
SET doctor_earnings = correction.earnings
FROM public.doctor_visit_commission_correction_20260802 AS correction
WHERE treatment.id = correction.treatment_id;

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
    correction.earnings AS treatment_earnings,
    totals.allocated_payment_total
  FROM public.doctor_commission_entries AS entry
  JOIN public.doctor_visit_commission_correction_20260802 AS correction
    ON correction.treatment_id = entry.treatment_id
  JOIN ledger_totals AS totals ON totals.treatment_id = entry.treatment_id
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
