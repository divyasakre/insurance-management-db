"""Generate realistic, internally consistent seed data for the insurance DB.

Output is plain INSERT statements that run on both MySQL 8 and SQLite.
All dates are relative to ANCHOR so the playground can shift them to "today".
"""
import hashlib
import random
import sys
from datetime import date, timedelta

random.seed(6320)
ANCHOR = date(2026, 11, 6)
out = []


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return f"{v:.2f}" if isinstance(v, float) else str(v)
    return "'" + str(v).replace("'", "''") + "'"


def insert(table, cols, rows, comment):
    out.append(f"\n-- {comment}")
    out.append(f"INSERT INTO {table} ({', '.join(cols)}) VALUES")
    out.append(",\n".join("(" + ", ".join(q(v) for v in r) + ")" for r in rows) + ";")


def d(x):
    return x.isoformat()


def add_months(dt, m):
    y, mo = dt.year + (dt.month - 1 + m) // 12, (dt.month - 1 + m) % 12 + 1
    return date(y, mo, min(dt.day, 28))


# ---------------- lookups (ids are deterministic: 1..n) ----------------
policy_types = ["medical", "vehicle", "home", "life", "travel"]
claim_statuses = ["pending", "approved", "rejected"]
pay_methods = ["credit_card", "debit_card", "bank_transfer", "cash"]
roles = ["customer", "agent", "admin"]
insert("Policy_Types", ["policy_type"], [[p] for p in policy_types], "Policy types")
insert("Claim_Statuses", ["claim_status"], [[c] for c in claim_statuses], "Claim statuses")
insert("Payment_Methods", ["payment_method"], [[p] for p in pay_methods], "Payment methods")
insert("User_Roles", ["role_name"], [[r] for r in roles], "User roles (1=customer, 2=agent, 3=admin)")

branches = [("New York", "2125550101"), ("Los Angeles", "2135550102"), ("Chicago", "3125550103"),
            ("Houston", "7135550104"), ("Phoenix", "6025550105"), ("San Francisco", "4155550106"),
            ("Dallas", "2145550107"), ("Miami", "3055550108"), ("Boston", "6175550109"),
            ("Austin", "5125550110")]
insert("Branches", ["location_name", "contact_number"], branches, "Branch offices")

# ---------------- users ----------------
first = ["James", "Maria", "Robert", "Priya", "Michael", "Aisha", "David", "Sofia", "Daniel", "Mei",
         "Carlos", "Emma", "Ahmed", "Olivia", "Kevin", "Fatima", "Brian", "Grace", "Luis", "Hannah",
         "Raj", "Chloe", "Ethan", "Nina", "Omar", "Zoe", "Victor", "Leah", "Samuel", "Isabel",
         "Tyler", "Ananya", "Marcus", "Elena", "Jordan", "Yuki", "Andre", "Ruth", "Diego", "Amara",
         "Patrick", "Lena", "Hassan", "Julia", "Noah", "Kiara", "Ian", "Rosa", "Felix", "Tara",
         "Aaron", "Mira", "Caleb", "Selena", "Owen", "Ravi", "Lucas", "Ivy", "Mateo", "Sara",
         "Gavin", "Rina", "Theo", "Alma", "Henry", "Nadia", "Jack", "Esther", "Leo", "Maya",
         "Ryan", "Asha", "Paul", "Bianca", "Sean", "Lily", "Adam"]
last = ["Carter", "Nguyen", "Patel", "Garcia", "Kim", "Johnson", "Lopez", "Chen", "Brooks", "Rivera",
        "Shah", "Martinez", "Wright", "Hughes", "Okafor", "Reyes", "Turner", "Singh", "Foster", "Morales",
        "Bennett", "Ali", "Price", "Ramirez", "Coleman", "Tanaka", "Hayes", "Ortiz", "Sullivan", "Iyer",
        "Bryant", "Flores", "Webb", "Mendoza", "Russell", "Khan", "Perry", "Castillo", "Ward", "Das"]
random.shuffle(first)

N_ADMIN, N_AGENT, N_CUST = 3, 15, 60
users = []  # (first, last, email, hash, role_id)
used = set()
for i in range(N_ADMIN + N_AGENT + N_CUST):
    while True:
        fn, ln = first[i % len(first)], random.choice(last)
        if (fn, ln) not in used:
            used.add((fn, ln))
            break
    role = 3 if i < N_ADMIN else 2 if i < N_ADMIN + N_AGENT else 1
    email = f"{fn.lower()}.{ln.lower()}@example.com"
    pw_hash = hashlib.sha256(f"demo-{i}".encode()).hexdigest()  # demo hashes, not real passwords
    users.append((fn, ln, email, pw_hash, role))
insert("Users", ["first_name", "last_name", "email", "password_hash", "role_id"], users,
       "Users: 1-3 admins, 4-18 agents, 19-78 customers (passwords are SHA-256 demo hashes)")

agent_user_ids = list(range(N_ADMIN + 1, N_ADMIN + N_AGENT + 1))
agents = [(uid, f"TX-AGT-{1000 + k * 37}", (k % 10) + 1) for k, uid in enumerate(agent_user_ids)]
insert("Agents", ["user_id", "license_number", "branch_id"], agents, "Agents (15, spread over 10 branches)")

cust_user_ids = list(range(N_ADMIN + N_AGENT + 1, N_ADMIN + N_AGENT + N_CUST + 1))
customers = [(uid, f"NID-{random.randint(10**8, 10**9 - 1)}") for uid in cust_user_ids]
insert("Customers", ["user_id", "national_id"], customers, "Customers (60)")

# ---------------- policies ----------------
amount_range = {"medical": (1800, 7200), "vehicle": (900, 3200), "home": (1200, 4800),
                "life": (2500, 12000), "travel": (80, 650)}
policies = []      # (type_id, agent_id, amount, start, end, status)
holders = []       # (customer_id, policy_idx)
TRANSFERRED_AGENT = 15  # sold policies, but all their customers were reassigned
cust_agent = {c: random.randint(1, 14) for c in range(1, N_CUST + 1)}

for c in range(1, N_CUST + 1):
    n = random.choices([1, 2, 3, 4], [30, 40, 22, 8])[0]
    types = random.sample(range(1, 6), min(n, 5))
    if c % 9 == 0:                       # some customers hold duplicate coverage
        types.append(types[0])
    for t in types:
        tname = policy_types[t - 1]
        start = ANCHOR - timedelta(days=random.randint(20, 900))
        end = add_months(start, random.choice([1, 2, 3]) if tname == "travel" else 12)
        agent = cust_agent[c] if random.random() < 0.8 else random.randint(1, 14)
        policies.append([t, agent, round(random.uniform(*amount_range[tname]), 2), start, end, None])
        holders.append((c, len(policies)))

# guarantee renewals coming due in the next 30 days
for k, idx in enumerate(random.sample(range(len(policies)), 10)):
    p = policies[idx]
    p[4] = ANCHOR + timedelta(days=3 + k * 3)
    p[3] = add_months(p[4], -12)
# the transferred agent's book
for idx in random.sample(range(len(policies)), 5):
    policies[idx][1] = TRANSFERRED_AGENT

for p in policies:
    p[5] = "active" if p[4] >= ANCHOR else "expired"
for idx in random.sample(range(len(policies)), 6):
    policies[idx][5] = "cancelled"

# ---------------- claims (before policy status is finalised) ----------------
claims = []  # (policy_idx, status_id, amount, date)
claim_ratio = {"medical": 0.45, "vehicle": 0.4, "home": 0.25, "life": 0.05, "travel": 0.2}
for i, p in enumerate(policies, start=1):
    tname = policy_types[p[0] - 1]
    if random.random() < claim_ratio[tname]:
        for _ in range(random.choices([1, 2, 3], [70, 22, 8])[0]):
            last_day = min(p[4], ANCHOR)
            span = (last_day - p[3]).days
            if span < 5:
                continue
            cdate = p[3] + timedelta(days=random.randint(3, span))
            status = 1 if (ANCHOR - cdate).days < 45 else random.choices([2, 3], [72, 28])[0]
            claims.append((i, status, round(p[2] * random.uniform(0.08, 0.9), 2), cdate))
claims.sort(key=lambda x: x[3])
# The claim trigger flags policies with a new claim as 'under review'
for pi, st, _, _ in claims:
    if st == 1 and policies[pi - 1][5] == "active":
        policies[pi - 1][5] = "under review"

insert("Insurance_Policies", ["policy_type_id", "agent_id", "policy_amount", "start_date", "end_date", "status"],
       [(p[0], p[1], p[2], d(p[3]), d(p[4]), p[5]) for p in policies], f"Insurance policies ({len(policies)})")


def holder_status(p):
    return {"under review": "active"}.get(p[5], p[5])


insert("Customer_Policies", ["customer_id", "policy_id", "start_date", "end_date", "status"],
       [(c, pi, d(policies[pi - 1][3]), d(policies[pi - 1][4]), holder_status(policies[pi - 1]))
        for c, pi in holders], "Customer <-> policy links (policy_holder_id = row number)")

ac = sorted({(policies[pi - 1][1], c) for c, pi in holders if policies[pi - 1][1] != TRANSFERRED_AGENT}
            | {(cust_agent[c], c) for c in range(1, N_CUST + 1)})
insert("Agent_Customers", ["agent_id", "customer_id"], ac, "Agent <-> customer assignments")

insert("Claims", ["policy_id", "claim_status_id", "claim_amount", "claim_date"],
       [(pi, st, amt, d(cd)) for pi, st, amt, cd in claims], f"Claims ({len(claims)})")

# ---------------- payments ----------------
lapsed = set(random.sample(range(1, N_CUST + 1), 7))      # stopped paying > 6 months ago
never_paid = set(random.sample(sorted(set(range(1, N_CUST + 1)) - lapsed), 2))
payments, txn = [], 700000
for h, (c, pi) in enumerate(holders, start=1):
    p = policies[pi - 1]
    if c in never_paid:
        continue
    tname = policy_types[p[0] - 1]
    if tname == "travel":
        schedule, per = [p[3]], p[2]
    else:
        schedule = [add_months(p[3], m) for m in range(0, 12, 3)]
        per = round(p[2] / 4, 2)
    stop = ANCHOR - timedelta(days=200) if c in lapsed else ANCHOR
    if p[5] == "cancelled":
        stop = min(stop, p[3] + timedelta(days=100))
    method = random.choices(range(1, 5), [45, 25, 25, 5])[0]
    for when in schedule:
        if when <= stop:
            txn += random.randint(1, 9)
            payments.append((h, per, d(when), method, f"TXN{txn}"))
payments.sort(key=lambda r: r[2])
insert("Payments", ["policy_holder_id", "amount_paid", "payment_date", "payment_method_id", "transaction_id"],
       payments, f"Premium payments ({len(payments)})")

# ---------------- feedback ----------------
comments = {5: ["Claim was paid in under a week. Excellent.", "My agent explained every option clearly.",
                "Renewal took two minutes.", "Best insurance experience I've had."],
            4: ["Good service, app could be faster.", "Helpful agent, fair premium.",
                "Smooth onboarding process."],
            3: ["Average. Took a few calls to resolve.", "Fine overall, nothing special."],
            2: ["Claim review took too long.", "Hard to reach my agent."],
            1: ["Claim was rejected without a clear reason.", "Billing error was never fixed."]}
fb = []
for c in random.sample(range(1, N_CUST + 1), 42):
    r = random.choices([5, 4, 3, 2, 1], [32, 30, 18, 12, 8])[0]
    ts = ANCHOR - timedelta(days=random.randint(1, 400))
    fb.append((c, random.choice(comments[r]), r, f"{d(ts)} {random.randint(8, 19):02d}:{random.randint(0, 59):02d}:00"))
fb.sort(key=lambda r: r[3])
insert("Feedback", ["customer_id", "comments", "rating", "submitted_at"], fb, "Customer feedback")

# ---------------- beneficiaries ----------------
rels = ["spouse", "child", "parent", "sibling", "other"]
ben = []
for c, pi in holders:
    if policy_types[policies[pi - 1][0] - 1] in ("life", "medical") and random.random() < 0.7:
        rel = random.choices(rels, [45, 30, 12, 8, 5])[0]
        ln = users[cust_user_ids[c - 1] - 1][1]
        ben.append((c, pi, f"{random.choice(first)} {ln}", rel))
insert("Beneficiaries", ["customer_id", "policy_id", "full_name", "relationship"], ben, "Beneficiaries")

# ---------------- claim documents ----------------
doc_for = {"medical": "medical_report", "vehicle": "repair_estimate", "home": "repair_estimate",
           "life": "other", "travel": "invoice"}
docs = []
for cid, (pi, _, _, cd) in enumerate(claims, start=1):
    t = policy_types[policies[pi - 1][0] - 1]
    docs.append((cid, doc_for[t], f"https://docs.example.com/claims/{cid}/{doc_for[t]}.pdf", f"{d(cd)} 10:00:00"))
    if random.random() < 0.3:
        docs.append((cid, random.choice(["invoice", "police_report"]),
                     f"https://docs.example.com/claims/{cid}/supporting.pdf", f"{d(cd)} 11:30:00"))
insert("Policy_Claims_Documents", ["claim_id", "document_type", "document_url", "uploaded_at"], docs,
       "Supporting claim documents")

# ---------------- logs ----------------
acts = ["Logged in", "Viewed policy", "Made payment", "Updated profile", "Downloaded claim report",
        "Registered new customer", "Updated policy", "Viewed claim"]
logs = []
for _ in range(40):
    uid = random.randint(1, len(users))
    ts = ANCHOR - timedelta(days=random.randint(0, 60))
    logs.append((uid, random.choice(acts), f"{d(ts)} {random.randint(7, 21):02d}:{random.randint(0, 59):02d}:00"))
logs.sort(key=lambda r: r[2])
insert("Logs", ["user_id", "action", "timestamp"], logs, "Activity log history")

header = f"""-- =====================================================================
-- Insurance Management Database System  |  02 - SEED DATA
-- Generated sample data (fictional people; example.com emails).
-- Dates are anchored to {ANCHOR.isoformat()}. The web playground shifts
-- them to "today" so date-based queries always return results.
-- =====================================================================
USE insurance_db;
"""
target = sys.argv[1]
with open(target, "w") as f:
    f.write(header + "\n".join(out) + "\n")
print(f"policies={len(policies)} holders={len(holders)} claims={len(claims)} payments={len(payments)} "
      f"feedback={len(fb)} beneficiaries={len(ben)} docs={len(docs)}")
