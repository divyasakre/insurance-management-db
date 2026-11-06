-- SQLite port of the view and triggers in sql/03_programmability.sql.
-- Loaded after the seed data, so the sample rows don't fire them.

CREATE VIEW UserFeedbackView AS
SELECT u.last_name, u.first_name, f.feedback_id, f.comments, f.rating, f.submitted_at
FROM Feedback f
JOIN Customers c ON f.customer_id = c.customer_id
JOIN Users u ON c.user_id = u.user_id;

-- log_new_claim
CREATE TRIGGER log_new_claim AFTER INSERT ON Claims
BEGIN
  INSERT INTO Logs (user_id, action, timestamp)
  VALUES ((SELECT a.user_id FROM Insurance_Policies ip JOIN Agents a ON ip.agent_id = a.agent_id
            WHERE ip.policy_id = NEW.policy_id),
          'Filed claim ID ' || NEW.claim_id, datetime('now'));
END;

-- after_policy_expired
CREATE TRIGGER after_policy_expired AFTER UPDATE OF status ON Insurance_Policies
WHEN OLD.status <> 'expired' AND NEW.status = 'expired'
BEGIN
  INSERT INTO Logs (user_id, action, timestamp)
  VALUES ((SELECT a.user_id FROM Agents a WHERE a.agent_id = NEW.agent_id),
          'Policy ID ' || NEW.policy_id || ' has expired', datetime('now'));
END;

-- trg_UpdatePolicyStatusOnClaim
CREATE TRIGGER trg_UpdatePolicyStatusOnClaim AFTER INSERT ON Claims
BEGIN
  UPDATE Insurance_Policies SET status = 'under review'
   WHERE policy_id = NEW.policy_id AND status = 'active';
END;

-- trg_LogPolicyDeletion
CREATE TRIGGER trg_LogPolicyDeletion AFTER DELETE ON Customer_Policies
BEGIN
  INSERT INTO Policy_Deletion_Log (customer_id, policy_id, deleted_date)
  VALUES (OLD.customer_id, OLD.policy_id, datetime('now'));
END;

-- audit triggers
CREATE TRIGGER before_users_update BEFORE UPDATE ON Users
BEGIN
  INSERT INTO users_audit (user_id, first_name, last_name, email, password_hash, role_id, changedat, action)
  VALUES (OLD.user_id, OLD.first_name, OLD.last_name, OLD.email, OLD.password_hash, OLD.role_id, datetime('now'), 'update');
END;
CREATE TRIGGER before_customers_update BEFORE UPDATE ON Customers
BEGIN
  INSERT INTO customers_audit (customer_id, user_id, national_id, changedat, action)
  VALUES (OLD.customer_id, OLD.user_id, OLD.national_id, datetime('now'), 'update');
END;
CREATE TRIGGER before_agents_update BEFORE UPDATE ON Agents
BEGIN
  INSERT INTO agents_audit (agent_id, user_id, license_number, branch_id, changedat, action)
  VALUES (OLD.agent_id, OLD.user_id, OLD.license_number, OLD.branch_id, datetime('now'), 'update');
END;
CREATE TRIGGER before_branches_update BEFORE UPDATE ON Branches
BEGIN
  INSERT INTO branches_audit (branch_id, location_name, contact_number, changedat, action)
  VALUES (OLD.branch_id, OLD.location_name, OLD.contact_number, datetime('now'), 'update');
END;

-- trg_LogRoleChange
CREATE TRIGGER trg_LogRoleChange AFTER UPDATE OF role_id ON Users
WHEN OLD.role_id IS NOT NEW.role_id
BEGIN
  INSERT INTO Logs (user_id, action, timestamp)
  VALUES (NEW.user_id,
          'ROLE_UPDATE: role changed from ' ||
          IFNULL((SELECT role_name FROM User_Roles WHERE role_id = OLD.role_id), 'none') || ' to ' ||
          IFNULL((SELECT role_name FROM User_Roles WHERE role_id = NEW.role_id), 'none'),
          datetime('now'));
END;

-- trg_LogClaimStatusInsert
CREATE TRIGGER trg_LogClaimStatusInsert AFTER INSERT ON Claim_Statuses
BEGIN
  INSERT INTO Logs (user_id, action, timestamp)
  VALUES (NULL, 'STATUS_INSERT: new claim status added: ' || NEW.claim_status, datetime('now'));
END;
