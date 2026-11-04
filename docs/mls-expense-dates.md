# MLS expense dates

## Staff workflow

Each Material, Lab, or Special Doctor item has an **Expense Date**. New items
default to the browser's local date; choose the actual date for the clinic's
reporting policy. This date is independent of the original treatment and patient
payment dates, and does not represent a separate payment to a supplier.

Existing items retain their dates when reopened, saved, or edited. To correct an
already-entered late lab cost, open its original MLS record and change only that
item's Expense Date. Do not create another treatment, payment, or manual expense.

## Reporting

Professional Reporting loads MLS items by their Expense Date and selected branch,
including items attached to treatments/payments outside the selected period.
The PDF and Excel exports include a separate MLS expense ledger. Treatment and
payment records are not duplicated. Generated Material/Lab expenses are excluded
from operating expenses to prevent counting them twice. Special Doctor costs
remain MLS-only, matching the existing expense-generation policy.

Excel Treatment Detail includes expense-period MLS on the matching treatment
visit (same-patient, same-day treatments remain grouped). Treatment-linked costs
match by treatment ID; payment-linked costs match only an unambiguous original
patient/date/treatment visit. Costs with no matching displayed visit, including
late bills for older treatments, appear as cost-only MLS adjustment rows with
their expense date and original treatment date. These rows do not add production,
payments, patients, or treatments. Unassigned revenue and operating expenses have
separate reconciliation rows, so REPORT TOTAL revenue, MLS, total cost, net profit,
and net margin agree with the Executive Summary. The MLS Expenses sheet is a
reference ledger of those same costs, not an additional expense to add again.
PDF treatment detail continues to show pre-MLS contribution with a separate ledger.

The MLS overview and lifetime cost totals still describe the original activity;
they are not an expense-date ledger. Doctor commission calculation rules are
unchanged: saving MLS still schedules the existing commission recalculation.

## Database rollout

For the Doctor Dashboard MLS fix, also apply
`20261104010000_doctor_dashboard_mls_scope.sql` after the expense-date migration
and before deploying the application. It appends stable clinician IDs to the
existing security-invoker report view without changing cost amounts or commission.
The dashboard loads both payment- and treatment-linked costs by expense date
(whole boundary days), including late bills for older treatments. Branch totals
use the cost source's branch. A shared payment's cost appears once for each
involved clinician; these dashboard totals must not be summed across clinicians.
This is an associated-cost display, not a new allocation or commission deduction.
Professional Reporting retains one ledger row per cost and its combined clinician
group for shared payments. Failed cost queries show Unavailable rather than zero.

Apply `20261104000000_mls_expense_dates.sql` before releasing the new application.
It is transactional, uses bounded lock/statement timeouts, and backfills existing
items using their original payment or treatment date. It deliberately does not
guess historical dates from creation timestamps or rewrite historical expenses.
If an original date cannot be found, the migration aborts.

Old open browser versions cannot save nonempty MLS lists without explicit dates;
the database returns an instruction to reload/upgrade rather than silently moving
costs. Refresh open browsers after deployment. Empty-list saves still mean
intentional removal of all costs, as before.

Do not roll back the database schema after dated costs have been entered: the old
single-date model cannot represent them. Prefer a forward fix. Back up affected
rows and the existing RPC definition before applying the migration. Do not commit
database credentials or production backups.

The SQL integration fixtures in `supabase/tests/mls_expense_dates.sql` use
synthetic data and end with ROLLBACK. Review database triggers before running them
against an environment with external trigger side effects. The rerun harness in
the same directory checks that repeated migrations preserve stored data.