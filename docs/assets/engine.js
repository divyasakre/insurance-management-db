// In-browser database engine for the playground.
// Builds the insurance DB in SQLite (sql.js / WebAssembly), shifts the
// sample dates to "today", registers the team's MySQL functions, and
// re-implements the stored procedures in JavaScript.
// Works in the browser (window.Engine) and in Node (module.exports) for tests.
(function (root) {
  const ANCHOR = "2026-11-06"; // date the seed data was generated against

  function todayISO() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function dayDiff(a, b) {
    return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
  }

  class Engine {
    constructor(SQL, sources) {
      this.SQL = SQL;
      this.sources = sources; // { schema, seed, triggers }
      this.reset();
    }

    reset() {
      if (this.db) this.db.close();
      const db = (this.db = new this.SQL.Database());
      const today = todayISO();
      this.today = today;
      db.exec(this.sources.schema);
      db.exec(this.sources.seed.replace(/^\s*USE\s+\w+\s*;\s*$/gim, ""));

      // Move every date forward so "expiring in 30 days" etc. stay meaningful.
      const n = dayDiff(today, ANCHOR);
      const m = `${n >= 0 ? "+" : ""}${n} days`;
      if (n !== 0) {
        const shifts = {
          Insurance_Policies: ["start_date", "end_date"],
          Customer_Policies: ["start_date", "end_date"],
          Claims: ["claim_date"],
          Payments: ["payment_date"],
        };
        for (const [t, cols] of Object.entries(shifts))
          db.run(`UPDATE ${t} SET ${cols.map((c) => `${c} = date(${c}, '${m}')`).join(", ")}`);
        db.run(`UPDATE Feedback SET submitted_at = datetime(submitted_at, '${m}')`);
        db.run(`UPDATE Logs SET timestamp = datetime(timestamp, '${m}')`);
        db.run(`UPDATE Policy_Claims_Documents SET uploaded_at = datetime(uploaded_at, '${m}')`);
      }
      // The seed reflects the world on ANCHOR; bring statuses up to date the
      // way the nightly MySQL event would have, before triggers exist.
      db.run(`UPDATE Insurance_Policies SET status = 'expired'
               WHERE end_date < date('now') AND status IN ('active','under review')`);
      db.run(`UPDATE Customer_Policies SET status = 'expired'
               WHERE end_date < date('now') AND status = 'active'`);

      db.exec(this.sources.triggers);
      this.registerFunctions();
      this.changeCount = 0;
    }

    // ---------- helpers ----------
    query(sql, params) {
      const stmt = this.db.prepare(sql);
      if (params) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    }
    scalar(sql, params) {
      const r = this.db.exec(sql, params);
      return r.length && r[0].values.length ? r[0].values[0][0] : null;
    }
    tx(fn) {
      this.db.exec("BEGIN");
      try {
        const out = fn();
        this.db.exec("COMMIT");
        this.changeCount++;
        return out;
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }
    lastId() {
      return this.scalar("SELECT last_insert_rowid()");
    }

    // ---------- MySQL functions (+ a few MySQL built-ins for the editor) ----------
    registerFunctions() {
      const db = this.db, s = (q, p) => this.scalar(q, p);
      const f = {
        GetTotalPremiumPaid: (id) =>
          s(`SELECT ROUND(COALESCE(SUM(p.amount_paid),0),2) FROM Payments p
             JOIN Customer_Policies cp ON p.policy_holder_id = cp.policy_holder_id
             WHERE cp.customer_id = ?`, [id]),
        GetTotalClaims: (id) => s("SELECT COUNT(*) FROM Claims WHERE policy_id = ?", [id]),
        CalculateRiskFactor: (id) =>
          Math.round(s(`SELECT COUNT(*) FROM Claims c JOIN Customer_Policies cp ON cp.policy_id = c.policy_id
                        WHERE cp.customer_id = ?`, [id]) * 10) / 100,
        GetActivePolicyCount: (id) =>
          s("SELECT COUNT(*) FROM Customer_Policies WHERE customer_id = ? AND status = 'active'", [id]),
        CalculateAverageRating: (id) =>
          s("SELECT ROUND(IFNULL(AVG(rating),0),2) FROM Feedback WHERE customer_id = ?", [id]),
        GetClaimStatusLabel: (id) =>
          s(`SELECT cs.claim_status FROM Claims c JOIN Claim_Statuses cs
             ON c.claim_status_id = cs.claim_status_id WHERE c.claim_id = ?`, [id]),
        CountPoliciesByType: (t) =>
          s(`SELECT COUNT(*) FROM Insurance_Policies ip JOIN Policy_Types pt
             ON ip.policy_type_id = pt.policy_type_id WHERE pt.policy_type = ?`, [t]),
        // MySQL built-ins, so MySQL-style queries work in the editor
        CURDATE: () => s("SELECT date('now')"),
        NOW: () => s("SELECT datetime('now')"),
        DATEDIFF: (a, b) => s("SELECT CAST(julianday(date(?)) - julianday(date(?)) AS INTEGER)", [a, b]),
        YEAR: (d) => (d ? Number(String(d).slice(0, 4)) : null),
        MONTH: (d) => (d ? Number(String(d).slice(5, 7)) : null),
      };
      for (const [name, fn] of Object.entries(f)) db.create_function(name, fn);
      // CONCAT with 2..8 arguments
      const cat = (...a) => (a.some((x) => x === null) ? null : a.join(""));
      for (let k = 2; k <= 8; k++) {
        const args = Array.from({ length: k }, (_, i) => "a" + i);
        // eslint-disable-next-line no-new-func
        db.create_function("CONCAT", new Function("cat", `return function(${args}){return cat(${args})}`)(cat));
      }
    }

    // ---------- Stored procedures (same logic as sql/03_programmability.sql) ----------
    procedures() {
      const e = this;
      return {
        AddNewCustomerWithPolicy(fname, lname, email, passhash, nationalID, agentID, policyTypeID, amount, startDate, endDate) {
          return e.tx(() => {
            e.db.run(`INSERT INTO Users (first_name,last_name,email,password_hash,role_id)
                      VALUES (?,?,?,?,(SELECT role_id FROM User_Roles WHERE role_name='customer'))`,
                     [fname, lname, email, passhash]);
            const userID = e.lastId();
            e.db.run("INSERT INTO Customers (user_id, national_id) VALUES (?,?)", [userID, nationalID]);
            const customerID = e.lastId();
            e.db.run(`INSERT INTO Insurance_Policies (policy_type_id,agent_id,policy_amount,start_date,end_date,status)
                      VALUES (?,?,?,?,?,'active')`, [policyTypeID, agentID, amount, startDate, endDate]);
            const policyID = e.lastId();
            e.db.run(`INSERT INTO Customer_Policies (customer_id,policy_id,start_date,end_date,status)
                      VALUES (?,?,?,?,'active')`, [customerID, policyID, startDate, endDate]);
            e.db.run("INSERT OR IGNORE INTO Agent_Customers (agent_id, customer_id) VALUES (?,?)", [agentID, customerID]);
            return [{ new_user_id: userID, new_customer_id: customerID, new_policy_id: policyID }];
          });
        },
        ExpireOldPolicies() {
          return e.tx(() => {
            e.db.run(`UPDATE Insurance_Policies SET status='expired'
                      WHERE end_date < date('now') AND status IN ('active','under review')`);
            const a = e.db.getRowsModified();
            e.db.run(`UPDATE Customer_Policies SET status='expired'
                      WHERE end_date < date('now') AND status='active'`);
            return [{ policies_expired: a, holder_rows_expired: e.db.getRowsModified() }];
          });
        },
        FileClaim(policyId, amount, claimDate) {
          return e.tx(() => {
            const pending = e.scalar("SELECT claim_status_id FROM Claim_Statuses WHERE claim_status='pending' LIMIT 1");
            e.db.run("INSERT INTO Claims (policy_id,claim_status_id,claim_amount,claim_date) VALUES (?,?,?,?)",
                     [policyId, pending, amount, claimDate || e.today]);
            return [{ new_claim_id: e.lastId(), status: "pending" }];
          });
        },
        AddBeneficiary(customerId, policyId, fullName, relationship) {
          return e.tx(() => {
            e.db.run("INSERT INTO Beneficiaries (customer_id,policy_id,full_name,relationship) VALUES (?,?,?,?)",
                     [customerId, policyId, fullName, relationship]);
            return [{ new_beneficiary_id: e.lastId() }];
          });
        },
        AssignPolicyToCustomer(customerId, policyId, agentId) {
          return e.tx(() => {
            e.db.run(`INSERT INTO Customer_Policies (customer_id,policy_id,start_date,end_date,status)
                      SELECT ?, ?, start_date, end_date, 'active' FROM Insurance_Policies WHERE policy_id = ?`,
                     [customerId, policyId, policyId]);
            const n = e.db.getRowsModified();
            e.db.run("INSERT OR IGNORE INTO Agent_Customers (agent_id, customer_id) VALUES (?,?)", [agentId, customerId]);
            return [{ policies_linked: n }];
          });
        },
        GetMonthlyClaimSummary(agentId, month, year) {
          return e.query(`SELECT a.agent_id, u.first_name || ' ' || u.last_name AS agent_name,
                                 COUNT(cl.claim_id) AS total_claims, ROUND(SUM(cl.claim_amount),2) AS total_claim_amount
                          FROM Claims cl JOIN Insurance_Policies ip ON cl.policy_id = ip.policy_id
                          JOIN Agents a ON ip.agent_id = a.agent_id JOIN Users u ON a.user_id = u.user_id
                          WHERE a.agent_id = ? AND CAST(strftime('%m', cl.claim_date) AS INTEGER) = ?
                            AND CAST(strftime('%Y', cl.claim_date) AS INTEGER) = ?
                          GROUP BY a.agent_id`, [agentId, Number(month), Number(year)]);
        },
        UpdateCustomerAgentPolicies(customerId, newAgentId, currentAgentId) {
          return e.tx(() => {
            e.db.run(`UPDATE Insurance_Policies SET agent_id = ?
                      WHERE agent_id = ? AND policy_id IN (SELECT policy_id FROM Customer_Policies WHERE customer_id = ?)`,
                     [newAgentId, currentAgentId, customerId]);
            const n = e.db.getRowsModified();
            e.db.run("DELETE FROM Agent_Customers WHERE customer_id = ? AND agent_id = ?", [customerId, currentAgentId]);
            e.db.run("INSERT OR IGNORE INTO Agent_Customers (agent_id, customer_id) VALUES (?,?)", [newAgentId, customerId]);
            return [{ policies_transferred: n }];
          });
        },
        AssignUserRole(userId, roleName) {
          return e.tx(() => {
            const rid = e.scalar("SELECT role_id FROM User_Roles WHERE role_name = ?", [roleName]);
            if (rid === null) throw new Error(`Unknown role '${roleName}'`);
            e.db.run("UPDATE Users SET role_id = ? WHERE user_id = ?", [rid, userId]);
            return [{ users_updated: e.db.getRowsModified() }];
          });
        },
        AddPaymentMethod(method) {
          return e.tx(() => {
            const exists = e.scalar("SELECT 1 FROM Payment_Methods WHERE payment_method = ?", [method]);
            if (!exists) e.db.run("INSERT INTO Payment_Methods (payment_method) VALUES (?)", [method]);
            return [{ result: exists ? `'${method}' already exists. Nothing inserted` : `'${method}' added` }];
          });
        },
      };
    }

    // ---------- SQL editor: run text, supporting CALL Proc(...) ----------
    run(sqlText) {
      const results = [];
      const procs = this.procedures();
      const parts = splitStatements(sqlText);
      for (const stmt of parts) {
        const call = stmt.match(/^\s*CALL\s+(\w+)\s*\(([\s\S]*)\)\s*$/i);
        if (call) {
          const name = Object.keys(procs).find((k) => k.toLowerCase() === call[1].toLowerCase());
          if (!name) throw new Error(`PROCEDURE ${call[1]} does not exist`);
          const args = parseArgs(call[2], this);
          const rows = procs[name](...args);
          results.push(toResult(rows, `CALL ${name}`));
        } else {
          const r = this.db.exec(stmt);
          if (r.length) r.forEach((x) => results.push({ columns: x.columns, values: x.values, label: null }));
          else {
            const n = this.db.getRowsModified();
            results.push({ columns: [], values: [], label: `OK. ${n} row(s) affected` });
            if (/^\s*(insert|update|delete|create|drop|alter|replace)/i.test(stmt)) this.changeCount++;
          }
        }
      }
      return results;
    }
  }

  function toResult(rows, label) {
    if (!rows || !rows.length) return { columns: [], values: [], label: `${label}: no rows` };
    const columns = Object.keys(rows[0]);
    return { columns, values: rows.map((r) => columns.map((c) => r[c])), label };
  }

  // split on ; outside quotes and comments
  function splitStatements(text) {
    const out = [];
    let cur = "", q = null;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], nx = text[i + 1];
      if (!q && ch === "-" && nx === "-") { const j = text.indexOf("\n", i); i = j < 0 ? text.length : j; cur += "\n"; continue; }
      if (!q && ch === "/" && nx === "*") { const j = text.indexOf("*/", i + 2); i = j < 0 ? text.length : j + 1; continue; }
      if (q) { if (ch === q) q = null; }
      else if (ch === "'" || ch === '"' || ch === "`") q = ch;
      if (!q && ch === ";") { if (cur.trim()) out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out.map((s) => s.replace(/`/g, '"'));
  }

  function parseArgs(text, engine) {
    const args = [];
    let cur = "", q = null, depth = 0;
    const push = () => {
      const t = cur.trim();
      if (t === "") return;
      if (/^'.*'$/s.test(t) || /^".*"$/s.test(t)) args.push(t.slice(1, -1).replace(/''/g, "'"));
      else if (/^-?\d+(\.\d+)?$/.test(t)) args.push(Number(t));
      else if (/^null$/i.test(t)) args.push(null);
      else args.push(engine.scalar("SELECT " + t)); // expressions like CURDATE() or (SELECT ...)
    };
    for (const ch of text) {
      if (q) { cur += ch; if (ch === q) q = null; continue; }
      if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { push(); cur = ""; continue; }
      cur += ch;
    }
    push();
    return args;
  }

  Engine.ANCHOR = ANCHOR;
  Engine.splitStatements = splitStatements;
  if (typeof module !== "undefined" && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== "undefined" ? window : globalThis);
