/* Insurance Management DB — interactive playground UI */
(async function () {
  "use strict";
  const REPO = "https://github.com/divyasakre/insurance-management-db";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const toast = (msg) => { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200); };

  // ------------------------------------------------------------------ load
  let E, SRC = {};
  try {
    const [SQL, schema, seed, triggers, mysql3, mysql4] = await Promise.all([
      initSqlJs({ locateFile: (f) => "assets/vendor/" + f }),
      fetch("data/schema_sqlite.sql").then((r) => r.text()),
      fetch("data/mysql/02_seed_data.sql").then((r) => r.text()),
      fetch("data/triggers_sqlite.sql").then((r) => r.text()),
      fetch("data/mysql/03_programmability.sql").then((r) => r.text()),
      fetch("data/mysql/04_complex_queries.sql").then((r) => r.text()),
    ]);
    SRC = { mysql3, mysql4 };
    E = new Engine(SQL, { schema, seed, triggers });
  } catch (err) {
    $("#loading").innerHTML = `<div class="err">Could not start the database: ${esc(err.message)}</div>`;
    return;
  }
  $("#loading").remove();
  const P = () => E.procedures();
  const Q = (sql, p) => E.query(sql, p);
  const S = (sql, p) => E.scalar(sql, p);

  // ------------------------------------------------------------------ SQL helpers
  const KW = new Set((`SELECT|FROM|WHERE|JOIN|LEFT|INNER|OUTER|ON|GROUP|BY|ORDER|HAVING|AS|AND|OR|NOT|IN|IS|NULL|EXISTS|CASE|WHEN|THEN|ELSE|END|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|VIEW|TRIGGER|PROCEDURE|FUNCTION|EVENT|BEGIN|DECLARE|RETURN|RETURNS|IF|CALL|LIMIT|DISTINCT|COUNT|SUM|AVG|MAX|MIN|ROUND|COALESCE|IFNULL|CONCAT|BETWEEN|INTERVAL|DAY|DESC|ASC|AFTER|BEFORE|FOR|EACH|ROW|NEW|OLD|DELIMITER|START|TRANSACTION|COMMIT|ROLLBACK|HANDLER|EXIT|SQLEXCEPTION|RESIGNAL|READS|SQL|DATA|DETERMINISTIC|IGNORE|REPLACE|SCHEDULE|EVERY|DO|LIKE|UNIQUE|PRIMARY|KEY|FOREIGN|REFERENCES|CASCADE|INT|INTEGER|VARCHAR|DECIMAL|DATE|TEXT|ENUM|TIMESTAMP|DATETIME|DEFAULT|CHECK|AUTO_INCREMENT|USE|DATABASE|DROP|INDEX|CURDATE|DATEDIFF|CAST`).split("|"));
  function hl(sql) {
    const out = [];
    const re = /(--[^\n]*)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]+)|([\s\S])/g;
    let m;
    while ((m = re.exec(sql))) {
      if (m[1]) out.push(`<span class="cm">${esc(m[1])}</span>`);
      else if (m[2]) out.push(`<span class="str">${esc(m[2])}</span>`);
      else if (m[3]) out.push(`<span class="num">${m[3]}</span>`);
      else if (m[4]) out.push(KW.has(m[4].toUpperCase()) ? `<span class="kw">${m[4]}</span>` : esc(m[4]));
      else out.push(esc(m[5]));
    }
    return out.join("");
  }
  const pre = (sql) => `<pre class="code">${hl(sql.trim())}</pre>`;
  const codeDetails = (label, code) => `<details class="sql"><summary>${label}</summary>${pre(code)}</details>`;
  function sqlDetails(runSql, mysqlSql, label = "Show the SQL") {
    if (!mysqlSql) return `<details class="sql"><summary>${label}</summary>${pre(runSql)}</details>`;
    const id = "c" + Math.random().toString(36).slice(2, 8);
    return `<details class="sql"><summary>${label}</summary>
      <div class="code-tabs" data-group="${id}">
        <button class="active" data-pane="m">Original MySQL</button><button data-pane="s">Running in your browser (SQLite)</button></div>
      <div data-for="${id}" data-pane="m">${pre(mysqlSql)}</div>
      <div data-for="${id}" data-pane="s" hidden>${pre(runSql)}</div></details>`;
  }
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest(".code-tabs button");
    if (!b) return;
    const g = b.parentElement.dataset.group;
    $$("button", b.parentElement).forEach((x) => x.classList.toggle("active", x === b));
    $$(`[data-for="${g}"]`).forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.pane));
  });

  // extract MySQL source for a query (from 04) or an object (from 03)
  function mysqlQuery(marker) {
    const L = SRC.mysql4.split("\n");
    const i = L.findIndex((l) => l.includes(marker));
    if (i < 0) return null;
    let s = i; if (L[s - 1]?.startsWith("-- ---")) s--;
    let j = i + 1; while (j < L.length && !/^-- Q\d+\./.test(L[j])) j++;
    if (L[j - 1]?.startsWith("-- ---")) j--;
    return L.slice(s, j).join("\n").trim();
  }
  function mysqlObject(name) {
    const txt = SRC.mysql3;
    const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?(TRIGGER|PROCEDURE|FUNCTION|VIEW|EVENT)(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${name}\\b`, "i");
    const m = re.exec(txt);
    if (!m) return null;
    let start = m.index;
    const before = txt.slice(0, start).split("\n"); before.pop();
    const comments = [];
    while (before.length && /^--/.test(before[before.length - 1]) && !/^-- =+$/.test(before[before.length - 1])) comments.unshift(before.pop());
    const kind = m[1].toUpperCase();
    let end = kind === "VIEW" || kind === "EVENT" ? txt.indexOf(";", start) + 1 : txt.indexOf("END$$", start) + 5;
    return (comments.length ? comments.join("\n") + "\n" : "") + txt.slice(start, end);
  }

  // ------------------------------------------------------------------ tables
  function table(res, opts = {}) {
    const isRows = Array.isArray(res); // array of row objects vs. {columns, values}
    const cols = isRows ? (res[0] ? Object.keys(res[0]) : []) : res.columns;
    const vals = isRows ? res.map((r) => cols.map((c) => r[c])) : res.values;
    if (!vals.length) return `<div class="empty">${opts.empty || "No rows."}</div>`;
    const hi = opts.highlight;
    const body = vals.map((row) => {
      const fresh = hi && hi(row, cols) ? ' class="fresh"' : "";
      return `<tr${fresh}>` + row.map((v, k) => {
        if (v === null) return `<td class="null">NULL</td>`;
        const isNum = typeof v === "number";
        const moneyCol = isNum && /amount|paid|premium|value/i.test(cols[k]);
        const shown = moneyCol ? money(v) : isNum && !Number.isInteger(v) ? v.toFixed(2) : v;
        return `<td${isNum ? ' class="num"' : ""}>${esc(shown)}</td>`;
      }).join("") + "</tr>";
    }).join("");
    return `<div class="table-wrap"><table class="data"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="rowcount">${vals.length} row${vals.length === 1 ? "" : "s"}</div>`;
  }
  const kpi = (label, value, src) => `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div>${src ? `<div class="src">${esc(src)}</div>` : ""}</div>`;
  const options = (rows, val, lab, sel) => rows.map((r) => `<option value="${esc(r[val])}"${String(r[val]) === String(sel) ? " selected" : ""}>${esc(r[lab])}</option>`).join("");
  function happened(title, items) {
    return `<div class="happened"><h4>${title}</h4><ol>${items.map((i) => `<li>${i}</li>`).join("")}</ol></div>`;
  }
  const errBox = (e) => `<div class="err">${esc(e.message || e)}</div>`;
  const lastLogId = () => S("SELECT IFNULL(MAX(log_id),0) FROM Logs");
  const logsSince = (id) => Q("SELECT action FROM Logs WHERE log_id > ? ORDER BY log_id", [id]).map((r) => r.action);

  // ------------------------------------------------------------------ routing
  const views = {};
  let current = "overview";
  function show(name) {
    current = name;
    $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    $$("section.view").forEach((s) => s.classList.toggle("active", s.id === "view-" + name));
    views[name]();
    history.replaceState(null, "", "#" + name);
  }
  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.view); });
  $("#reset-btn").addEventListener("click", () => { E.reset(); state.fresh = {}; views[current](); toast("Database reset to the original sample data"); });

  const state = { customer: null, agent: null, fresh: {}, filter: "All" };

  // ================================================================== OVERVIEW
  views.overview = function () {
    const k = Q(`SELECT (SELECT COUNT(*) FROM Customers) c,
                        (SELECT COUNT(*) FROM Insurance_Policies WHERE status IN ('active','under review')) p,
                        (SELECT COUNT(*) FROM Claims WHERE claim_status_id = 1) cl,
                        (SELECT SUM(amount_paid) FROM Payments) pay`)[0];
    $("#view-overview").innerHTML = `
    <div class="hero">
      <div class="panel">
        <h2>A relational database for running an insurance business</h2>
        <p>Customers, agents, branches, policies, claims, payments, beneficiaries and an audit trail, modeled in
        <b>MySQL 8</b> as a normalized schema with lookup and junction tables and deliberate foreign-key rules.
        Stored procedures and triggers automate the busy work, a scheduled event expires policies every night,
        and 13 analytics queries answer real business questions.</p>
        <p>Everything below runs <b>live in your browser</b>, so feel free to try things. You can always hit <b>Reset database</b>.</p>
        <div class="try-list">
          <button class="try" data-go="customer"><div><div class="t">File a claim as a customer</div><div class="d">Watch two triggers fire: the claim is logged and the policy is flagged for review.</div></div><span class="go">→</span></button>
          <button class="try" data-go="agent"><div><div class="t">Onboard a new customer in one call</div><div class="d">A transactional procedure creates the user, customer, policy and links. Try a duplicate email to see it roll back.</div></div><span class="go">→</span></button>
          <button class="try" data-go="queries"><div><div class="t">Run the 13 business queries</div><div class="d">Renewal lists, churn risk, agent leaderboards, duplicate coverage…</div></div><span class="go">→</span></button>
          <button class="try" data-go="editor"><div><div class="t">Write your own SQL</div><div class="d">Full SQL editor with every table, plus <code>CALL</code> for the stored procedures.</div></div><span class="go">→</span></button>
        </div>
      </div>
      <div class="panel">
        <h3>About this project</h3>
        <p class="hint">Course project for BUAN 6320 Database Foundations for Business Analytics, Jindal School of Management,
        The University of Texas at Dallas (Spring 2025). Later re-tested end to end on MySQL 8.0, debugged, and turned into this live playground.</p>
        <ul class="team">
          <li><b>Database:</b> <span class="role">MySQL 8.0 · tested on MariaDB 10.11</span></li>
          <li><b>Concepts:</b> <span class="role">normalization (3NF), junction tables, referential actions, transactions &amp; rollback, triggers, events, views</span></li>
          <li><b>Analytics:</b> <span class="role">multi-table joins, correlated &amp; derived subqueries, <code>GROUP BY … HAVING</code>, <code>NOT EXISTS</code>, CTEs</span></li>
          <li><b>Playground:</b> <span class="role">SQLite → WebAssembly (sql.js), vanilla JavaScript, GitHub Pages</span></li>
        </ul>
      </div>
    </div>
    <div class="grid g4" style="margin-top:16px">
      ${kpi("Customers", k.c, "SELECT COUNT(*) FROM Customers")}
      ${kpi("Active policies", k.p, "status IN ('active','under review')")}
      ${kpi("Pending claims", k.cl, "claim_status = 'pending'")}
      ${kpi("Premium collected", money(k.pay), "SUM(Payments.amount_paid)")}
    </div>
    <div class="grid g3" style="margin-top:16px">
      <div class="panel"><h3>Design</h3><p class="hint">17 tables in third normal form: 4 lookup tables, 2 many-to-many junction tables (agents ↔ customers, customers ↔ policies), and <code>CASCADE</code> / <code>SET NULL</code> rules chosen per relationship. CHECK and UNIQUE constraints guard data quality.</p></div>
      <div class="panel"><h3>Automation</h3><p class="hint">9 stored procedures, 7 functions and 10 triggers: atomic onboarding with rollback, claim filing, agent transfers, activity logging, before-update audit tables, and a daily <code>EVENT</code> that expires overdue policies.</p></div>
      <div class="panel"><h3>Analytics</h3><p class="hint">13 queries built on joins, subqueries, <code>GROUP BY … HAVING</code>, <code>NOT EXISTS</code> and a view: renewal pipeline, churn risk, duplicate coverage, agent and branch performance, claim approval gaps.</p></div>
    </div>
    <p class="hint" style="margin-top:14px">Sample data: 78 fictional users, 132 policies, ~350 payments. Dates are shifted to today each time the page loads, so “expiring in 30 days” always has results.</p>`;
    $$("#view-overview .try").forEach((b) => b.addEventListener("click", () => show(b.dataset.go)));
  };

  // ================================================================== CUSTOMER PORTAL
  views.customer = function (flash) {
    const custs = Q(`SELECT c.customer_id, u.first_name || ' ' || u.last_name || '  (#' || c.customer_id || ')' AS label
                     FROM Customers c JOIN Users u ON u.user_id = c.user_id ORDER BY u.last_name, u.first_name`);
    if (!state.customer || !custs.some((c) => c.customer_id == state.customer))
      state.customer = S(`SELECT cp.customer_id FROM Customer_Policies cp JOIN Claims cl ON cl.policy_id = cp.policy_id
                          WHERE cp.status = 'active' GROUP BY cp.customer_id ORDER BY COUNT(*) DESC LIMIT 1`) || custs[0].customer_id;
    const id = Number(state.customer);
    const prof = Q(`SELECT u.first_name, u.last_name, u.email, c.national_id FROM Customers c JOIN Users u ON u.user_id = c.user_id WHERE c.customer_id = ?`, [id])[0];
    const agents = Q(`SELECT DISTINCT u.first_name || ' ' || u.last_name AS n FROM Agent_Customers ac JOIN Agents a ON a.agent_id = ac.agent_id
                      JOIN Users u ON u.user_id = a.user_id WHERE ac.customer_id = ?`, [id]).map((r) => r.n);
    const polSql = `SELECT ip.policy_id, pt.policy_type, ip.policy_amount, cp.start_date, cp.end_date,
       ip.status, GetTotalClaims(ip.policy_id) AS claims
FROM Customer_Policies cp
JOIN Insurance_Policies ip ON ip.policy_id = cp.policy_id
JOIN Policy_Types pt ON pt.policy_type_id = ip.policy_type_id
WHERE cp.customer_id = ${id}
ORDER BY cp.end_date DESC;`;
    const claimSql = `SELECT cl.claim_id, cl.policy_id, cl.claim_date, cl.claim_amount,
       GetClaimStatusLabel(cl.claim_id) AS status
FROM Claims cl
JOIN Customer_Policies cp ON cp.policy_id = cl.policy_id
WHERE cp.customer_id = ${id}
ORDER BY cl.claim_date DESC;`;
    const paySql = `SELECT p.payment_date, p.policy_holder_id, cp.policy_id, p.amount_paid, pm.payment_method, p.transaction_id
FROM Payments p
JOIN Customer_Policies cp ON cp.policy_holder_id = p.policy_holder_id
JOIN Payment_Methods pm ON pm.payment_method_id = p.payment_method_id
WHERE cp.customer_id = ${id}
ORDER BY p.payment_date DESC;`;
    const benSql = `SELECT b.beneficiary_id, b.policy_id, b.full_name, b.relationship
FROM Beneficiaries b WHERE b.customer_id = ${id};`;
    const pols = Q(polSql);
    const openPols = pols.filter((p) => p.status !== "cancelled");
    const fresh = state.fresh;

    $("#view-customer").innerHTML = `
      <div class="section-head"><div><h2>Customer portal</h2>
        <p>What a policyholder sees. The tiles are the database's MySQL <b>functions</b>, called live. Filing a claim runs the
        <code>FileClaim</code> procedure and fires two triggers.</p></div>
        <div class="picker"><label class="f" for="cust-pick">Viewing as</label><select id="cust-pick">${options(custs, "customer_id", "label", id)}</select></div></div>
      <div class="panel" style="margin-bottom:16px"><b>${esc(prof.first_name)} ${esc(prof.last_name)}</b>
        <span class="hint"> · ${esc(prof.email)} · ID ${esc(prof.national_id)} · Agent${agents.length > 1 ? "s" : ""}: ${esc(agents.join(", ") || "none")}</span></div>
      <div class="grid g4">
        ${kpi("Active policies", S("SELECT GetActivePolicyCount(?)", [id]), `GetActivePolicyCount(${id})`)}
        ${kpi("Total premium paid", money(S("SELECT GetTotalPremiumPaid(?)", [id])), `GetTotalPremiumPaid(${id})`)}
        ${kpi("Risk factor", Number(S("SELECT CalculateRiskFactor(?)", [id])).toFixed(2), `CalculateRiskFactor(${id})`)}
        ${kpi("Avg rating given", Number(S("SELECT CalculateAverageRating(?)", [id])).toFixed(2), `CalculateAverageRating(${id})`)}
      </div>
      <div class="grid g2" style="margin-top:16px">
        <div class="panel"><h3>My policies</h3>${table(pols, { highlight: (r) => fresh.policy && r[0] === fresh.policy })}${sqlDetails(polSql)}</div>
        <div class="panel"><h3>File a claim</h3>
          <p class="hint">Runs <code>CALL FileClaim(policy, amount, date)</code>. The claim starts as <i>pending</i>.</p>
          ${openPols.length ? `<div class="form-row">
            <div><label class="f">Policy</label><select id="fc-policy">${options(openPols.map((p) => ({ v: p.policy_id, l: `#${p.policy_id} · ${p.policy_type} · ${p.status}` })), "v", "l")}</select></div>
            <div><label class="f">Amount ($)</label><input id="fc-amt" type="number" min="1" step="0.01" value="450"></div>
            <div><label class="f">Date</label><input id="fc-date" type="date" value="${E.today}"></div>
            <div><button class="btn primary" id="fc-go">File claim</button></div></div>` : `<div class="empty">This customer has no open policies.</div>`}
          <div id="fc-out">${flash && flash.fc || ""}</div>
          ${codeDetails("Show the procedure + triggers (MySQL)", mysqlObject("FileClaim") + "\n\n" + mysqlObject("log_new_claim") + "\n\n" + mysqlObject("trg_UpdatePolicyStatusOnClaim"))}
        </div>
      </div>
      <div class="grid g2" style="margin-top:16px">
        <div class="panel"><h3>My claims</h3>${table(Q(claimSql), { empty: "No claims yet.", highlight: (r) => fresh.claim && r[0] === fresh.claim })}${sqlDetails(claimSql)}</div>
        <div class="panel"><h3>Beneficiaries</h3>${table(Q(benSql), { empty: "No beneficiaries on file.", highlight: (r) => fresh.ben && r[0] === fresh.ben })}
          <div class="form-row">
            <div><label class="f">Policy</label><select id="ab-policy">${options(pols.map((p) => ({ v: p.policy_id, l: `#${p.policy_id} · ${p.policy_type}` })), "v", "l")}</select></div>
            <div><label class="f">Full name</label><input id="ab-name" value="Alex ${esc(prof.last_name)}"></div>
            <div><label class="f">Relationship</label><select id="ab-rel">${["spouse", "child", "parent", "sibling", "other"].map((r) => `<option>${r}</option>`).join("")}</select></div>
            <div><button class="btn" id="ab-go">Add beneficiary</button></div></div>
          <p class="hint">Runs <code>CALL AddBeneficiary(…)</code></p>${sqlDetails(benSql)}</div>
      </div>
      <div class="panel" style="margin-top:16px"><h3>Payment history</h3>${table(Q(paySql), { empty: "No payments on record." })}${sqlDetails(paySql)}</div>`;

    $("#cust-pick").addEventListener("change", (e) => { state.customer = e.target.value; state.fresh = {}; views.customer(); });
    $("#fc-go")?.addEventListener("click", () => {
      const pid = Number($("#fc-policy").value), amt = Number($("#fc-amt").value), dt = $("#fc-date").value;
      const before = S("SELECT status FROM Insurance_Policies WHERE policy_id = ?", [pid]);
      const l0 = lastLogId();
      try {
        const [r] = P().FileClaim(pid, amt, dt);
        const after = S("SELECT status FROM Insurance_Policies WHERE policy_id = ?", [pid]);
        const logs = logsSince(l0);
        state.fresh = { claim: r.new_claim_id, policy: pid };
        views.customer({ fc: happened("What just happened", [
          `<b>FileClaim</b> inserted claim <b>#${r.new_claim_id}</b> for ${money(amt)} with status <i>pending</i>.`,
          `Trigger <b>log_new_claim</b> wrote to <code>Logs</code>: “${esc(logs[0] || "")}”.`,
          before === after
            ? `Trigger <b>trg_UpdatePolicyStatusOnClaim</b> left policy #${pid} as <i>${esc(after)}</i> (only <i>active</i> policies get flagged).`
            : `Trigger <b>trg_UpdatePolicyStatusOnClaim</b> changed policy #${pid} from <i>${esc(before)}</i> to <b>${esc(after)}</b>.`,
        ]) });
      } catch (e) { $("#fc-out").innerHTML = errBox(e); }
    });
    $("#ab-go").addEventListener("click", () => {
      try {
        const [r] = P().AddBeneficiary(id, Number($("#ab-policy").value), $("#ab-name").value.trim(), $("#ab-rel").value);
        state.fresh = { ben: r.new_beneficiary_id };
        views.customer(); toast(`Beneficiary #${r.new_beneficiary_id} added`);
      } catch (e) { toast(e.message); }
    });
  };

  // ================================================================== AGENT DESK
  views.agent = function (flash) {
    const ags = Q(`SELECT a.agent_id, u.first_name || ' ' || u.last_name || ' · ' || b.location_name || '  (#' || a.agent_id || ')' AS label
                   FROM Agents a JOIN Users u ON u.user_id = a.user_id LEFT JOIN Branches b ON b.branch_id = a.branch_id ORDER BY a.agent_id`);
    if (!state.agent) // open on the agent with the busiest renewal pipeline
      state.agent = S(`SELECT agent_id FROM Insurance_Policies WHERE end_date BETWEEN date('now') AND date('now','+30 days')
                       AND status IN ('active','under review') GROUP BY agent_id ORDER BY COUNT(*) DESC, agent_id LIMIT 1`) || 1;
    const id = Number(state.agent);
    const custSql = `SELECT c.customer_id, u.first_name || ' ' || u.last_name AS customer,
       GetActivePolicyCount(c.customer_id) AS active_policies,
       GetTotalPremiumPaid(c.customer_id)  AS premium_paid,
       CalculateRiskFactor(c.customer_id)  AS risk
FROM Agent_Customers ac
JOIN Customers c ON c.customer_id = ac.customer_id
JOIN Users u ON u.user_id = c.user_id
WHERE ac.agent_id = ${id}
ORDER BY premium_paid DESC;`;
    const renewSql = `SELECT ip.policy_id, u.first_name || ' ' || u.last_name AS customer, pt.policy_type, ip.end_date,
       CAST(julianday(ip.end_date) - julianday(date('now')) AS INTEGER) AS days_left
FROM Insurance_Policies ip
JOIN Policy_Types pt ON pt.policy_type_id = ip.policy_type_id
JOIN Customer_Policies cp ON cp.policy_id = ip.policy_id
JOIN Customers c ON c.customer_id = cp.customer_id
JOIN Users u ON u.user_id = c.user_id
WHERE ip.agent_id = ${id}
  AND ip.end_date BETWEEN date('now') AND date('now', '+30 days')
  AND ip.status IN ('active', 'under review')
ORDER BY days_left;`;
    const custs = Q(custSql);
    const k = Q(`SELECT COUNT(*) n, IFNULL(SUM(policy_amount),0) v FROM Insurance_Policies WHERE agent_id = ?`, [id])[0];
    const renew = Q(renewSql);
    const now = new Date(E.today + "T00:00:00");
    if (state.monthFor !== id) { // default to this agent's most recent month with claims
      const last = S(`SELECT MAX(cl.claim_date) FROM Claims cl JOIN Insurance_Policies ip ON ip.policy_id = cl.policy_id WHERE ip.agent_id = ?`, [id]);
      const d = last ? new Date(last + "T00:00:00") : now;
      state.month = d.getMonth() + 1; state.year = d.getFullYear(); state.monthFor = id;
    }
    const m = state.month, y = state.year;
    const summary = P().GetMonthlyClaimSummary(id, m, y);
    const others = ags.filter((a) => a.agent_id !== id);
    const n = S("SELECT COUNT(*) FROM Customers") + 1;
    const fresh = state.fresh;

    $("#view-agent").innerHTML = `
      <div class="section-head"><div><h2>Agent desk</h2>
        <p>An agent's working view: their book of customers, the renewal pipeline, monthly claim activity, and two stored
        procedures: one-call onboarding and customer transfers.</p></div>
        <div class="picker"><label class="f" for="ag-pick">Agent</label><select id="ag-pick">${options(ags, "agent_id", "label", id)}</select></div></div>
      <div class="grid g4">
        ${kpi("Customers", custs.length, "Agent_Customers")}
        ${kpi("Policies sold", k.n, "Insurance_Policies.agent_id")}
        ${kpi("Book value", money(k.v), "SUM(policy_amount)")}
        ${kpi("Renewals due (30 days)", renew.length, "renewal query")}
      </div>
      <div class="grid g2" style="margin-top:16px">
        <div class="panel"><h3>Onboard a new customer</h3>
          <p class="hint"><code>AddNewCustomerWithPolicy</code> creates the user account, customer record, policy, the customer↔policy link
          and the agent assignment <b>in one transaction</b>. If any step fails, everything rolls back.</p>
          <div class="form-row">
            <div><label class="f">First name</label><input id="on-fn" value="Riya"></div>
            <div><label class="f">Last name</label><input id="on-ln" value="Menon"></div>
            <div><label class="f">Email</label><input id="on-em" value="riya.menon${n}@example.com"></div>
          </div>
          <div class="form-row">
            <div><label class="f">Policy type</label><select id="on-type">${options(Q("SELECT policy_type_id, policy_type FROM Policy_Types"), "policy_type_id", "policy_type", 1)}</select></div>
            <div><label class="f">Premium ($)</label><input id="on-amt" type="number" value="2400"></div>
            <div><label class="f">Start</label><input id="on-start" type="date" value="${E.today}"></div>
            <div><label class="f">End</label><input id="on-end" type="date" value="${S("SELECT date('now','+1 year')")}"></div>
          </div>
          <div class="editor-bar"><button class="btn primary" id="on-go">Onboard customer</button>
            <button class="btn" id="on-dup" title="Re-uses an email that already exists">Try a duplicate email (rollback demo)</button></div>
          <div id="on-out">${flash && flash.on || ""}</div>
          ${codeDetails("Show the procedure (MySQL)", mysqlObject("AddNewCustomerWithPolicy"))}
        </div>
        <div class="panel"><h3>Renewals due in the next 30 days</h3>
          ${table(renew, { empty: "No renewals due for this agent in the next 30 days. Try another agent." })}${sqlDetails(renewSql)}
          <h3 style="margin-top:18px">Monthly claim summary</h3>
          <div class="form-row">
            <div><label class="f">Month</label><select id="ms-m">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}"${i + 1 === m ? " selected" : ""}>${new Date(2000, i, 1).toLocaleString("en", { month: "long" })}</option>`).join("")}</select></div>
            <div><label class="f">Year</label><select id="ms-y">${[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()].map((v) => `<option${v === y ? " selected" : ""}>${v}</option>`).join("")}</select></div>
          </div>
          ${table(summary, { empty: `No claims on this agent's policies in that month.` })}
          <p class="hint">Runs <code>CALL GetMonthlyClaimSummary(${id}, ${m}, ${y})</code></p>
        </div>
      </div>
      <div class="grid g2" style="margin-top:16px">
        <div class="panel"><h3>My customers</h3>${table(custs, { empty: "This agent has no customers assigned.", highlight: (r) => fresh.customer && r[0] === fresh.customer })}${sqlDetails(custSql)}</div>
        <div class="panel"><h3>Transfer a customer to another agent</h3>
          <p class="hint"><code>UpdateCustomerAgentPolicies(customer, new_agent, current_agent)</code> moves the customer and the policies
          this agent sold them.</p>
          ${custs.length ? `<div class="form-row">
            <div><label class="f">Customer</label><select id="tr-c">${options(custs, "customer_id", "customer")}</select></div>
            <div><label class="f">New agent</label><select id="tr-a">${options(others, "agent_id", "label")}</select></div>
            <div><button class="btn primary" id="tr-go">Transfer</button></div></div>` : `<div class="empty">No customers to transfer.</div>`}
          <div id="tr-out">${flash && flash.tr || ""}</div>
          ${codeDetails("Show the procedure (MySQL)", mysqlObject("UpdateCustomerAgentPolicies"))}
        </div>
      </div>`;

    $("#ag-pick").addEventListener("change", (e) => { state.agent = e.target.value; state.fresh = {}; views.agent(); });
    $("#ms-m").addEventListener("change", (e) => { state.month = Number(e.target.value); views.agent(); });
    $("#ms-y").addEventListener("change", (e) => { state.year = Number(e.target.value); views.agent(); });
    const counts = () => Q(`SELECT (SELECT COUNT(*) FROM Users) u, (SELECT COUNT(*) FROM Customers) c, (SELECT COUNT(*) FROM Insurance_Policies) p`)[0];
    const onboard = (email) => {
      const c0 = counts();
      try {
        const [r] = P().AddNewCustomerWithPolicy($("#on-fn").value.trim(), $("#on-ln").value.trim(), email, "sha256-demo-hash",
          "NID-" + Date.now().toString().slice(-9), id, Number($("#on-type").value), Number($("#on-amt").value), $("#on-start").value, $("#on-end").value);
        state.fresh = { customer: r.new_customer_id };
        views.agent({ on: happened("Customer onboarded in a single transaction", [
          `<code>Users</code> → new user <b>#${r.new_user_id}</b> with the <i>customer</i> role`,
          `<code>Customers</code> → new customer <b>#${r.new_customer_id}</b>`,
          `<code>Insurance_Policies</code> → new policy <b>#${r.new_policy_id}</b> (active)`,
          `<code>Customer_Policies</code> + <code>Agent_Customers</code> → linked to the policy and to this agent (highlighted below)`,
        ]) });
      } catch (e) {
        const c1 = counts();
        $("#on-out").innerHTML = `${errBox(e)}<div class="ok">Rolled back. Users ${c0.u}→${c1.u}, Customers ${c0.c}→${c1.c}, Policies ${c0.p}→${c1.p}. No partial records were left behind.</div>`;
      }
    };
    $("#on-go").addEventListener("click", () => onboard($("#on-em").value.trim()));
    $("#on-dup").addEventListener("click", () => onboard(S("SELECT email FROM Users WHERE role_id = 1 LIMIT 1")));
    $("#tr-go")?.addEventListener("click", () => {
      const cid = Number($("#tr-c").value), to = Number($("#tr-a").value);
      const name = custs.find((c) => c.customer_id === cid).customer;
      const toName = others.find((a) => a.agent_id === to).label;
      try {
        const [r] = P().UpdateCustomerAgentPolicies(cid, to, id);
        views.agent({ tr: happened("Transfer complete", [
          `${r.policies_transferred} polic${r.policies_transferred === 1 ? "y" : "ies"} sold by this agent to <b>${esc(name)}</b> now belong to ${esc(toName)}.`,
          `<code>Agent_Customers</code>: removed from this agent, assigned to the new one (duplicate-safe).`,
          `Switch the agent picker to see them in the new agent's book.`,
        ]) });
      } catch (e) { $("#tr-out").innerHTML = errBox(e); }
    });
  };

  // ================================================================== ADMIN CONSOLE
  views.admin = function (flash) {
    const k = Q(`SELECT (SELECT COUNT(*) FROM Users) u, (SELECT COUNT(*) FROM Agents) a, (SELECT COUNT(*) FROM Branches) b, (SELECT COUNT(*) FROM Logs) l`)[0];
    const bars = (rows, lab, val, fmt = (v) => v) => {
      const max = Math.max(...rows.map((r) => r[val]), 1);
      return `<div class="bars">${rows.map((r) => `<div class="bar"><div>${esc(r[lab])}</div><div class="track"><div class="fill" style="width:${(r[val] / max) * 100}%"></div></div><div class="n">${fmt(r[val])}</div></div>`).join("")}</div>`;
    };
    const q = (id) => QUERIES.find((x) => x.id === id).sql;
    const users = Q(`SELECT u.user_id, u.first_name || ' ' || u.last_name || ' · ' || r.role_name || '  (#' || u.user_id || ')' AS l FROM Users u LEFT JOIN User_Roles r ON r.role_id = u.role_id ORDER BY u.user_id`);
    const active = Q(`SELECT ip.policy_id, '#' || ip.policy_id || ' · ' || pt.policy_type || ' · ends ' || ip.end_date AS l FROM Insurance_Policies ip JOIN Policy_Types pt ON pt.policy_type_id = ip.policy_type_id WHERE ip.status = 'active' ORDER BY ip.end_date`);
    const branches = Q(`SELECT branch_id, location_name || ' · ' || contact_number AS l FROM Branches`);
    const logSql = `SELECT l.log_id, l.timestamp, IFNULL(u.first_name || ' ' || u.last_name, 'system') AS user, l.action
FROM Logs l LEFT JOIN Users u ON u.user_id = l.user_id
ORDER BY l.log_id DESC LIMIT 25;`;
    const auditT = state.audit || "users_audit";
    const fresh = state.fresh;

    $("#view-admin").innerHTML = `
      <div class="section-head"><div><h2>Admin console</h2>
        <p>Platform-wide analytics, the nightly maintenance job, and the audit trail. Every change you make here is captured by triggers.</p></div></div>
      <div class="grid g4">${kpi("Users", k.u)}${kpi("Agents", k.a)}${kpi("Branches", k.b)}${kpi("Log entries", k.l, "written by triggers")}</div>
      <div class="grid g3" style="margin-top:16px">
        <div class="panel"><h3>Users by role</h3>${bars(Q(q("q12")), "role_name", "users")}</div>
        <div class="panel"><h3>Payment methods</h3>${bars(Q(q("q13")), "payment_method", "transactions")}</div>
        <div class="panel"><h3>Avg policy value by branch</h3>${bars(Q(q("q10")).slice(0, 6), "location_name", "avg_policy_amount", (v) => "$" + Math.round(v).toLocaleString())}</div>
      </div>
      <div class="grid g2" style="margin-top:16px">
        <div class="panel"><h3>Nightly job: expire overdue policies</h3>
          <p class="hint">In MySQL, <code>expire_policies_event</code> runs <code>CALL ExpireOldPolicies()</code> every day. Pick an active policy,
          pretend it ended yesterday, then run the job and watch the <code>after_policy_expired</code> trigger log it.</p>
          <div class="form-row"><div><label class="f">Active policy</label><select id="ex-p">${options(active, "policy_id", "l")}</select></div>
            <div><button class="btn" id="ex-back">1. Set end date to yesterday</button></div></div>
          <div class="editor-bar"><button class="btn primary" id="ex-run">2. Run ExpireOldPolicies() now</button></div>
          <div id="ex-out">${flash && flash.ex || ""}</div>
          ${codeDetails("Show the procedure + event (MySQL)", mysqlObject("ExpireOldPolicies") + "\n\n" + mysqlObject("expire_policies_event"))}
        </div>
        <div class="panel"><h3>Change a user's role</h3>
          <p class="hint"><code>AssignUserRole(user, role)</code> fires two triggers: <code>trg_LogRoleChange</code> and the
          <code>before_users_update</code> audit.</p>
          <div class="form-row"><div><label class="f">User</label><select id="ro-u">${options(users, "user_id", "l", 19)}</select></div>
            <div><label class="f">New role</label><select id="ro-r"><option>agent</option><option>admin</option><option>customer</option></select></div>
            <div><button class="btn primary" id="ro-go">Assign role</button></div></div>
          <div id="ro-out">${flash && flash.ro || ""}</div>
          <h3 style="margin-top:16px">Update a branch phone number</h3>
          <div class="form-row"><div><label class="f">Branch</label><select id="br-b">${options(branches, "branch_id", "l")}</select></div>
            <div><label class="f">New number</label><input id="br-n" value="2145550199" maxlength="15"></div>
            <div><button class="btn" id="br-go">Save</button></div></div>
          <div id="br-out">${flash && flash.br || ""}</div>
        </div>
      </div>
      <div class="grid g2" style="margin-top:16px">
        <div class="panel"><h3>Activity log (latest 25)</h3>${table(Q(logSql), { highlight: (r) => fresh.log && r[0] > fresh.log })}${sqlDetails(logSql)}</div>
        <div class="panel"><h3>Audit tables</h3>
          <p class="hint">Filled automatically by <code>BEFORE UPDATE</code> / <code>AFTER DELETE</code> triggers. Each row is the record <i>as it was</i> before the change.</p>
          <div class="filters" id="audit-tabs">${["users_audit", "customers_audit", "agents_audit", "branches_audit", "Policy_Deletion_Log"].map((t) => `<button data-t="${t}" class="${t === auditT ? "active" : ""}">${t}</button>`).join("")}</div>
          ${table(E.db.exec(`SELECT * FROM ${auditT} ORDER BY rowid DESC LIMIT 25`)[0] || { columns: [], values: [] }, { empty: "Empty for now. Make a change on this page (or delete a Customer_Policies row in the SQL editor) to fill it." })}
        </div>
      </div>`;

    $("#ex-back").addEventListener("click", () => {
      const pid = Number($("#ex-p").value);
      E.db.run("UPDATE Insurance_Policies SET end_date = date('now','-1 day') WHERE policy_id = ?", [pid]);
      E.db.run("UPDATE Customer_Policies SET end_date = date('now','-1 day') WHERE policy_id = ?", [pid]);
      state.expire = pid;
      $("#ex-out").innerHTML = `<div class="ok">Policy #${pid} now ends ${esc(S("SELECT date('now','-1 day')"))}. It is still marked <i>active</i>. Now run the job.</div>`;
    });
    $("#ex-run").addEventListener("click", () => {
      const l0 = lastLogId();
      const [r] = P().ExpireOldPolicies();
      const logs = logsSince(l0);
      state.fresh = { log: l0 };
      views.admin({ ex: happened("Nightly job finished", [
        `<b>ExpireOldPolicies</b> marked <b>${r.policies_expired}</b> polic${r.policies_expired === 1 ? "y" : "ies"} as expired (${r.holder_rows_expired} customer link${r.holder_rows_expired === 1 ? "" : "s"} too).`,
        logs.length ? `Trigger <b>after_policy_expired</b> logged: ${logs.map((l) => `“${esc(l)}”`).join(", ")}` :
          `Nothing was overdue, so nothing was logged. Use step 1 first.`,
      ]) });
    });
    $("#ro-go").addEventListener("click", () => {
      const uid = Number($("#ro-u").value), role = $("#ro-r").value;
      const l0 = lastLogId();
      try {
        P().AssignUserRole(uid, role);
        const logs = logsSince(l0);
        state.fresh = { log: l0 }; state.audit = "users_audit";
        views.admin({ ro: happened("Role updated", [
          `<code>Users</code>: user #${uid} now has role <b>${esc(role)}</b>.`,
          logs.length ? `<b>trg_LogRoleChange</b> logged “${esc(logs[0])}”.` : `Role was unchanged, so <b>trg_LogRoleChange</b> logged nothing.`,
          `<b>before_users_update</b> saved the old row in <code>users_audit</code> (see Audit tables).`,
        ]) });
      } catch (e) { $("#ro-out").innerHTML = errBox(e); }
    });
    $("#br-go").addEventListener("click", () => {
      const bid = Number($("#br-b").value), num = $("#br-n").value.replace(/\D/g, "");
      try {
        E.db.run("UPDATE Branches SET contact_number = ? WHERE branch_id = ?", [num, bid]);
        state.audit = "branches_audit";
        views.admin({ br: `<div class="ok">Saved. The <code>before_branches_update</code> trigger copied the old number into <code>branches_audit</code>.</div>` });
      } catch (e) { $("#br-out").innerHTML = errBox(e); }
    });
    $$("#audit-tabs button").forEach((b) => b.addEventListener("click", () => { state.audit = b.dataset.t; views.admin(); }));
  };

  // ================================================================== 13 QUERIES
  views.queries = function () {
    const aud = { admin: "Management", agent: "Agents", customer: "Customers" };
    const groups = ["All", "admin", "agent", "customer"];
    const list = QUERIES.filter((q) => state.filter === "All" || q.audience === state.filter);
    $("#view-queries").innerHTML = `
      <div class="section-head"><div><h2>13 business queries</h2>
        <p>Each query answers a question an insurer actually asks. Click <b>Run</b> to execute it on the live data, and expand the code to compare the
        original MySQL with the in-browser version.</p></div>
        <button class="btn" id="run-all">Run all</button></div>
      <div class="filters" id="q-filters">${groups.map((a) => `<button data-a="${a}" class="${a === state.filter ? "active" : ""}">${a === "All" ? "All queries" : "For " + aud[a]}</button>`).join("")}</div>
      <div class="grid g2">${list.map((q, i) => `
        <div class="panel qcard" id="card-${q.id}">
          <div class="meta"><span class="badge">For ${aud[q.audience]}</span><span class="badge gray">Q${QUERIES.indexOf(q) + 1}</span></div>
          <h3>${esc(q.title)}</h3><p class="hint">${esc(q.why)}</p>
          <div class="actions"><button class="btn primary small" data-run="${q.id}">Run</button>
            <button class="btn small" data-edit="${q.id}">Open in SQL editor</button></div>
          <div class="out" id="out-${q.id}"></div>
          ${sqlDetails(q.sql, mysqlQuery(q.mysql), "Show the SQL")}
        </div>`).join("")}</div>`;
    const run = (id) => {
      const q = QUERIES.find((x) => x.id === id);
      try { const r = E.db.exec(q.sql)[0] || { columns: [], values: [] }; $("#out-" + id).innerHTML = table(r); }
      catch (e) { $("#out-" + id).innerHTML = errBox(e); }
    };
    $$("#view-queries [data-run]").forEach((b) => b.addEventListener("click", () => run(b.dataset.run)));
    $$("#view-queries [data-edit]").forEach((b) => b.addEventListener("click", () => { state.editorText = QUERIES.find((x) => x.id === b.dataset.edit).sql; show("editor"); }));
    $$("#q-filters button").forEach((b) => b.addEventListener("click", () => { state.filter = b.dataset.a; views.queries(); }));
    $("#run-all").addEventListener("click", () => list.forEach((q) => run(q.id)));
  };

  // ================================================================== SQL EDITOR
  const SNIPPETS = [
    ["Pick an example…", ""],
    ["Explore: policies with customer and agent", `SELECT ip.policy_id, pt.policy_type, ip.status, ip.end_date,
       CONCAT(cu.first_name, ' ', cu.last_name) AS customer,
       CONCAT(au.first_name, ' ', au.last_name) AS agent
FROM Insurance_Policies ip
JOIN Policy_Types pt      ON pt.policy_type_id = ip.policy_type_id
JOIN Customer_Policies cp ON cp.policy_id = ip.policy_id
JOIN Customers c          ON c.customer_id = cp.customer_id
JOIN Users cu             ON cu.user_id = c.user_id
JOIN Agents a             ON a.agent_id = ip.agent_id
JOIN Users au             ON au.user_id = a.user_id
ORDER BY ip.end_date DESC
LIMIT 25;`],
    ["Functions: top customers by premium paid", `SELECT c.customer_id,
       CONCAT(u.first_name, ' ', u.last_name) AS customer,
       GetTotalPremiumPaid(c.customer_id)   AS premium_paid,
       GetActivePolicyCount(c.customer_id)  AS active_policies,
       CalculateRiskFactor(c.customer_id)   AS risk
FROM Customers c JOIN Users u ON u.user_id = c.user_id
ORDER BY premium_paid DESC
LIMIT 10;`],
    ["Procedure: file a claim, then see the triggers' work", `CALL FileClaim(5, 725.00, CURDATE());

SELECT * FROM Claims ORDER BY claim_id DESC LIMIT 1;
SELECT policy_id, status FROM Insurance_Policies WHERE policy_id = 5;
SELECT * FROM Logs ORDER BY log_id DESC LIMIT 2;`],
    ["Procedure: onboard a customer", `CALL AddNewCustomerWithPolicy('Sam', 'Lee', 'sam.lee@example.com', 'hash',
     'NID-777000111', 2, 4, 5200.00, CURDATE(), '2030-01-01');

SELECT * FROM Users ORDER BY user_id DESC LIMIT 1;`],
    ["Trigger: delete a policy link (logged)", `DELETE FROM Customer_Policies WHERE policy_holder_id = 3;
SELECT * FROM Policy_Deletion_Log;`],
    ["Claims approval rate by policy type", `SELECT pt.policy_type,
       COUNT(*) AS claims,
       ROUND(100.0 * SUM(cs.claim_status = 'approved') / COUNT(*), 1) AS pct_approved,
       ROUND(AVG(cl.claim_amount), 2) AS avg_claim
FROM Claims cl
JOIN Claim_Statuses cs     ON cs.claim_status_id = cl.claim_status_id
JOIN Insurance_Policies ip ON ip.policy_id = cl.policy_id
JOIN Policy_Types pt       ON pt.policy_type_id = ip.policy_type_id
GROUP BY pt.policy_type
ORDER BY claims DESC;`],
    ["Loss ratio by branch (claims paid ÷ premiums)", `WITH prem AS (
  SELECT a.branch_id, SUM(p.amount_paid) AS premiums
  FROM Payments p
  JOIN Customer_Policies cp  ON cp.policy_holder_id = p.policy_holder_id
  JOIN Insurance_Policies ip ON ip.policy_id = cp.policy_id
  JOIN Agents a              ON a.agent_id = ip.agent_id
  GROUP BY a.branch_id),
paid AS (
  SELECT a.branch_id, SUM(cl.claim_amount) AS claims_paid
  FROM Claims cl
  JOIN Insurance_Policies ip ON ip.policy_id = cl.policy_id
  JOIN Agents a              ON a.agent_id = ip.agent_id
  WHERE cl.claim_status_id = 2
  GROUP BY a.branch_id)
SELECT b.location_name, ROUND(prem.premiums, 2) AS premiums,
       ROUND(IFNULL(paid.claims_paid, 0), 2) AS claims_paid,
       ROUND(100.0 * IFNULL(paid.claims_paid, 0) / prem.premiums, 1) AS loss_ratio_pct
FROM prem JOIN Branches b ON b.branch_id = prem.branch_id
LEFT JOIN paid ON paid.branch_id = prem.branch_id
ORDER BY loss_ratio_pct DESC;`],
  ];
  views.editor = function () {
    const tables = Q("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name");
    const text = state.editorText ?? SNIPPETS[2][1];
    $("#view-editor").innerHTML = `
      <div class="section-head"><div><h2>SQL editor</h2>
        <p>Query anything. The engine is SQLite, but the MySQL functions work as-is (<code>GetTotalPremiumPaid(…)</code>, etc.),
        and so do <code>CONCAT</code>, <code>CURDATE()</code>, <code>DATEDIFF</code>, <code>YEAR</code> and <code>MONTH</code>.
        Stored procedures run with <code>CALL Name(…)</code>.</p></div></div>
      <div class="editor-layout">
        <div class="panel tables-list"><h3>Tables</h3><p class="hint">Click a name to preview it.</p>
          ${tables.map((t) => {
            const cols = Q(`PRAGMA table_info("${t.name}")`);
            const n = S(`SELECT COUNT(*) FROM "${t.name}"`);
            return `<details><summary>${esc(t.name)} <span>${n}</span></summary>
              <button class="btn small insert" data-t="${esc(t.name)}">SELECT * …</button>
              <ul>${cols.map((c) => `<li>${esc(c.name)} <span style="opacity:.7">${esc(c.type.toLowerCase())}${c.pk ? " · pk" : ""}</span></li>`).join("")}</ul></details>`;
          }).join("")}
        </div>
        <div class="panel">
          <textarea class="sql" id="ed-text" spellcheck="false">${esc(text)}</textarea>
          <div class="editor-bar">
            <button class="btn primary" id="ed-run">Run</button><span class="kbd">Ctrl/⌘ + Enter</span>
            <span class="spacer"></span>
            <select id="ed-snip" style="width:auto">${SNIPPETS.map((s, i) => `<option value="${i}">${esc(s[0])}</option>`).join("")}</select>
          </div>
          <div id="ed-out"></div>
        </div>
      </div>`;
    const ta = $("#ed-text");
    const run = () => {
      state.editorText = ta.value;
      const t0 = performance.now();
      try {
        const res = E.run(ta.value);
        const ms = (performance.now() - t0).toFixed(1);
        $("#ed-out").innerHTML = `<p class="rowcount">${res.length} statement result${res.length === 1 ? "" : "s"} · ${ms} ms</p>` +
          (res.length ? res.map((r) => (r.label ? `<p class="hint" style="margin-top:12px"><b>${esc(r.label)}</b></p>` : "") + (r.columns.length ? table(r) : "")).join("") : `<div class="empty">Nothing to run.</div>`);
      } catch (e) { $("#ed-out").innerHTML = errBox(e); }
    };
    $("#ed-run").addEventListener("click", run);
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); }
      if (e.key === "Tab") { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText("  ", s, ta.selectionEnd, "end"); }
    });
    $("#ed-snip").addEventListener("change", (e) => { const s = SNIPPETS[e.target.value][1]; if (s) { ta.value = s; run(); } });
    $$(".tables-list .insert").forEach((b) => b.addEventListener("click", () => { ta.value = `SELECT * FROM ${b.dataset.t} LIMIT 50;`; run(); }));
    if (state.editorText) run();
  };

  // ================================================================== SCHEMA & CODE
  const ER = `erDiagram
  User_Roles ||--o{ Users : "role"
  Users ||--o| Customers : "is a"
  Users ||--o| Agents : "is a"
  Branches ||--o{ Agents : "employs"
  Agents ||--o{ Agent_Customers : ""
  Customers ||--o{ Agent_Customers : ""
  Policy_Types ||--o{ Insurance_Policies : "type"
  Agents ||--o{ Insurance_Policies : "sells"
  Customers ||--o{ Customer_Policies : ""
  Insurance_Policies ||--o{ Customer_Policies : ""
  Insurance_Policies ||--o{ Claims : "claimed on"
  Claim_Statuses ||--o{ Claims : "status"
  Claims ||--o{ Policy_Claims_Documents : "supported by"
  Customer_Policies ||--o{ Payments : "paid via"
  Payment_Methods ||--o{ Payments : "method"
  Customers ||--o{ Feedback : "gives"
  Customers ||--o{ Beneficiaries : "names"
  Insurance_Policies ||--o{ Beneficiaries : "covers"
  Users ||--o{ Logs : "acts"`;
  const OBJECTS = [
    ["AddNewCustomerWithPolicy", "Procedure", "Onboards a customer (user, customer, policy, links) in one transaction with rollback"],
    ["ExpireOldPolicies", "Procedure", "Marks overdue active policies as expired"],
    ["expire_policies_event", "Event", "Runs ExpireOldPolicies() every day"],
    ["log_new_claim", "Trigger", "AFTER INSERT on Claims → writes an entry to Logs"],
    ["GetTotalPremiumPaid", "Function", "Total premium a customer has paid"],
    ["FileClaim", "Procedure", "Files a claim with status 'pending'"],
    ["AddBeneficiary", "Procedure", "Adds a beneficiary to a customer's policy"],
    ["after_policy_expired", "Trigger", "Logs when a policy's status becomes 'expired'"],
    ["GetTotalClaims", "Function", "Number of claims on a policy"],
    ["AssignPolicyToCustomer", "Procedure", "Links an existing policy to a customer and agent"],
    ["GetMonthlyClaimSummary", "Procedure", "Claims count and value for an agent in a month"],
    ["trg_UpdatePolicyStatusOnClaim", "Trigger", "Flags an active policy 'under review' when a claim arrives"],
    ["trg_LogPolicyDeletion", "Trigger", "Records deleted customer-policy links"],
    ["CalculateRiskFactor", "Function", "Simple risk score: 0.1 per claim filed"],
    ["GetActivePolicyCount", "Function", "Active policies held by a customer"],
    ["UpdateCustomerAgentPolicies", "Procedure", "Transfers a customer and their policies to a new agent"],
    ["CalculateAverageRating", "Function", "Average feedback rating a customer has given"],
    ["before_users_update", "Trigger", "Audit: saves the old Users row (also for Customers, Agents, Branches)"],
    ["UserFeedbackView", "View", "Feedback joined to customer names, searchable by last name"],
    ["AssignUserRole", "Procedure", "Assigns a role to a user by role name"],
    ["AddPaymentMethod", "Procedure", "Adds a payment method only if it doesn't exist"],
    ["trg_LogRoleChange", "Trigger", "Logs every change to a user's role"],
    ["trg_LogClaimStatusInsert", "Trigger", "Logs new claim statuses"],
    ["GetClaimStatusLabel", "Function", "Readable status for a claim"],
    ["CountPoliciesByType", "Function", "Number of policies of a given type"],
  ];
  const FILES = ["01_schema.sql", "02_seed_data.sql", "03_programmability.sql", "04_complex_queries.sql", "05_demo.sql"];
  views.schema = function () {
    $("#view-schema").innerHTML = `
      <div class="section-head"><div><h2>Schema &amp; code</h2>
        <p>The entity-relationship diagram, every programmable object, and the full MySQL source.</p></div></div>
      <div class="panel"><h3>Entity-relationship diagram</h3><p class="hint">17 core tables. The 4 audit tables and Policy_Deletion_Log are filled by triggers.</p>
        <div class="mermaid" id="er"><a href="assets/er-diagram.svg" target="_blank" rel="noopener" title="Open full size"><img src="assets/er-diagram.svg" alt="Entity-relationship diagram of the insurance database" style="width:100%;height:auto;display:block"></a></div></div>
      <div class="panel" style="margin-top:16px"><h3>Procedures, functions, triggers, event &amp; view</h3>
        <div class="table-wrap" style="max-height:none"><table class="data objects-table"><thead><tr><th>Name</th><th>Type</th><th>What it does</th><th></th></tr></thead><tbody>
        ${OBJECTS.map(([n, t, d]) => `<tr><td>${n}</td><td>${t}</td><td style="white-space:normal">${esc(d)}</td><td><button class="btn small" data-obj="${n}">Code</button></td></tr>
          <tr hidden id="obj-${n}"><td colspan="4" style="white-space:normal">${pre(mysqlObject(n) || "")}</td></tr>`).join("")}
        </tbody></table></div></div>
      <div class="panel" style="margin-top:16px"><h3>MySQL source files</h3>
        <p class="hint">Run them in order in MySQL 8 (Workbench or <code>mysql &lt; file.sql</code>). Tested on MySQL 8.0 and MariaDB 10.11.</p>
        <div class="filters" id="file-tabs">${FILES.map((f, i) => `<button data-f="${f}" class="${i === 0 ? "active" : ""}">${f}</button>`).join("")}</div>
        <div id="file-view"></div></div>`;
    const showFile = async (f) => {
      $$("#file-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.f === f));
      const txt = await fetch("data/mysql/" + f).then((r) => r.text());
      const shown = txt.length > 60000 ? txt.slice(0, 60000) + "\n-- … (truncated, see GitHub for the full file)" : txt;
      $("#file-view").innerHTML = `<p><a href="${REPO}/blob/main/sql/${f}" target="_blank" rel="noopener">Open on GitHub</a> ·
        <a href="data/mysql/${f}" download>Download</a></p><pre class="code" style="max-height:600px">${f === "02_seed_data.sql" ? esc(shown) : hl(shown)}</pre>`;
    };
    $$("#file-tabs button").forEach((b) => b.addEventListener("click", () => showFile(b.dataset.f)));
    showFile(FILES[0]);
    $$("[data-obj]").forEach((b) => b.addEventListener("click", () => { const r = $("#obj-" + b.dataset.obj); r.hidden = !r.hidden; }));
  };

  // ------------------------------------------------------------------ start
  const start = (location.hash || "#overview").slice(1);
  show(views[start] ? start : "overview");
})();
