-- Repair legacy doctor login accounts that have credentials in public.doctors
-- but no canonical public.users row. Safe to run repeatedly.

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS doctor_id UUID,
  ADD COLUMN IF NOT EXISTS allowed_tabs JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_doctor_id_fkey'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_doctor_id_fkey
      FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_doctor_id_unique_idx
  ON public.users(doctor_id)
  WHERE doctor_id IS NOT NULL;

-- Only insert accounts whose normalized doctor email is unique among doctors
-- and is not already owned by any staff user. Ambiguous rows are intentionally
-- skipped and reported by the verification queries below.
WITH eligible_doctors AS (
  SELECT d.*
  FROM public.doctors d
  WHERE NULLIF(btrim(d.email), '') IS NOT NULL
    AND NULLIF(btrim(d.password), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.users linked WHERE linked.doctor_id = d.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.users existing
      WHERE lower(btrim(existing.username)) = lower(btrim(d.email))
    )
    AND 1 = (
      SELECT COUNT(*)
      FROM public.doctors duplicate
      WHERE NULLIF(btrim(duplicate.password), '') IS NOT NULL
        AND lower(btrim(duplicate.email)) = lower(btrim(d.email))
    )
)
INSERT INTO public.users (location_id, doctor_id, username, password, role, allowed_tabs)
SELECT
  d.location_id,
  d.id,
  lower(btrim(d.email)),
  d.password,
  'normal',
  '["dashboard","appointments","records","settings"]'::jsonb
FROM eligible_doctors d
ON CONFLICT DO NOTHING;

COMMIT;

-- Post-migration verification. No password values are returned.
SELECT
  COUNT(*) FILTER (WHERE u.id IS NOT NULL) AS login_doctors_with_linked_user,
  COUNT(*) FILTER (WHERE u.id IS NULL) AS login_doctors_without_linked_user
FROM public.doctors d
LEFT JOIN public.users u ON u.doctor_id = d.id
WHERE NULLIF(btrim(d.email), '') IS NOT NULL
  AND NULLIF(btrim(d.password), '') IS NOT NULL;

SELECT
  d.id AS doctor_id,
  d.name AS doctor_name,
  d.email AS doctor_email,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.users existing
      WHERE lower(btrim(existing.username)) = lower(btrim(d.email))
        AND existing.doctor_id IS DISTINCT FROM d.id
    ) THEN 'USERNAME_CONFLICT'
    WHEN 1 < (
      SELECT COUNT(*) FROM public.doctors duplicate
      WHERE NULLIF(btrim(duplicate.password), '') IS NOT NULL
        AND lower(btrim(duplicate.email)) = lower(btrim(d.email))
    ) THEN 'DUPLICATE_DOCTOR_EMAIL'
    ELSE 'REQUIRES_MANUAL_REVIEW'
  END AS repair_status
FROM public.doctors d
LEFT JOIN public.users u ON u.doctor_id = d.id
WHERE NULLIF(btrim(d.email), '') IS NOT NULL
  AND NULLIF(btrim(d.password), '') IS NOT NULL
  AND u.id IS NULL
ORDER BY d.name;