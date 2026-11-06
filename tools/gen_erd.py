"""Generate a clean, grouped ER diagram (SVG) from the live MySQL schema.

Usage:  python3 tools/gen_erd.py <mysql-socket> docs/assets/er-diagram.svg
Needs Graphviz (`dot`) and the mysql client. Reads information_schema, so
the diagram always matches sql/01_schema.sql.
"""
import subprocess
import sys

SOCK, OUT = sys.argv[1], sys.argv[2]
DB = "insurance_db"


def q(sql):
    r = subprocess.run(["mysql", f"--socket={SOCK}", "-uroot", "-N", "-B", "-e", sql],
                       capture_output=True, text=True, check=True)
    return [line.split("\t") for line in r.stdout.strip().splitlines() if line]


cols = q(f"""SELECT table_name, column_name, column_type, column_key, is_nullable
             FROM information_schema.columns WHERE table_schema='{DB}'
             ORDER BY table_name, ordinal_position""")
fks = q(f"""SELECT table_name, column_name, referenced_table_name, referenced_column_name
            FROM information_schema.key_column_usage
            WHERE table_schema='{DB}' AND referenced_table_name IS NOT NULL""")
uniq = {(t, c) for t, c in q(f"""SELECT s.table_name, s.column_name FROM information_schema.statistics s
            WHERE s.table_schema='{DB}' AND s.non_unique=0 AND s.index_name<>'PRIMARY'
            AND (SELECT COUNT(*) FROM information_schema.statistics x WHERE x.table_schema=s.table_schema
                 AND x.table_name=s.table_name AND x.index_name=s.index_name)=1""")}

GROUPS = [
    ("People & access", "#e8f1fb", "#2f6db5",
     ["User_Roles", "Users", "Customers", "Agents", "Branches", "Agent_Customers", "Feedback", "Logs"]),
    ("Policies", "#e6f5f3", "#0e7c86",
     ["Policy_Types", "Insurance_Policies", "Customer_Policies", "Beneficiaries"]),
    ("Billing", "#f1ecfb", "#6a46c2", ["Payment_Methods", "Payments"]),
    ("Claims", "#fdf0e4", "#b4610f", ["Claim_Statuses", "Claims", "Policy_Claims_Documents"]),
]
# The audit tables (users/customers/agents/branches_audit) and Policy_Deletion_Log have no
# foreign keys; they are filled by triggers and listed in the diagram caption instead.
color_of = {t: (fill, line) for _, fill, line, ts in GROUPS for t in ts}
fk_cols = {(t, c) for t, c, _, _ in fks}
by_table = {}
for t, c, typ, key, nul in cols:
    by_table.setdefault(t, []).append((c, typ, key, nul))


def short(typ):
    typ = typ.upper()
    if typ.startswith("ENUM"):
        return "ENUM"
    return typ.replace("VARCHAR", "VARCHAR").replace("DECIMAL(10,2)", "DECIMAL").replace("INT(11)", "INT")


def node(t):
    fill, line = color_of[t]
    audit = t.endswith("_audit") or t == "Policy_Deletion_Log"
    rows = [f'<TR><TD COLSPAN="3" BGCOLOR="{line}" ALIGN="LEFT"><FONT COLOR="white" POINT-SIZE="12"><B>{t}</B></FONT></TD></TR>']
    for c, typ, key, nul in by_table[t]:
        if key == "PRI":
            tag, tagc = "PK", "#b7791f"
        elif (t, c) in fk_cols:
            tag, tagc = "FK", line
        elif (t, c) in uniq:
            tag, tagc = "UQ", "#8a94a6"
        else:
            tag, tagc = "", "#8a94a6"
        name = f"<B>{c}</B>" if key == "PRI" else c
        first = (f'<TR><TD PORT="{c}_l" ALIGN="LEFT" WIDTH="22"><FONT POINT-SIZE="8" COLOR="{tagc}"><B>{tag}</B></FONT></TD>'
                 if tag else f'<TR><TD PORT="{c}_l" WIDTH="22"> </TD>')
        rows.append(
            first +
            f'<TD ALIGN="LEFT">{name}</TD>'
            f'<TD PORT="{c}_r" ALIGN="RIGHT"><FONT POINT-SIZE="9" COLOR="#8a94a6">{short(typ)}</FONT></TD></TR>')
    style = 'STYLE="ROUNDED"' if not audit else 'STYLE="ROUNDED,DASHED"'
    return (f'  "{t}" [label=<<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="0" CELLPADDING="4" '
            f'{style} COLOR="{line}" BGCOLOR="white">{"".join(rows)}</TABLE>>];')


out = ['digraph ERD {',
       '  graph [rankdir=LR, splines=spline, nodesep=0.3, ranksep=0.75, pad=0.3, bgcolor="white",'
       ' fontname="Helvetica", fontsize=13, newrank=true,'
       ' labelloc=b, labeljust=r, label=<<FONT POINT-SIZE="11" COLOR="#5b6678"><B>PK</B> primary key   <B>FK</B> foreign key   <B>UQ</B> unique      ||───o&lt;  one-to-many      ||───o|  one-to-one</FONT>>];',
       '  node  [shape=plain, fontname="Helvetica", fontsize=10];',
       '  edge  [color="#7b8698", penwidth=1.2, arrowsize=0.8, dir=both];']
for i, (label, fill, line, ts) in enumerate(GROUPS):
    out.append(f'  subgraph cluster_{i} {{ label=<<B>{label.replace("&", "&amp;")}</B>>; labeljust=l; labelloc=t; style="rounded,filled"; '
               f'fillcolor="{fill}"; color="{fill}"; fontcolor="{line}"; margin=14;')
    out += ["  " + node(t) for t in ts]
    out.append("  }")
# relationships: child (many) -> parent (one); crow's foot on the child side
for t, c, rt, rc in fks:
    if t not in color_of or rt not in color_of:
        continue
    one_to_one = (t, c) in uniq
    head = "teeodot" if one_to_one else "crowodot"   # child side: zero-or-one / zero-or-many
    out.append(f'  "{rt}":"{rc}_r" -> "{t}":"{c}_l" [arrowtail=teetee, arrowhead={head}];')
out.append("}")
dot_src = "\n".join(out)
subprocess.run(["dot", "-Tsvg", "-o", OUT], input=dot_src, text=True, check=True)
print("wrote", OUT, "with", len(fks), "relationships")
