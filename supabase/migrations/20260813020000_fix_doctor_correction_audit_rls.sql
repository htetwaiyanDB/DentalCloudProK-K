BEGIN;

-- The correction RPC is SECURITY DEFINER, but this table is FORCE RLS.  Without
-- an INSERT policy PostgreSQL rejects the audit write made by the RPC, which
-- rolls back the whole doctor reassignment.  Table privileges stay revoked for
-- client roles, so this policy only enables the audited server-side workflow.
DROP POLICY IF EXISTS doctor_assignment_corrections_insert_via_rpc
  ON public.doctor_assignment_corrections;

CREATE POLICY doctor_assignment_corrections_insert_via_rpc
  ON public.doctor_assignment_corrections
  FOR INSERT
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
COMMIT;
