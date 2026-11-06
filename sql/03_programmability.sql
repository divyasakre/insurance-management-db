-- =====================================================================
-- Insurance Management Database System  |  03 - PROGRAMMABILITY
-- Views, triggers, stored procedures, functions and a scheduled event.
-- Post-submission fixes are marked "-- FIX:" (see CHANGELOG.md).
-- Run after 01_schema.sql and 02_seed_data.sql.
-- =====================================================================
USE insurance_db;

-- =====================================================================
-- VIEW  Customer feedback, searchable by last name
-- FIX: the original joined Users.user_id = Feedback.customer_id, which
--      matches the wrong person once user and customer ids diverge.
--      It now joins Feedback -> Customers -> Users.
-- =====================================================================
CREATE OR REPLACE VIEW UserFeedbackView AS
SELECT
    u.last_name,
    u.first_name,
    f.feedback_id,
    f.comments,
    f.rating,
    f.submitted_at
FROM Feedback  f
JOIN Customers c ON f.customer_id = c.customer_id
JOIN Users     u ON c.user_id     = u.user_id;


DELIMITER $$


-- Trigger: log_new_claim
-- Writes a Logs entry (attributed to the policy's agent) whenever a
-- claim is filed.
CREATE TRIGGER log_new_claim
AFTER INSERT ON Claims
FOR EACH ROW
BEGIN
    INSERT INTO Logs (user_id, action)
    VALUES (
        (SELECT a.user_id
           FROM Insurance_Policies ip
           JOIN Agents a ON ip.agent_id = a.agent_id
          WHERE ip.policy_id = NEW.policy_id),
        CONCAT('Filed claim ID ', NEW.claim_id)
    );
END$$

-- Procedure: AddNewCustomerWithPolicy
-- One call onboards a customer: user account -> customer record ->
-- policy -> customer/policy link -> agent assignment.
-- FIX/IMPROVEMENT: wrapped in a transaction with an error handler, so a
--      failure half-way (e.g. duplicate email) rolls everything back
--      instead of leaving orphan rows.
CREATE PROCEDURE AddNewCustomerWithPolicy(
    IN fname        VARCHAR(50),
    IN lname        VARCHAR(50),
    IN p_email      VARCHAR(100),
    IN passhash     VARCHAR(255),
    IN nationalID   VARCHAR(20),
    IN agentID      INT,
    IN policyTypeID INT,
    IN amount       DECIMAL(10,2),
    IN startDate    DATE,
    IN endDate      DATE
)
BEGIN
    DECLARE userID     INT;
    DECLARE customerID INT;
    DECLARE policyID   INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    INSERT INTO Users (first_name, last_name, email, password_hash, role_id)
    VALUES (fname, lname, p_email, passhash,
            (SELECT role_id FROM User_Roles WHERE role_name = 'customer'));
    SET userID = LAST_INSERT_ID();

    INSERT INTO Customers (user_id, national_id)
    VALUES (userID, nationalID);
    SET customerID = LAST_INSERT_ID();

    INSERT INTO Insurance_Policies (policy_type_id, agent_id, policy_amount, start_date, end_date, status)
    VALUES (policyTypeID, agentID, amount, startDate, endDate, 'active');
    SET policyID = LAST_INSERT_ID();

    INSERT INTO Customer_Policies (customer_id, policy_id, start_date, end_date, status)
    VALUES (customerID, policyID, startDate, endDate, 'active');

    INSERT IGNORE INTO Agent_Customers (agent_id, customer_id)
    VALUES (agentID, customerID);

    COMMIT;

    SELECT userID AS new_user_id, customerID AS new_customer_id, policyID AS new_policy_id;
END$$

-- Procedure: ExpireOldPolicies
-- Flags policies past their end date as 'expired'. Called daily by the
-- expire_policies_event below. (The derived table works around MySQL's
-- rule against selecting from the table being updated.)
-- FIX/IMPROVEMENT: also expires the matching Customer_Policies rows so
--      the two tables stay in sync.
CREATE PROCEDURE ExpireOldPolicies()
BEGIN
    UPDATE Insurance_Policies
       SET status = 'expired'
     WHERE policy_id IN (
           SELECT policy_id FROM (
               SELECT policy_id
                 FROM Insurance_Policies
                WHERE end_date < CURDATE()
                  AND status IN ('active', 'under review')
           ) AS safe_subquery
     );

    UPDATE Customer_Policies
       SET status = 'expired'
     WHERE end_date < CURDATE() AND status = 'active';
END$$

-- Function: GetTotalPremiumPaid
-- Total premium a customer has paid across all their policies.
CREATE FUNCTION GetTotalPremiumPaid(in_customer_id INT)
RETURNS DECIMAL(10,2)
READS SQL DATA
BEGIN
    DECLARE total DECIMAL(10,2);
    SELECT COALESCE(SUM(p.amount_paid), 0) INTO total
      FROM Payments p
      JOIN Customer_Policies cp ON p.policy_holder_id = cp.policy_holder_id
     WHERE cp.customer_id = in_customer_id;
    RETURN total;
END$$



-- Procedure: FileClaim  (new claims always start as 'pending')
CREATE PROCEDURE FileClaim(
    IN in_policy_id    INT,
    IN in_claim_amount DECIMAL(10,2),
    IN in_claim_date   DATE
)
BEGIN
    DECLARE claimStatusID INT;

    SELECT claim_status_id INTO claimStatusID
      FROM Claim_Statuses
     WHERE claim_status = 'pending'
     LIMIT 1;

    INSERT INTO Claims (policy_id, claim_status_id, claim_amount, claim_date)
    VALUES (in_policy_id, claimStatusID, in_claim_amount, in_claim_date);
END$$

-- Procedure: AddBeneficiary
-- FIX: a "- ====" typo (single dash) in the submitted script made this
--      procedure fail to compile, so it never existed in the database.
CREATE PROCEDURE AddBeneficiary(
    IN in_customer_id  INT,
    IN in_policy_id    INT,
    IN in_full_name    VARCHAR(100),
    IN in_relationship VARCHAR(20)
)
BEGIN
    INSERT INTO Beneficiaries (customer_id, policy_id, full_name, relationship)
    VALUES (in_customer_id, in_policy_id, in_full_name, in_relationship);
END$$

-- Trigger: after_policy_expired
-- When a policy moves to 'expired', log it against the owning agent.
CREATE TRIGGER after_policy_expired
AFTER UPDATE ON Insurance_Policies
FOR EACH ROW
BEGIN
    IF OLD.status <> 'expired' AND NEW.status = 'expired' THEN
        INSERT INTO Logs (user_id, action)
        VALUES (
            (SELECT a.user_id FROM Agents a WHERE a.agent_id = NEW.agent_id),
            CONCAT('Policy ID ', NEW.policy_id, ' has expired')
        );
    END IF;
END$$

-- Function: GetTotalClaims  (how many claims a policy has had)
CREATE FUNCTION GetTotalClaims(policyId INT)
RETURNS INT
READS SQL DATA
BEGIN
    DECLARE claimCount INT;
    SELECT COUNT(*) INTO claimCount FROM Claims WHERE policy_id = policyId;
    RETURN claimCount;
END$$



-- Function: CalculateRiskFactor  (0.1 per claim filed)
-- FIX: the parameter was named customer_id, the same as the column, so
--      "WHERE cp.customer_id = customer_id" was ambiguous. Renamed.
CREATE FUNCTION CalculateRiskFactor(in_customer_id INT)
RETURNS DECIMAL(5,2)
READS SQL DATA
BEGIN
    DECLARE claim_count INT DEFAULT 0;

    SELECT COUNT(*) INTO claim_count
      FROM Claims c
      JOIN Customer_Policies cp ON cp.policy_id = c.policy_id
     WHERE cp.customer_id = in_customer_id;

    RETURN claim_count * 0.1;
END$$

-- Function: GetActivePolicyCount
CREATE FUNCTION GetActivePolicyCount(in_customer_id INT)
RETURNS INT
READS SQL DATA
BEGIN
    DECLARE policy_count INT DEFAULT 0;
    SELECT COUNT(*) INTO policy_count
      FROM Customer_Policies
     WHERE customer_id = in_customer_id AND status = 'active';
    RETURN policy_count;
END$$

-- Procedure: AssignPolicyToCustomer
CREATE PROCEDURE AssignPolicyToCustomer(
    IN p_customer_id INT,
    IN p_policy_id   INT,
    IN p_agent_id    INT
)
BEGIN
    INSERT INTO Customer_Policies (customer_id, policy_id, start_date, end_date, status)
    SELECT p_customer_id, p_policy_id, ip.start_date, ip.end_date, 'active'
      FROM Insurance_Policies ip
     WHERE ip.policy_id = p_policy_id;

    INSERT IGNORE INTO Agent_Customers (agent_id, customer_id)
    VALUES (p_agent_id, p_customer_id);
END$$

-- Procedure: GetMonthlyClaimSummary  (claims handled by an agent in a month)
CREATE PROCEDURE GetMonthlyClaimSummary(
    IN p_agent_id INT,
    IN p_month    INT,
    IN p_year     INT
)
BEGIN
    SELECT a.agent_id,
           CONCAT(u.first_name, ' ', u.last_name) AS agent_name,
           COUNT(cl.claim_id)                     AS total_claims,
           SUM(cl.claim_amount)                   AS total_claim_amount
      FROM Claims cl
      JOIN Insurance_Policies ip ON cl.policy_id = ip.policy_id
      JOIN Agents a              ON ip.agent_id  = a.agent_id
      JOIN Users  u              ON a.user_id    = u.user_id
     WHERE a.agent_id = p_agent_id
       AND MONTH(cl.claim_date) = p_month
       AND YEAR(cl.claim_date)  = p_year
     GROUP BY a.agent_id, u.first_name, u.last_name;
END$$

-- Trigger: trg_UpdatePolicyStatusOnClaim
-- A new claim flags the policy for review.
-- FIX: only touches policies that are currently 'active'; the original
--      also flipped expired/cancelled policies to 'under review'.
CREATE TRIGGER trg_UpdatePolicyStatusOnClaim
AFTER INSERT ON Claims
FOR EACH ROW
BEGIN
    UPDATE Insurance_Policies
       SET status = 'under review'
     WHERE policy_id = NEW.policy_id
       AND status = 'active';
END$$

-- Trigger: trg_LogPolicyDeletion
-- FIX: its target table Policy_Deletion_Log now exists (01_schema.sql).
CREATE TRIGGER trg_LogPolicyDeletion
AFTER DELETE ON Customer_Policies
FOR EACH ROW
BEGIN
    INSERT INTO Policy_Deletion_Log (customer_id, policy_id, deleted_date)
    VALUES (OLD.customer_id, OLD.policy_id, NOW());
END$$



-- Procedure: UpdateCustomerAgentPolicies
-- Moves a customer, and the policies the current agent sold them, to a
-- new agent.
-- FIX: (1) table names were lowercase (insurance_policies), which fails
--      on Linux where MySQL table names are case-sensitive;
--      (2) in_current_agent_id was accepted but never used, so policies
--      sold by other agents moved too; (3) the Agent_Customers UPDATE
--      could break the UNIQUE(agent_id, customer_id) constraint.
CREATE PROCEDURE UpdateCustomerAgentPolicies(
    IN in_customer_id      INT,
    IN in_new_agent_id     INT,
    IN in_current_agent_id INT
)
BEGIN
    UPDATE Insurance_Policies
       SET agent_id = in_new_agent_id
     WHERE agent_id = in_current_agent_id
       AND policy_id IN (SELECT policy_id FROM Customer_Policies
                          WHERE customer_id = in_customer_id);

    DELETE FROM Agent_Customers
     WHERE customer_id = in_customer_id AND agent_id = in_current_agent_id;

    INSERT IGNORE INTO Agent_Customers (agent_id, customer_id)
    VALUES (in_new_agent_id, in_customer_id);
END$$

-- Function: CalculateAverageRating  (average rating a customer has given)
CREATE FUNCTION CalculateAverageRating(in_customer_id INT)
RETURNS DECIMAL(4,2)
READS SQL DATA
BEGIN
    DECLARE avg_rating DECIMAL(4,2);
    SELECT AVG(rating) INTO avg_rating FROM Feedback WHERE customer_id = in_customer_id;
    RETURN IFNULL(avg_rating, 0);
END$$

-- Audit triggers: keep the OLD row whenever a core record is updated
CREATE TRIGGER before_users_update
BEFORE UPDATE ON Users
FOR EACH ROW
BEGIN
    INSERT INTO users_audit
       SET action = 'update', user_id = OLD.user_id, first_name = OLD.first_name,
           last_name = OLD.last_name, email = OLD.email,
           password_hash = OLD.password_hash, role_id = OLD.role_id, changedat = NOW();
END$$

CREATE TRIGGER before_customers_update
BEFORE UPDATE ON Customers
FOR EACH ROW
BEGIN
    INSERT INTO customers_audit
       SET action = 'update', customer_id = OLD.customer_id, user_id = OLD.user_id,
           national_id = OLD.national_id, changedat = NOW();
END$$

CREATE TRIGGER before_agents_update
BEFORE UPDATE ON Agents
FOR EACH ROW
BEGIN
    INSERT INTO agents_audit
       SET action = 'update', agent_id = OLD.agent_id, user_id = OLD.user_id,
           license_number = OLD.license_number, branch_id = OLD.branch_id, changedat = NOW();
END$$

CREATE TRIGGER before_branches_update
BEFORE UPDATE ON Branches
FOR EACH ROW
BEGIN
    INSERT INTO branches_audit
       SET action = 'update', branch_id = OLD.branch_id, location_name = OLD.location_name,
           contact_number = OLD.contact_number, changedat = NOW();
END$$



-- Procedure: AssignUserRole  (look up role by name, assign to user)
CREATE PROCEDURE AssignUserRole(
    IN p_user_id   INT,
    IN p_role_name ENUM('customer','agent','admin')
)
BEGIN
    DECLARE role_id_val INT;
    SELECT role_id INTO role_id_val FROM User_Roles WHERE role_name = p_role_name;
    UPDATE Users SET role_id = role_id_val WHERE user_id = p_user_id;
END$$

-- Procedure: AddPaymentMethod  (insert only if it doesn't exist yet)
CREATE PROCEDURE AddPaymentMethod(
    IN p_method ENUM('credit_card','debit_card','bank_transfer','cash')
)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM Payment_Methods WHERE payment_method = p_method) THEN
        INSERT INTO Payment_Methods (payment_method) VALUES (p_method);
    END IF;
END$$

-- Trigger: trg_LogRoleChange
-- FIX: wrote to Logs columns (activity_type, activity_description,
--      activity_timestamp) that don't exist, so EVERY role change failed
--      (including AssignUserRole). Now uses Logs(user_id, action), and
--      compares with NULL-safe <=> so a first role assignment is logged.
CREATE TRIGGER trg_LogRoleChange
AFTER UPDATE ON Users
FOR EACH ROW
BEGIN
    DECLARE old_role VARCHAR(20);
    DECLARE new_role VARCHAR(20);

    IF NOT (OLD.role_id <=> NEW.role_id) THEN
        SELECT role_name INTO old_role FROM User_Roles WHERE role_id = OLD.role_id;
        SELECT role_name INTO new_role FROM User_Roles WHERE role_id = NEW.role_id;
        INSERT INTO Logs (user_id, action)
        VALUES (NEW.user_id,
                CONCAT('ROLE_UPDATE: role changed from ', IFNULL(old_role, 'none'),
                       ' to ', IFNULL(new_role, 'none')));
    END IF;
END$$

-- Trigger: trg_LogClaimStatusInsert
-- FIX: same missing-column problem as trg_LogRoleChange.
CREATE TRIGGER trg_LogClaimStatusInsert
AFTER INSERT ON Claim_Statuses
FOR EACH ROW
BEGIN
    INSERT INTO Logs (user_id, action)
    VALUES (NULL, CONCAT('STATUS_INSERT: new claim status added: ', NEW.claim_status));
END$$

-- Function: GetClaimStatusLabel  (readable status for a claim id)
CREATE FUNCTION GetClaimStatusLabel(p_claim_id INT)
RETURNS VARCHAR(20)
READS SQL DATA
BEGIN
    DECLARE status_label VARCHAR(20);
    SELECT cs.claim_status INTO status_label
      FROM Claims c
      JOIN Claim_Statuses cs ON c.claim_status_id = cs.claim_status_id
     WHERE c.claim_id = p_claim_id;
    RETURN status_label;
END$$

-- Function: CountPoliciesByType
CREATE FUNCTION CountPoliciesByType(p_type ENUM('medical','vehicle','home','life','travel'))
RETURNS INT
READS SQL DATA
BEGIN
    DECLARE count_result INT;
    SELECT COUNT(*) INTO count_result
      FROM Insurance_Policies ip
      JOIN Policy_Types pt ON ip.policy_type_id = pt.policy_type_id
     WHERE pt.policy_type = p_type;
    RETURN count_result;
END$$

DELIMITER ;

-- =====================================================================
-- SCHEDULED EVENT  runs ExpireOldPolicies() once a day.
-- Requires the event scheduler:  SET GLOBAL event_scheduler = ON;
-- =====================================================================
CREATE EVENT IF NOT EXISTS expire_policies_event
ON SCHEDULE EVERY 1 DAY
STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 1 HOUR)
DO CALL ExpireOldPolicies();
