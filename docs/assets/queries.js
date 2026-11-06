// The 13 business queries from sql/04_complex_queries.sql.
// `mysql` = the marker used to find the original MySQL text in that file;
// `sql`   = the same logic in SQLite, which is what runs in the browser.
window.QUERIES = [
  {
    id: "q1", audience: "admin",
    title: "Agent performance leaderboard",
    why: "Customers managed and total policy value per agent, so managers can spot top performers and balance workloads.",
    mysql: "Q1.",
    sql: `SELECT a.agent_id, u.first_name, u.last_name,
       COALESCE(ac.total_customers, 0)            AS total_customers,
       COALESCE(ip.policies_sold, 0)              AS policies_sold,
       ROUND(COALESCE(ip.total_policy_amount, 0), 2) AS total_policy_amount
FROM Agents a
JOIN Users u ON a.user_id = u.user_id
LEFT JOIN (SELECT agent_id, COUNT(DISTINCT customer_id) AS total_customers
             FROM Agent_Customers GROUP BY agent_id) ac ON ac.agent_id = a.agent_id
LEFT JOIN (SELECT agent_id, COUNT(*) AS policies_sold, SUM(policy_amount) AS total_policy_amount
             FROM Insurance_Policies GROUP BY agent_id) ip ON ip.agent_id = a.agent_id
ORDER BY total_policy_amount DESC;`
  },
  {
    id: "q2", audience: "agent",
    title: "Policies expiring in the next 30 days",
    why: "A renewal call list: reach customers before their coverage lapses.",
    mysql: "Q2.",
    sql: `SELECT p.policy_id, pt.policy_type, p.end_date,
       CAST(julianday(p.end_date) - julianday(date('now')) AS INTEGER) AS days_left
FROM Insurance_Policies p
JOIN Policy_Types pt ON p.policy_type_id = pt.policy_type_id
WHERE p.end_date BETWEEN date('now') AND date('now', '+30 days')
  AND p.status IN ('active', 'under review')
ORDER BY days_left;`
  },
  {
    id: "q3", audience: "agent",
    title: "Customers with no payment in 6+ months",
    why: "Inactive or at-risk customers who may be about to churn, a target list for reminders and retention offers.",
    mysql: "Q3.",
    sql: `SELECT c.customer_id,
       u.first_name || ' ' || u.last_name AS customer_name,
       MAX(p.payment_date) AS last_payment_date,
       CAST(julianday(date('now')) - julianday(MAX(p.payment_date)) AS INTEGER) AS days_since_last_payment
FROM Customers c
JOIN Users u              ON c.user_id = u.user_id
JOIN Customer_Policies cp ON c.customer_id = cp.customer_id
LEFT JOIN Payments p      ON cp.policy_holder_id = p.policy_holder_id
GROUP BY c.customer_id, customer_name
HAVING days_since_last_payment > 180 OR last_payment_date IS NULL
ORDER BY days_since_last_payment DESC;`
  },
  {
    id: "q4", audience: "agent",
    title: "Duplicate coverage (2+ policies of the same type)",
    why: "Overlapping policies confuse customers and are a chance to recommend a cheaper bundle.",
    mysql: "Q4.",
    sql: `SELECT c.customer_id,
       u.first_name || ' ' || u.last_name AS customer_name,
       pt.policy_type, COUNT(cp.policy_id) AS policy_count
FROM Customers c
JOIN Users u               ON c.user_id = u.user_id
JOIN Customer_Policies cp  ON c.customer_id = cp.customer_id
JOIN Insurance_Policies ip ON cp.policy_id = ip.policy_id
JOIN Policy_Types pt       ON ip.policy_type_id = pt.policy_type_id
GROUP BY c.customer_id, customer_name, pt.policy_type
HAVING COUNT(cp.policy_id) > 1
ORDER BY customer_name, policy_count DESC;`
  },
  {
    id: "q5", audience: "admin",
    title: "Agents with sales but no assigned customers",
    why: "Agents whose book of customers has been fully transferred away. Worth reviewing.",
    mysql: "Q5.",
    sql: `SELECT a.agent_id,
       u.first_name || ' ' || u.last_name AS agent_name,
       COUNT(DISTINCT ip.policy_id)       AS total_policies_sold,
       COUNT(DISTINCT ac.customer_id)     AS active_customers
FROM Agents a
JOIN Users u                    ON a.user_id = u.user_id
LEFT JOIN Insurance_Policies ip ON a.agent_id = ip.agent_id
LEFT JOIN Agent_Customers ac    ON a.agent_id = ac.agent_id
GROUP BY a.agent_id, agent_name
HAVING total_policies_sold > 0 AND active_customers = 0;`
  },
  {
    id: "q6", audience: "agent",
    title: "Past claimants with no active policy",
    why: "Former customers who used their coverage and then left. A win-back segment.",
    mysql: "Q6.",
    sql: `SELECT c.customer_id,
       u.first_name || ' ' || u.last_name AS customer_name,
       COUNT(DISTINCT cl.claim_id)        AS total_claims
FROM Customers c
JOIN Users u              ON c.user_id = u.user_id
JOIN Customer_Policies cp ON c.customer_id = cp.customer_id
JOIN Claims cl            ON cl.policy_id = cp.policy_id
WHERE NOT EXISTS (SELECT 1 FROM Customer_Policies x
                   WHERE x.customer_id = c.customer_id AND x.status = 'active')
GROUP BY c.customer_id, customer_name
ORDER BY total_claims DESC;`
  },
  {
    id: "q7", audience: "admin",
    title: "Policies with multiple claims",
    why: "Frequent claims can point to higher risk or possible fraud.",
    mysql: "Q7.",
    sql: `SELECT policy_id, COUNT(claim_id) AS claim_count
FROM Claims
GROUP BY policy_id
HAVING COUNT(claim_id) > 1
ORDER BY claim_count DESC;`
  },
  {
    id: "q8", audience: "customer",
    title: "Agent directory by branch",
    why: "Every branch with its agents and a formatted phone number.",
    mysql: "Q8.",
    sql: `SELECT u.first_name AS "First Name", u.last_name AS "Last Name",
       b.branch_id AS "Branch ID", b.location_name AS "Branch Location",
       '(' || substr(b.contact_number, 1, 3) || ') ' || substr(b.contact_number, 4, 3)
           || '-' || substr(b.contact_number, 7, 4) AS "Branch Contact Number"
FROM Branches b
LEFT JOIN Agents a ON b.branch_id = a.branch_id
LEFT JOIN Users  u ON a.user_id   = u.user_id
ORDER BY b.branch_id;`
  },
  {
    id: "q9", audience: "admin",
    title: "Feedback lookup by last name (view)",
    why: "A saved VIEW, so staff can search feedback without rewriting the join each time.",
    mysql: "Q9.",
    sql: `SELECT * FROM UserFeedbackView WHERE last_name = 'Patel';`
  },
  {
    id: "q10", audience: "admin",
    title: "Average policy value by branch",
    why: "Which branches sell higher-value policies.",
    mysql: "Q10.",
    sql: `SELECT b.branch_id, b.location_name,
       ROUND(AVG(ip.policy_amount), 2) AS avg_policy_amount
FROM Branches b
JOIN Agents a              ON b.branch_id = a.branch_id
JOIN Insurance_Policies ip ON a.agent_id  = ip.agent_id
GROUP BY b.branch_id, b.location_name
ORDER BY avg_policy_amount DESC;`
  },
  {
    id: "q11", audience: "admin",
    title: "Customers whose claims were never approved",
    why: "A customer-experience risk. These people are likely unhappy.",
    mysql: "Q11.",
    sql: `SELECT c.customer_id,
       u.first_name || ' ' || u.last_name AS customer_name,
       COUNT(cl.claim_id) AS total_claims,
       SUM(CASE WHEN cs.claim_status = 'approved' THEN 1 ELSE 0 END) AS approved_claims
FROM Customers c
JOIN Users u              ON c.user_id = u.user_id
JOIN Customer_Policies cp ON c.customer_id = cp.customer_id
JOIN Claims cl            ON cp.policy_id = cl.policy_id
LEFT JOIN Claim_Statuses cs ON cl.claim_status_id = cs.claim_status_id
GROUP BY c.customer_id, customer_name
HAVING approved_claims = 0;`
  },
  {
    id: "q12", audience: "admin",
    title: "User distribution by role",
    why: "How many customers, agents and admins use the platform.",
    mysql: "Q12.",
    sql: `SELECT r.role_name, COUNT(u.user_id) AS users
FROM User_Roles r
LEFT JOIN Users u ON u.role_id = r.role_id
GROUP BY r.role_name;`
  },
  {
    id: "q13", audience: "admin",
    title: "Most-used payment methods",
    why: "Which payment options customers prefer, to guide billing UX.",
    mysql: "Q13.",
    sql: `SELECT pm.payment_method, COUNT(*) AS transactions,
       ROUND(SUM(p.amount_paid), 2) AS total_amount
FROM Payments p
JOIN Payment_Methods pm ON p.payment_method_id = pm.payment_method_id
GROUP BY pm.payment_method
ORDER BY transactions DESC;`
  }
];
