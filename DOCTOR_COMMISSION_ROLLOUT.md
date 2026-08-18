# Doctor commission method rollout

## Required deployment order

The application reads and writes `doctors.commission_type`. Apply
`supabase/migrations/20260803000000_add_doctor_commission_type.sql` **before**
deploying this application version. Do not deploy application code first.

Use a short maintenance window for doctor create/update operations so an older
client cannot create a doctor between the legacy backfill and application
deployment. Existing application versions continue to work after the column is
added because their existing columns and behavior are retained.

## Preflight

1. Back up the production database.
2. Inventory distinct doctor specializations and confirm the legacy backfill:
   exact `Ortho`, `Implant`, and `Surgery` values become `flat_visit`; all other
   existing doctors become `percentage`.
3. Confirm no unreviewed mapping exceptions with clinic finance/operations.

## Verification before application deployment

Confirm all of the following through SQL and the same anon/authenticated Data
API path used by the application:

- every doctor has `commission_type` equal to `percentage` or `flat_visit`;
- `commission_per_visit` is non-null and non-negative;
- `get_applicable_commission_rate` returns the fixed amount for a fixed doctor
  and the custom/default rate for a percentage doctor;
- PostgREST can select `commission_type` after the schema reload.

Then deploy the application, create/edit one percentage doctor and one fixed
doctor, process a controlled payment, and verify the ledger/report result.

## Rollback

Roll back the application first. The added column is backward-compatible and
should remain in place during an application rollback. Do not drop it or rewrite
historical `doctor_commission_entries` during an incident. Correct configuration
and redeploy after diagnosis.