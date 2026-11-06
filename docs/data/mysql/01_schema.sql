-- =====================================================================
-- Insurance Management Database System  |  01 - SCHEMA
-- UTD Jindal School of Management, BUAN/MIS 6320 Database Foundations
-- Course project, Spring 2025
--
-- Target: MySQL 8.0 (also tested on MariaDB 10.11)
-- Run order: 01_schema -> 02_seed_data -> 03_programmability
--            -> 04_complex_queries (read-only) -> 05_demo (optional)
-- Fixes made after submission are marked "-- FIX:" (see CHANGELOG.md).
-- =====================================================================

DROP DATABASE IF EXISTS insurance_db;
CREATE DATABASE insurance_db;
USE insurance_db;

-- ---------------------------------------------------------------------
-- 1. LOOKUP / REFERENCE TABLES
-- ---------------------------------------------------------------------
CREATE TABLE Policy_Types (
    policy_type_id INT AUTO_INCREMENT PRIMARY KEY,
    policy_type    ENUM('medical','vehicle','home','life','travel') UNIQUE NOT NULL
);

CREATE TABLE Claim_Statuses (
    claim_status_id INT AUTO_INCREMENT PRIMARY KEY,
    claim_status    ENUM('pending','approved','rejected') UNIQUE NOT NULL
);

CREATE TABLE Payment_Methods (
    payment_method_id INT AUTO_INCREMENT PRIMARY KEY,
    payment_method    ENUM('credit_card','debit_card','bank_transfer','cash') UNIQUE NOT NULL
);

CREATE TABLE User_Roles (
    role_id   INT AUTO_INCREMENT PRIMARY KEY,
    role_name ENUM('customer','agent','admin') UNIQUE NOT NULL
);

-- ---------------------------------------------------------------------
-- 2. CORE ENTITIES
-- ---------------------------------------------------------------------
CREATE TABLE Branches (
    branch_id      INT AUTO_INCREMENT PRIMARY KEY,
    location_name  VARCHAR(100) NOT NULL,
    contact_number VARCHAR(15)  NOT NULL
);

CREATE TABLE Users (
    user_id       INT AUTO_INCREMENT PRIMARY KEY,
    first_name    VARCHAR(50)  NOT NULL,
    last_name     VARCHAR(50)  NOT NULL,
    email         VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role_id       INT,
    FOREIGN KEY (role_id) REFERENCES User_Roles(role_id) ON DELETE SET NULL
);

CREATE TABLE Agents (
    agent_id       INT AUTO_INCREMENT PRIMARY KEY,
    user_id        INT UNIQUE NOT NULL,
    license_number VARCHAR(50) NOT NULL UNIQUE,
    branch_id      INT,
    FOREIGN KEY (user_id)   REFERENCES Users(user_id)       ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES Branches(branch_id)  ON DELETE SET NULL
);

CREATE TABLE Customers (
    customer_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNIQUE NOT NULL,
    national_id VARCHAR(20) UNIQUE NOT NULL,
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- 3. RELATIONSHIP / JUNCTION TABLES
-- ---------------------------------------------------------------------
-- Many-to-many: which agents manage which customers
CREATE TABLE Agent_Customers (
    agent_customer_id INT AUTO_INCREMENT PRIMARY KEY,
    agent_id    INT NOT NULL,
    customer_id INT NOT NULL,
    FOREIGN KEY (agent_id)    REFERENCES Agents(agent_id)       ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES Customers(customer_id) ON DELETE CASCADE,
    UNIQUE (agent_id, customer_id)
);

-- Core policy table
CREATE TABLE Insurance_Policies (
    policy_id      INT AUTO_INCREMENT PRIMARY KEY,
    policy_type_id INT,
    agent_id       INT,
    policy_amount  DECIMAL(10,2) NOT NULL,
    start_date     DATE NOT NULL,
    end_date       DATE NOT NULL,
    status         ENUM('active','expired','cancelled','under review') NOT NULL,
    FOREIGN KEY (policy_type_id) REFERENCES Policy_Types(policy_type_id) ON DELETE SET NULL,
    FOREIGN KEY (agent_id)       REFERENCES Agents(agent_id)             ON DELETE SET NULL
);

-- Many-to-many: which customers hold which policies
CREATE TABLE Customer_Policies (
    policy_holder_id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    policy_id   INT NOT NULL,
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    status      ENUM('active','expired','cancelled') NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES Customers(customer_id)        ON DELETE CASCADE,
    FOREIGN KEY (policy_id)   REFERENCES Insurance_Policies(policy_id) ON DELETE CASCADE,
    UNIQUE (customer_id, policy_id)
);

-- ---------------------------------------------------------------------
-- 4. CLAIMS, PAYMENTS & FEEDBACK
-- ---------------------------------------------------------------------
CREATE TABLE Claims (
    claim_id        INT AUTO_INCREMENT PRIMARY KEY,
    policy_id       INT NOT NULL,
    claim_status_id INT,
    claim_amount    DECIMAL(10,2) NOT NULL,
    claim_date      DATE NOT NULL,
    FOREIGN KEY (policy_id)       REFERENCES Insurance_Policies(policy_id)  ON DELETE CASCADE,
    FOREIGN KEY (claim_status_id) REFERENCES Claim_Statuses(claim_status_id) ON DELETE SET NULL
);

CREATE TABLE Payments (
    payment_id        INT AUTO_INCREMENT PRIMARY KEY,
    policy_holder_id  INT NOT NULL,
    amount_paid       DECIMAL(10,2) NOT NULL,
    payment_date      DATE NOT NULL,
    payment_method_id INT,
    transaction_id    VARCHAR(50) UNIQUE NOT NULL,
    FOREIGN KEY (policy_holder_id)  REFERENCES Customer_Policies(policy_holder_id) ON DELETE CASCADE,
    -- FIX: was ON DELETE CASCADE, which would erase payment history if a
    --      payment method were ever removed. SET NULL keeps the records.
    FOREIGN KEY (payment_method_id) REFERENCES Payment_Methods(payment_method_id) ON DELETE SET NULL
);

CREATE TABLE Feedback (
    feedback_id  INT AUTO_INCREMENT PRIMARY KEY,
    customer_id  INT NOT NULL,
    comments     TEXT,
    rating       INT CHECK (rating BETWEEN 1 AND 5),
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES Customers(customer_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- 5. LOGS, BENEFICIARIES & DOCUMENTS
-- ---------------------------------------------------------------------
CREATE TABLE Logs (
    log_id    INT AUTO_INCREMENT PRIMARY KEY,
    user_id   INT,
    action    VARCHAR(255) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE SET NULL
);

CREATE TABLE Beneficiaries (
    beneficiary_id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id    INT NOT NULL,
    policy_id      INT NOT NULL,
    full_name      VARCHAR(100) NOT NULL,
    relationship   ENUM('spouse','child','parent','sibling','other') NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES Customers(customer_id)        ON DELETE CASCADE,
    FOREIGN KEY (policy_id)   REFERENCES Insurance_Policies(policy_id) ON DELETE CASCADE
);

CREATE TABLE Policy_Claims_Documents (
    document_id   INT AUTO_INCREMENT PRIMARY KEY,
    claim_id      INT NOT NULL,
    document_type ENUM('invoice','medical_report','repair_estimate','police_report','other') NOT NULL,
    document_url  VARCHAR(255) NOT NULL,
    uploaded_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES Claims(claim_id) ON DELETE CASCADE
);

-- FIX: table used by trg_LogPolicyDeletion but never created in the
--      submitted script, so every DELETE on Customer_Policies failed.
CREATE TABLE Policy_Deletion_Log (
    deletion_id  INT AUTO_INCREMENT PRIMARY KEY,
    customer_id  INT NOT NULL,
    policy_id    INT NOT NULL,
    deleted_date DATETIME NOT NULL
);

-- ---------------------------------------------------------------------
-- 6. AUDIT TABLES  (filled by the BEFORE UPDATE triggers)
-- FIX: columns that can be NULL in the source table are now nullable
--      here too, and sizes match the source columns, so an update to a
--      user with no role / agent with no branch no longer fails.
-- ---------------------------------------------------------------------
CREATE TABLE users_audit (
    user_id       INT NOT NULL,
    first_name    VARCHAR(50)  NOT NULL,
    last_name     VARCHAR(50)  NOT NULL,
    email         VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role_id       INT NULL,
    changedat     DATETIME DEFAULT NULL,
    action        VARCHAR(50) DEFAULT NULL
);

CREATE TABLE customers_audit (
    customer_id INT NOT NULL,
    user_id     INT NOT NULL,
    national_id VARCHAR(20) NOT NULL,
    changedat   DATETIME DEFAULT NULL,
    action      VARCHAR(50) DEFAULT NULL
);

CREATE TABLE agents_audit (
    agent_id       INT NOT NULL,
    user_id        INT NOT NULL,
    license_number VARCHAR(50) NOT NULL,
    branch_id      INT NULL,
    changedat      DATETIME DEFAULT NULL,
    action         VARCHAR(50) DEFAULT NULL
);

CREATE TABLE branches_audit (
    branch_id      INT NOT NULL,
    location_name  VARCHAR(100) NOT NULL,
    contact_number VARCHAR(15)  NOT NULL,
    changedat      DATETIME DEFAULT NULL,
    action         VARCHAR(50) DEFAULT NULL
);

-- Helpful indexes for the reporting queries
CREATE INDEX idx_policies_end_date ON Insurance_Policies(end_date);
CREATE INDEX idx_claims_date       ON Claims(claim_date);
CREATE INDEX idx_payments_date     ON Payments(payment_date);
