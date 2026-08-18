BEGIN;

ALTER TABLE public.treatments
  ADD COLUMN IF NOT EXISTS appointment_id UUID;

ALTER TABLE public.treatments
  DROP CONSTRAINT IF EXISTS treatments_appointment_id_fkey;
ALTER TABLE public.treatments
  ADD CONSTRAINT treatments_appointment_id_fkey
  FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_treatments_appointment_id
  ON public.treatments (appointment_id);

CREATE TABLE IF NOT EXISTS public.doctor_assignment_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_token UUID NOT NULL UNIQUE,
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  old_doctor_id UUID REFERENCES public.doctors(id) ON DELETE RESTRICT,
  new_doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  treatment_ids UUID[] NOT NULL DEFAULT '{}'::UUID[],
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 1000),
  corrected_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  corrected_by_user_name TEXT NOT NULL,
  before_snapshot JSONB NOT NULL,
  after_snapshot JSONB NOT NULL,
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT doctor_assignment_corrections_doctor_change_check
    CHECK (old_doctor_id IS DISTINCT FROM new_doctor_id)
);

CREATE INDEX IF NOT EXISTS idx_doctor_assignment_corrections_appointment
  ON public.doctor_assignment_corrections (appointment_id, corrected_at DESC);
CREATE INDEX IF NOT EXISTS idx_doctor_assignment_corrections_patient
  ON public.doctor_assignment_corrections (patient_id, corrected_at DESC);

CREATE OR REPLACE FUNCTION public.lock_patient_financial_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.patient_id::TEXT, 0));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_patient_financial_mutation ON public.payments;
CREATE TRIGGER trg_lock_patient_financial_mutation
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.lock_patient_financial_mutation();

ALTER TABLE public.doctor_assignment_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_assignment_corrections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_assignment_corrections FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_doctor_assignment_correction_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Doctor assignment correction history is immutable.' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_doctor_assignment_correction_update ON public.doctor_assignment_corrections;
CREATE TRIGGER trg_prevent_doctor_assignment_correction_update
  BEFORE UPDATE ON public.doctor_assignment_corrections
  FOR EACH ROW EXECUTE FUNCTION public.prevent_doctor_assignment_correction_mutation();
DROP TRIGGER IF EXISTS trg_prevent_doctor_assignment_correction_delete ON public.doctor_assignment_corrections;
CREATE TRIGGER trg_prevent_doctor_assignment_correction_delete
  BEFORE DELETE ON public.doctor_assignment_corrections
  FOR EACH ROW EXECUTE FUNCTION public.prevent_doctor_assignment_correction_mutation();

CREATE OR REPLACE FUNCTION public.require_visit_correction_admin(
  p_admin_user_id UUID,
  p_session_token TEXT,
  p_location_id UUID
)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
BEGIN
  SELECT u.* INTO v_admin
  FROM public.users AS u
  JOIN public.staff_auth_sessions AS session
    ON session.user_id = u.id
  WHERE u.id = p_admin_user_id
    AND u.role = 'admin'
    AND u.doctor_id IS NULL
    AND (u.location_id IS NULL OR u.location_id = p_location_id)
    AND session.session_token::TEXT = btrim(COALESCE(p_session_token, ''))
    AND session.revoked_at IS NULL
    AND session.expires_at > NOW()
  ORDER BY session.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A valid administrator session for this location is required.' USING ERRCODE = '42501';
  END IF;
  RETURN v_admin;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_visit_doctor_correction(
  p_appointment_id UUID,
  p_admin_user_id UUID,
  p_session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
  v_admin public.users%ROWTYPE;
  v_patient_name TEXT;
  v_old_doctor_name TEXT;
  v_treatments JSONB;
BEGIN
  SELECT * INTO v_appointment
  FROM public.appointments
  WHERE id = p_appointment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appointment not found.'; END IF;
  IF v_appointment.patient_id IS NULL THEN
    RAISE EXCEPTION 'Register the patient before correcting a completed visit doctor.';
  END IF;

  v_admin := public.require_visit_correction_admin(p_admin_user_id, p_session_token, v_appointment.location_id);
  SELECT name INTO v_patient_name FROM public.patients WHERE id = v_appointment.patient_id;
  SELECT name INTO v_old_doctor_name FROM public.doctors WHERE id = v_appointment.doctor_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', treatment.id,
    'description', COALESCE(NULLIF(btrim(treatment.description), ''), 'Treatment'),
    'date', treatment.date,
    'doctor_id', treatment.doctor_id,
    'linked_to_appointment', treatment.appointment_id = v_appointment.id,
    'has_financial_history', EXISTS (
      SELECT 1 FROM public.doctor_commission_entries AS entry WHERE entry.treatment_id = treatment.id
    ) OR EXISTS (
      SELECT 1 FROM public.payments AS payment
      WHERE treatment.id = ANY(COALESCE(payment.treatment_ids, '{}'::UUID[]))
        OR COALESCE(payment.receipt_snapshot -> 'treatments', '[]'::JSONB) @> jsonb_build_array(jsonb_build_object('id', treatment.id::TEXT))
    )
  ) ORDER BY treatment.date, treatment.created_at, treatment.id), '[]'::JSONB)
  INTO v_treatments
  FROM public.treatments AS treatment
  WHERE treatment.patient_id = v_appointment.patient_id
    AND treatment.location_id = v_appointment.location_id
    AND treatment.date = v_appointment.date
    AND (
      treatment.appointment_id = v_appointment.id
      OR (treatment.appointment_id IS NULL AND treatment.doctor_id IS NOT DISTINCT FROM v_appointment.doctor_id)
    );

  RETURN jsonb_build_object(
    'appointment_id', v_appointment.id,
    'patient_id', v_appointment.patient_id,
    'patient_name', COALESCE(v_patient_name, 'Unknown patient'),
    'location_id', v_appointment.location_id,
    'visit_date', v_appointment.date,
    'visit_time', v_appointment.time,
    'status', v_appointment.status,
    'old_doctor_id', v_appointment.doctor_id,
    'old_doctor_name', v_old_doctor_name,
    'treatments', v_treatments
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.correct_visit_doctor_atomic(
  p_appointment_id UUID,
  p_expected_old_doctor_id UUID,
  p_new_doctor_id UUID,
  p_treatment_ids UUID[],
  p_reason TEXT,
  p_admin_user_id UUID,
  p_session_token TEXT,
  p_request_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
  v_admin public.users%ROWTYPE;
  v_existing public.doctor_assignment_corrections%ROWTYPE;
  v_correction_id UUID;
  v_treatment_ids UUID[] := COALESCE(p_treatment_ids, '{}'::UUID[]);
  v_treatment_count INTEGER := 0;
  v_audit_count INTEGER := 0;
  v_before JSONB;
  v_after JSONB;
BEGIN
  IF p_request_token IS NULL THEN RAISE EXCEPTION 'Request token is required.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_token::TEXT, 0));
  SELECT * INTO v_existing FROM public.doctor_assignment_corrections WHERE request_token = p_request_token;
  IF FOUND THEN
    v_admin := public.require_visit_correction_admin(p_admin_user_id, p_session_token, v_existing.location_id);
    IF v_existing.appointment_id IS DISTINCT FROM p_appointment_id
       OR v_existing.new_doctor_id IS DISTINCT FROM p_new_doctor_id THEN
      RAISE EXCEPTION 'This request token was already used for a different correction.' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'status', 'success', 'correction_id', v_existing.id, 'appointment_id', v_existing.appointment_id,
      'old_doctor_id', v_existing.old_doctor_id, 'new_doctor_id', v_existing.new_doctor_id,
      'updated_treatment_count', cardinality(v_existing.treatment_ids), 'updated_audit_count', 0
    );
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Correction reason must contain between 10 and 1000 characters.';
  END IF;

  SELECT * INTO v_appointment FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appointment not found.'; END IF;
  IF v_appointment.patient_id IS NULL THEN RAISE EXCEPTION 'Only registered patient visits can be corrected.'; END IF;
  v_admin := public.require_visit_correction_admin(p_admin_user_id, p_session_token, v_appointment.location_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_appointment.patient_id::TEXT, 0));

  IF v_appointment.doctor_id IS DISTINCT FROM p_expected_old_doctor_id THEN
    RAISE EXCEPTION 'This appointment changed after the correction dialog was opened. Refresh and review it again.' USING ERRCODE = '40001';
  END IF;
  IF p_new_doctor_id IS NULL OR p_new_doctor_id IS NOT DISTINCT FROM v_appointment.doctor_id THEN
    RAISE EXCEPTION 'Select a different doctor.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.doctors AS doctor
    WHERE doctor.id = p_new_doctor_id
      AND (doctor.location_id = v_appointment.location_id OR EXISTS (
        SELECT 1 FROM public.doctor_locations AS assignment
        WHERE assignment.doctor_id = doctor.id AND assignment.location_id = v_appointment.location_id
      ))
  ) THEN RAISE EXCEPTION 'The selected doctor is not assigned to this location.'; END IF;

  PERFORM 1 FROM public.treatments WHERE id = ANY(v_treatment_ids) ORDER BY id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM unnest(v_treatment_ids) AS selected(id)
    LEFT JOIN public.treatments AS treatment ON treatment.id = selected.id
    WHERE treatment.id IS NULL
      OR treatment.patient_id IS DISTINCT FROM v_appointment.patient_id
      OR treatment.location_id IS DISTINCT FROM v_appointment.location_id
      OR treatment.date IS DISTINCT FROM v_appointment.date
      OR (treatment.appointment_id IS NOT NULL AND treatment.appointment_id IS DISTINCT FROM v_appointment.id)
      OR treatment.doctor_id IS DISTINCT FROM v_appointment.doctor_id
  ) THEN RAISE EXCEPTION 'One or more selected treatments no longer belong to this visit. Refresh and review again.'; END IF;

  IF EXISTS (SELECT 1 FROM public.doctor_commission_entries WHERE treatment_id = ANY(v_treatment_ids))
     OR EXISTS (
       SELECT 1 FROM public.payments AS payment, unnest(v_treatment_ids) AS selected(id)
       WHERE selected.id = ANY(COALESCE(payment.treatment_ids, '{}'::UUID[]))
          OR COALESCE(payment.receipt_snapshot -> 'treatments', '[]'::JSONB) @> jsonb_build_array(jsonb_build_object('id', selected.id::TEXT))
     ) THEN
    RAISE EXCEPTION 'Paid treatments cannot be reassigned here because their doctor commission ledger requires a separate financial correction.' USING ERRCODE = '23514';
  END IF;

  SELECT jsonb_build_object(
    'appointment', to_jsonb(v_appointment),
    'treatments', COALESCE(jsonb_agg(to_jsonb(treatment) ORDER BY treatment.id) FILTER (WHERE treatment.id IS NOT NULL), '[]'::JSONB)
  ) INTO v_before
  FROM public.treatments AS treatment WHERE treatment.id = ANY(v_treatment_ids);

  UPDATE public.appointments SET doctor_id = p_new_doctor_id WHERE id = v_appointment.id;
  UPDATE public.treatments
  SET doctor_id = p_new_doctor_id, appointment_id = v_appointment.id, doctor_earnings = 0
  WHERE id = ANY(v_treatment_ids);
  GET DIAGNOSTICS v_treatment_count = ROW_COUNT;

  UPDATE public.audit_logs
  SET doctor_id = p_new_doctor_id
  WHERE (source_type = 'appointment' AND source_id = v_appointment.id)
     OR (source_type = 'treatment' AND source_id = ANY(v_treatment_ids));
  GET DIAGNOSTICS v_audit_count = ROW_COUNT;

  SELECT jsonb_build_object(
    'appointment', to_jsonb(appointment),
    'treatments', COALESCE((SELECT jsonb_agg(to_jsonb(treatment) ORDER BY treatment.id) FROM public.treatments AS treatment WHERE treatment.id = ANY(v_treatment_ids)), '[]'::JSONB)
  ) INTO v_after
  FROM public.appointments AS appointment WHERE appointment.id = v_appointment.id;

  INSERT INTO public.doctor_assignment_corrections (
    request_token, appointment_id, location_id, patient_id, old_doctor_id, new_doctor_id,
    treatment_ids, reason, corrected_by_user_id, corrected_by_user_name, before_snapshot, after_snapshot
  ) VALUES (
    p_request_token, v_appointment.id, v_appointment.location_id, v_appointment.patient_id,
    v_appointment.doctor_id, p_new_doctor_id, v_treatment_ids, btrim(p_reason),
    v_admin.id, v_admin.username, v_before, v_after
  ) RETURNING id INTO v_correction_id;

  RETURN jsonb_build_object(
    'status', 'success', 'correction_id', v_correction_id, 'appointment_id', v_appointment.id,
    'old_doctor_id', v_appointment.doctor_id, 'new_doctor_id', p_new_doctor_id,
    'updated_treatment_count', v_treatment_count, 'updated_audit_count', v_audit_count
  );
END;
$$;

-- Link new treatments only when exactly one completed appointment matches.
-- Ambiguous same-day visits remain unlinked for explicit administrator review.
CREATE OR REPLACE FUNCTION public.link_new_treatment_to_completed_appointment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_candidate_count INTEGER;
BEGIN
  IF NEW.appointment_id IS NULL THEN
    SELECT COUNT(*) INTO v_candidate_count
    FROM public.appointments AS appointment
    WHERE appointment.location_id = NEW.location_id
      AND appointment.patient_id = NEW.patient_id
      AND appointment.date = NEW.date
      AND appointment.status = 'Completed'
      AND appointment.doctor_id IS NOT DISTINCT FROM NEW.doctor_id;
    IF v_candidate_count = 1 THEN
      SELECT appointment.id INTO NEW.appointment_id
      FROM public.appointments AS appointment
      WHERE appointment.location_id = NEW.location_id
        AND appointment.patient_id = NEW.patient_id
        AND appointment.date = NEW.date
        AND appointment.status = 'Completed'
        AND appointment.doctor_id IS NOT DISTINCT FROM NEW.doctor_id
      ORDER BY appointment.time, appointment.id
      LIMIT 1;
      UPDATE public.treatments SET appointment_id = NEW.appointment_id WHERE id = NEW.id;
    ELSE
      NEW.appointment_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_new_treatment_to_completed_appointment ON public.treatments;
CREATE CONSTRAINT TRIGGER trg_link_new_treatment_to_completed_appointment
  AFTER INSERT ON public.treatments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.link_new_treatment_to_completed_appointment();

REVOKE ALL ON FUNCTION public.require_visit_correction_admin(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.require_visit_correction_admin(UUID, TEXT, UUID) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.preview_visit_doctor_correction(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_visit_doctor_correction(UUID, UUID, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.correct_visit_doctor_atomic(UUID, UUID, UUID, UUID[], TEXT, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_visit_doctor_atomic(UUID, UUID, UUID, UUID[], TEXT, UUID, TEXT, UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;