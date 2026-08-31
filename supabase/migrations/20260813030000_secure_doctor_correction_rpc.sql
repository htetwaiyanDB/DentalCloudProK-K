BEGIN;

-- This RPC writes to protected audit and clinical tables.  It must execute as
-- its owner after it validates the supplied administrator session internally.
ALTER FUNCTION public.correct_visit_doctor_atomic(
  UUID, UUID, UUID, UUID[], TEXT, UUID, TEXT, UUID
) SECURITY DEFINER;

ALTER FUNCTION public.correct_visit_doctor_atomic(
  UUID, UUID, UUID, UUID[], TEXT, UUID, TEXT, UUID
) SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.correct_visit_doctor_atomic(UUID, UUID, UUID, UUID[], TEXT, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_visit_doctor_atomic(UUID, UUID, UUID, UUID[], TEXT, UUID, TEXT, UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
