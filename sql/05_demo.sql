-- =====================================================================
-- Insurance Management Database System  |  05 - DEMO / SMOKE TEST
-- Calls every procedure and function and fires every trigger, so you
-- can see the automation working. Changes data: re-run 01-03 to reset.
-- =====================================================================
USE insurance_db;

-- onboard a new customer with a policy in one call
CALL AddNewCustomerWithPolicy('Riya', 'Menon', 'riya.menon@example.com',
     SHA2('demo-password', 256), 'NID-555000111', 3, 1, 2400.00,
     CURDATE(), CURDATE() + INTERVAL 1 YEAR);

-- the onboarding is atomic. A duplicate email rolls back everything.
-- (Uncomment to see the error; no partial rows are left behind.)
-- CALL AddNewCustomerWithPolicy('Riya', 'Menon', 'riya.menon@example.com',
--      'x', 'NID-555000112', 3, 1, 100, CURDATE(), CURDATE() + INTERVAL 1 YEAR);

-- file a claim -> fires log_new_claim and trg_UpdatePolicyStatusOnClaim
CALL FileClaim(1, 350.00, CURDATE());
SELECT policy_id, status FROM Insurance_Policies WHERE policy_id = 1;
SELECT * FROM Logs ORDER BY log_id DESC LIMIT 3;

-- add a beneficiary
CALL AddBeneficiary(1, 1, 'Anaya Menon', 'child');

-- expire overdue policies (normally run daily by the event)
CALL ExpireOldPolicies();
SELECT status, COUNT(*) AS policies FROM Insurance_Policies GROUP BY status;

-- Functions
SELECT GetTotalPremiumPaid(1)      AS total_premium_paid,
       GetTotalClaims(1)           AS claims_on_policy_1,
       CalculateRiskFactor(1)      AS risk_factor,
       GetActivePolicyCount(1)     AS active_policies,
       CalculateAverageRating(1)   AS avg_rating_given,
       GetClaimStatusLabel(1)      AS claim_1_status,
       CountPoliciesByType('life') AS life_policies;

-- assign an existing policy to another customer; monthly summary
CALL AssignPolicyToCustomer(2, 1, 1);
CALL GetMonthlyClaimSummary(1, MONTH(CURDATE()), YEAR(CURDATE()));

-- deleting a customer's policy is logged
DELETE FROM Customer_Policies WHERE customer_id = 2 AND policy_id = 1;
SELECT * FROM Policy_Deletion_Log;

-- transfer a customer to another agent; audit trigger keeps old rows
CALL UpdateCustomerAgentPolicies(1, 2, (SELECT agent_id FROM Insurance_Policies WHERE policy_id = 1));
UPDATE Branches SET contact_number = '2125559999' WHERE branch_id = 1;
SELECT * FROM branches_audit;

-- role change is logged; adding a payment method is idempotent
CALL AssignUserRole(19, 'agent');
SELECT * FROM Logs WHERE action LIKE 'ROLE_UPDATE%';
SELECT * FROM users_audit;
CALL AddPaymentMethod('cash');
SELECT COUNT(*) AS payment_methods FROM Payment_Methods;

-- What's in the database
SHOW TRIGGERS;
SHOW PROCEDURE STATUS WHERE Db = DATABASE();
SHOW FUNCTION STATUS  WHERE Db = DATABASE();
