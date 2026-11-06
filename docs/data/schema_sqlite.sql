-- SQLite port of sql/01_schema.sql + the triggers and view from
-- sql/03_programmability.sql, used ONLY by the in-browser playground.
-- MySQL ENUMs become CHECK constraints; stored procedures and functions
-- are re-implemented in JavaScript (see docs/assets/app.js).
-- The MySQL files in /sql are the source of truth.
PRAGMA foreign_keys = ON;

CREATE TABLE Policy_Types (policy_type_id INTEGER PRIMARY KEY,
  policy_type TEXT UNIQUE NOT NULL CHECK (policy_type IN ('medical','vehicle','home','life','travel')));
CREATE TABLE Claim_Statuses (claim_status_id INTEGER PRIMARY KEY,
  claim_status TEXT UNIQUE NOT NULL CHECK (claim_status IN ('pending','approved','rejected')));
CREATE TABLE Payment_Methods (payment_method_id INTEGER PRIMARY KEY,
  payment_method TEXT UNIQUE NOT NULL CHECK (payment_method IN ('credit_card','debit_card','bank_transfer','cash')));
CREATE TABLE User_Roles (role_id INTEGER PRIMARY KEY,
  role_name TEXT UNIQUE NOT NULL CHECK (role_name IN ('customer','agent','admin')));

CREATE TABLE Branches (branch_id INTEGER PRIMARY KEY,
  location_name TEXT NOT NULL, contact_number TEXT NOT NULL);
CREATE TABLE Users (user_id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INTEGER REFERENCES User_Roles(role_id) ON DELETE SET NULL);
CREATE TABLE Agents (agent_id INTEGER PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
  license_number TEXT NOT NULL UNIQUE,
  branch_id INTEGER REFERENCES Branches(branch_id) ON DELETE SET NULL);
CREATE TABLE Customers (customer_id INTEGER PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
  national_id TEXT UNIQUE NOT NULL);

CREATE TABLE Agent_Customers (agent_customer_id INTEGER PRIMARY KEY,
  agent_id INTEGER NOT NULL REFERENCES Agents(agent_id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES Customers(customer_id) ON DELETE CASCADE,
  UNIQUE (agent_id, customer_id));
CREATE TABLE Insurance_Policies (policy_id INTEGER PRIMARY KEY,
  policy_type_id INTEGER REFERENCES Policy_Types(policy_type_id) ON DELETE SET NULL,
  agent_id INTEGER REFERENCES Agents(agent_id) ON DELETE SET NULL,
  policy_amount REAL NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','expired','cancelled','under review')));
CREATE TABLE Customer_Policies (policy_holder_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES Customers(customer_id) ON DELETE CASCADE,
  policy_id INTEGER NOT NULL REFERENCES Insurance_Policies(policy_id) ON DELETE CASCADE,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','expired','cancelled')),
  UNIQUE (customer_id, policy_id));

CREATE TABLE Claims (claim_id INTEGER PRIMARY KEY,
  policy_id INTEGER NOT NULL REFERENCES Insurance_Policies(policy_id) ON DELETE CASCADE,
  claim_status_id INTEGER REFERENCES Claim_Statuses(claim_status_id) ON DELETE SET NULL,
  claim_amount REAL NOT NULL, claim_date TEXT NOT NULL);
CREATE TABLE Payments (payment_id INTEGER PRIMARY KEY,
  policy_holder_id INTEGER NOT NULL REFERENCES Customer_Policies(policy_holder_id) ON DELETE CASCADE,
  amount_paid REAL NOT NULL, payment_date TEXT NOT NULL,
  payment_method_id INTEGER REFERENCES Payment_Methods(payment_method_id) ON DELETE SET NULL,
  transaction_id TEXT UNIQUE NOT NULL);
CREATE TABLE Feedback (feedback_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES Customers(customer_id) ON DELETE CASCADE,
  comments TEXT, rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  submitted_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE Logs (log_id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES Users(user_id) ON DELETE SET NULL,
  action TEXT NOT NULL, timestamp TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE Beneficiaries (beneficiary_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES Customers(customer_id) ON DELETE CASCADE,
  policy_id INTEGER NOT NULL REFERENCES Insurance_Policies(policy_id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  relationship TEXT NOT NULL CHECK (relationship IN ('spouse','child','parent','sibling','other')));
CREATE TABLE Policy_Claims_Documents (document_id INTEGER PRIMARY KEY,
  claim_id INTEGER NOT NULL REFERENCES Claims(claim_id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('invoice','medical_report','repair_estimate','police_report','other')),
  document_url TEXT NOT NULL, uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE Policy_Deletion_Log (deletion_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL, policy_id INTEGER NOT NULL, deleted_date TEXT NOT NULL);

CREATE TABLE users_audit (user_id INTEGER NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
  email TEXT NOT NULL, password_hash TEXT NOT NULL, role_id INTEGER, changedat TEXT, action TEXT);
CREATE TABLE customers_audit (customer_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  national_id TEXT NOT NULL, changedat TEXT, action TEXT);
CREATE TABLE agents_audit (agent_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  license_number TEXT NOT NULL, branch_id INTEGER, changedat TEXT, action TEXT);
CREATE TABLE branches_audit (branch_id INTEGER NOT NULL, location_name TEXT NOT NULL,
  contact_number TEXT NOT NULL, changedat TEXT, action TEXT);
