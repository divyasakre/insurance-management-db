-- =====================================================================
-- Insurance Management Database System  |  04 - COMPLEX QUERIES
-- Business questions answered with SQL. Read-only; safe to re-run.
-- Post-submission fixes are marked "-- FIX:" (see CHANGELOG.md).
-- =====================================================================
USE insurance_db;

-- ---------------------------------------------------------------------
-- Q1. Agent performance: customers managed and total policy value
-- FIX: the original joined Agent_Customers and Insurance_Policies in the
--      same query, so each policy was counted once PER CUSTOMER and the
--      SUM was inflated. Each side is now aggregated in its own subquery.
-- ---------------------------------------------------------------------
SELECT
    a.agent_id,
    u.first_name,
    u.last_name,
    COALESCE(ac.total_customers, 0)       AS total_customers,
    COALESCE(ip.policies_sold, 0)         AS policies_sold,
    COALESCE(ip.total_policy_amount, 0)   AS total_policy_amount
FROM Agents a
JOIN Users u ON a.user_id = u.user_id
LEFT JOIN (SELECT agent_id, COUNT(DISTINCT customer_id) AS total_customers
             FROM Agent_Customers GROUP BY agent_id) ac ON ac.agent_id = a.agent_id
LEFT JOIN (SELECT agent_id, COUNT(*) AS policies_sold, SUM(policy_amount) AS total_policy_amount
             FROM Insurance_Policies GROUP BY agent_id) ip ON ip.agent_id = a.agent_id
ORDER BY total_policy_amount DESC;

-- ---------------------------------------------------------------------
-- Q2. Policies expiring in the next 30 days (renewal outreach list)
-- ---------------------------------------------------------------------
SELECT
    p.policy_id,
    pt.policy_type,
    p.end_date,
    DATEDIFF(p.end_date, CURDATE()) AS days_left
FROM Insurance_Policies p
JOIN Policy_Types pt ON p.policy_type_id = pt.policy_type_id
WHERE p.end_date BETWEEN CURDATE() AND CURDATE() + INTERVAL 30 DAY
  AND p.status IN ('active', 'under review')
ORDER BY days_left;

-- ---------------------------------------------------------------------
-- Q3. Customers with no payment in the last 6 months, or ever
-- ---------------------------------------------------------------------
SELECT
    c.customer_id,
    CONCAT(u.first_name, ' ', u.last_name)  AS customer_name,
    MAX(p.payment_date)                      AS last_payment_date,
    DATEDIFF(CURDATE(), MAX(p.payment_date)) AS days_since_last_payment
FROM Customers c
JOIN Users u              ON c.user_id = u.user_id
JOIN Customer_Policies cp ON c.customer_id = cp.customer_id
LEFT JOIN Payments p      ON cp.policy_holder_id = p.policy_holder_id
GROUP BY c.customer_id, customer_name
HAVING days_since_last_payment > 180 OR last_payment_date IS NULL
ORDER BY days_since_last_payment DESC;

-- ---------------------------------------------------------------------
-- Q4. Customers holding more than one policy of the same type
-- ---------------------------------------------------------------------
SELECT
    c.customer_id,
    CONCAT(u.first_name, ' ', u.last_name) AS customer_name,
    pt.policy_type,
    COUNT(cp.policy_id) AS policy_count
FROM Customers c
JOIN Users u               ON c.user_id = u.user_id
JOIN Customer_Policies cp  ON c.customer_id = cp.customer_id
JOIN Insurance_Policies ip ON cp.policy_id = ip.policy_id
JOIN Policy_Types pt       ON ip.policy_type_id = pt.policy_type_id
GROUP BY c.customer_id, customer_name, pt.policy_type
HAVING COUNT(cp.policy_id) > 1
ORDER BY customer_name, policy_count DESC;

-- ---------------------------------------------------------------------
-- Q5. Agents who have sold policies but have no customers assigned
-- ---------------------------------------------------------------------
SELECT
    a.agent_id,
    CONCAT(u.first_name, ' ', u.last_name) AS agent_name,
    COUNT(DISTINCT ip.policy_id)           AS total_policies_sold,
    COUNT(DISTINCT ac.customer_id)         AS active_customers
FROM Agents a
JOIN Users u                    ON a.user_id = u.user_id
LEFT JOIN Insurance_Policies ip ON a.agent_id = ip.agent_id
LEFT JOIN Agent_Customers ac    ON a.agent_id = ac.agent_id
GROUP BY a.agent_id, agent_name
HAVING total_policies_sold > 0 AND active_customers = 0;

-- ---------------------------------------------------------------------
-- Q6. Customers who have filed claims but hold no active policy
-- FIX: the original joined Claims through a correlated subquery in the
--      ON clause (fails if a policy has 2+ holders). Rewritten as plain
--      joins plus NOT EXISTS.
-- ---------------------------------------------------------------------
SELECT
    c.customer_id,
    CONCAT(u.first_name, ' ', u.last_name) AS customer_name,
    COUNT(DISTINCT cl.claim_id)            AS total_claims
FROM Customers c
JOIN Users u              ON c.user_id = u.user_id
JOIN Customer_Policies cp ON c.customer_id = cp.customer_id
JOIN Claims cl            ON cl.policy_id = cp.policy_id
WHERE NOT EXISTS (SELECT 1 FROM Customer_Policies x
                   WHERE x.customer_id = c.customer_id AND x.status = 'active')
GROUP BY c.customer_id, customer_name
ORDER BY total_claims DESC;

-- ---------------------------------------------------------------------
-- Q7. Policies with more than one claim
-- ---------------------------------------------------------------------
SELECT policy_id, COUNT(claim_id) AS claim_count
FROM Claims
GROUP BY policy_id
HAVING COUNT(claim_id) > 1
ORDER BY claim_count DESC;

-- ---------------------------------------------------------------------
-- Q8. Agent directory by branch, with formatted phone number
-- ---------------------------------------------------------------------
SELECT
    u.first_name     AS `First Name`,
    u.last_name      AS `Last Name`,
    b.branch_id      AS `Branch ID`,
    b.location_name  AS `Branch Location`,
    CONCAT('(', LEFT(b.contact_number, 3), ') ',
           MID(b.contact_number, 4, 3), '-',
           RIGHT(b.contact_number, 4)) AS `Branch Contact Number`
FROM Branches b
LEFT JOIN Agents a ON b.branch_id = a.branch_id
LEFT JOIN Users  u ON a.user_id   = u.user_id
ORDER BY b.branch_id;

-- Q9. Using the feedback view (defined in 03_programmability.sql)
SELECT * FROM UserFeedbackView WHERE last_name = 'Patel';

-- ---------------------------------------------------------------------
-- Q10. Average policy value by branch
-- ---------------------------------------------------------------------
SELECT
    b.branch_id,
    b.location_name,
    ROUND(AVG(ip.policy_amount), 2) AS avg_policy_amount
FROM Branches b
JOIN Agents a              ON b.branch_id = a.branch_id
JOIN Insurance_Policies ip ON a.agent_id  = ip.agent_id
GROUP BY b.branch_id, b.location_name
ORDER BY avg_policy_amount DESC;

-- ---------------------------------------------------------------------
-- Q11. Customers who filed claims but never had one approved
-- ---------------------------------------------------------------------
SELECT
    c.customer_id,
    CONCAT(u.first_name, ' ', u.last_name) AS customer_name,
    COUNT(cl.claim_id) AS total_claims,
    SUM(CASE WHEN cs.claim_status = 'approved' THEN 1 ELSE 0 END) AS approved_claims
FROM Customers c
JOIN Users u              ON c.user_id = u.user_id
JOIN Customer_Policies cp ON c.customer_id = cp.customer_id
JOIN Claims cl            ON cp.policy_id = cl.policy_id
LEFT JOIN Claim_Statuses cs ON cl.claim_status_id = cs.claim_status_id
GROUP BY c.customer_id, customer_name
HAVING approved_claims = 0;

-- ---------------------------------------------------------------------
-- Q12. User distribution by role
-- ---------------------------------------------------------------------
SELECT r.role_name, COUNT(u.user_id) AS users
FROM User_Roles r
LEFT JOIN Users u ON u.role_id = r.role_id
GROUP BY r.role_name;

-- ---------------------------------------------------------------------
-- Q13. Most-used payment methods
-- ---------------------------------------------------------------------
SELECT pm.payment_method, COUNT(*) AS transactions, SUM(p.amount_paid) AS total_amount
FROM Payments p
JOIN Payment_Methods pm ON p.payment_method_id = pm.payment_method_id
GROUP BY pm.payment_method
ORDER BY transactions DESC;
