# Changelog

## Post-course fixes (November 2026)

Running the course submission (April 2025) end to end on MySQL 8.0 turned up the issues below.
Each one is fixed in `/sql` and marked in the code with `-- FIX:`.

### Errors that broke features

| Object | Problem | Fix |
|---|---|---|
| `AddBeneficiary` | A `- ====` comment line (one dash instead of two) caused a syntax error, so the procedure was never created | Corrected the comment |
| `trg_LogPolicyDeletion` | Wrote to `Policy_Deletion_Log`, a table that was never created, so **every delete on `Customer_Policies` failed** | Added the table to the schema |
| `trg_LogRoleChange`, `trg_LogClaimStatusInsert` | Inserted into `Logs` columns that don't exist (`activity_type`, `activity_description`, `activity_timestamp`), so **every role change failed**, including `AssignUserRole` | Write to `Logs(user_id, action)`; NULL-safe comparison so a first role assignment is also logged |
| `UpdateCustomerAgentPolicies` | Lowercase table names (`insurance_policies`) fail on Linux, where MySQL table names are case-sensitive; `in_current_agent_id` was never used; the `Agent_Customers` update could violate its UNIQUE key | Correct table names; only move policies the current agent sold; delete-then-insert the assignment |
| Audit tables | `role_id` and `branch_id` were `NOT NULL` in the audit tables but nullable in the source tables, and some sizes were smaller | Columns now match the source tables |

### Wrong results

| Query / object | Problem | Fix |
|---|---|---|
| Agent performance (Q1) | Joining `Agent_Customers` and `Insurance_Policies` in one query multiplied rows, so `SUM(policy_amount)` was inflated for any agent with more than one customer | Aggregate each side in its own subquery |
| `UserFeedbackView` | Joined `Users.user_id = Feedback.customer_id`. That only matched while user and customer IDs happened to line up | Join through `Customers` |
| Claimants with no active policy (Q6) | Joined `Claims` through a correlated subquery in the `ON` clause, which errors if a policy has 2+ holders | Plain joins plus `NOT EXISTS` |
| `CalculateRiskFactor` | The parameter was named `customer_id`, the same as the column it filtered on | Renamed to `in_customer_id` |
| `trg_UpdatePolicyStatusOnClaim` | Changed expired or cancelled policies to *under review* | Only flags *active* policies |
| Sample data | `INSERT IGNORE` silently dropped rows: a duplicate `national_id` and a link to a customer that didn't exist | New generated dataset (`tools/gen_seed.py`) with consistent roles and dates |

### Improvements

- `AddNewCustomerWithPolicy` now runs in a transaction with an error handler, so a failure part-way through (e.g. a duplicate email) rolls back all five inserts.
- `ExpireOldPolicies` also expires the matching `Customer_Policies` rows, so the two tables stay in sync.
- `Payments.payment_method_id` uses `ON DELETE SET NULL` instead of `CASCADE`, so removing a payment method can't erase payment history.
- Functions are declared `READS SQL DATA`, which MySQL 8 requires when binary logging is on.
- The single script is split into ordered files (`01`–`05`), with indexes on the date columns used in reports.
- Added a browser playground (GitHub Pages) that runs the whole database client-side.

Tested on MySQL 8.0.46 (binary logging on, `ONLY_FULL_GROUP_BY` on) and MariaDB 10.11.
