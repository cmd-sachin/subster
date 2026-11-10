"""End-to-end smoke test against a running server (npm run dev).

The app ships with no data, so the test builds its own input: a statement in the layout an
Indian bank exports, generated relative to today. It ERASES the app's stored data first and
again at the end, so do not run it against data you want to keep. Agent runs are forced onto
the rules engine so the checks are deterministic and use no model quota.
"""

import datetime as dt
import json
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
FAILS = []
TODAY = dt.date.today()


def call(path, body=None, method="POST"):
    data = None if method == "GET" else json.dumps(body or {}).encode()
    req = urllib.request.Request(BASE + path, data=data, headers={"content-type": "application/json"}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            raw = res.read().decode()
            try:
                return res.status, json.loads(raw)
            except json.JSONDecodeError:
                return res.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw


def check(name, cond, detail=""):
    print("PASS" if cond else "FAIL", name, detail if not cond or detail else "")
    if not cond:
        FAILS.append(name)


def sub(state, sid):
    return next((i for i in state["portfolio"]["insights"] if i["sub"]["id"] == sid), None)


def months_back(day_offset, months):
    """One date per month, most recent first, each `day_offset` days before today's day-of-month."""
    out = []
    for m in range(months):
        year, month = TODAY.year, TODAY.month - m
        while month <= 0:
            month += 12
            year -= 1
        anchor = dt.date(year, month, min(TODAY.day, 28)) - dt.timedelta(days=day_offset)
        out.append(anchor)
    return out


def statement():
    rows = []
    for d in months_back(4, 6):
        rows.append((d, "UPI-NETFLIX COM-NETFLIXUPI@ICICI-000123-AUTOPAY", "649.00", ""))
    for d in months_back(9, 6):
        rows.append((d, "POS 4375XXXXXXXX1203 SPOTIFY INDIA", "119.00", ""))
    for d in months_back(14, 6):
        rows.append((d, "ACH D- AIRTEL XSTREAM FIBER BROADBAND-9981", "999.00", ""))
    for d in months_back(18, 4):
        rows.append((d, "UPI-SONYLIV-SONYLIV@HDFCBANK-SUBSCRIPTION", "299.00", ""))
    for d in months_back(11, 5):
        rows.append((d, "NEFT-IRON TEMPLE GYM-MEMBERSHIP", "1,800.00", ""))
    for n in range(6):
        rows.append((TODAY - dt.timedelta(days=n * 28 + 6), "UPI-JIO PREPAID RECHARGE-JIO@PAYTM", "299.00", ""))
    for d in months_back(1, 6):
        rows.append((d, "NEFT CR-ACME TECHNOLOGIES-SALARY", "", "85,000.00"))
    for n in range(8):
        rows.append((TODAY - dt.timedelta(days=n * 9 + 2), "UPI-BIGBASKET-GROCERIES", f"{1200 + n * 137}.00", ""))
    rows.sort(key=lambda r: r[0])
    lines = ["HDFC BANK Ltd.", "Account No: XXXXXX4821", "", "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance"]
    for d, narration, debit, credit in rows:
        day = d.strftime("%d/%m/%y")
        lines.append(f'{day},{narration},0000{d.day:02d}123,{day},"{debit}","{credit}","1,00,000.00"')
    lines.append("*** End of Statement ***")
    return "\n".join(lines)


# 1. A fresh install holds no data.
call("/api/reset")
_, state = call("/api/state", method="GET")
check("starts empty: no subscriptions, payments or usage", not state["portfolio"]["insights"] and not state["charges"] and not state["usage"])
check("no simulated integrations", state["integrations"]["bank"]["link"] is None and state["integrations"]["paypal"] in ("off", "sandbox", "live"))
paypal_on = state["integrations"]["paypal"] != "off"

# 2. Statement import discovers subscriptions and sets the currency.
csv = statement()
status, res = call("/api/import", {"csv": csv, "filename": "hdfc.csv"})
check("statement accepted", status == 200, str(res)[:200])
r = res["result"]
check("discovers the catalog subscriptions", sorted(r["discovered"]) == ["Airtel Xstream Fiber", "Jio Prepaid", "Netflix", "SonyLIV", "Spotify"], str(r["discovered"]))
check("unknown recurring merchant is held for confirmation", r["candidates"] == ["Iron Temple"], str(r["candidates"]))
state = res["state"]
check("rupees inferred from an HDFC layout that names no currency", state["settings"]["currency"] == "INR" and r["currency"] == "INR")
check("salary credits and groceries are not subscriptions", len(state["portfolio"]["insights"]) == 5)
check("prices come from the statement", sub(state, "netflix")["sub"]["price"] == 649 and sub(state, "spotify")["sub"]["price"] == 119)
status, again = call("/api/import", {"csv": csv, "filename": "hdfc.csv"})
check("re-importing the same file changes nothing", again["result"]["newTransactions"] == 0)

# 3. Classification: catalog, rules, user override.
check("catalog categories", sub(state, "netflix")["sub"]["category"] == "Streaming" and sub(state, "jio-prepaid")["sub"]["category"] == "Telecom" and sub(state, "netflix")["sub"]["classifiedBy"] == "catalog")
check("essentials are not judged on screen time", sub(state, "airtel-xstream-fiber")["verdict"] == "essential")
cand = state["integrations"]["bank"]["candidates"][0]
check("candidate classified by keyword rules", cand["category"] == "Wellness", cand["category"])
_, state = call("/api/bank/candidates", {"key": cand["key"], "decision": "track"})
gym = sub(state, "iron-temple")
check("confirmed candidate is tracked with its category", gym is not None and gym["sub"]["category"] == "Wellness" and gym["sub"]["classifiedBy"] == "rules")
_, state = call("/api/subscriptions/iron-temple", {"category": "Other"}, method="PATCH")
check("user can reclassify", sub(state, "iron-temple")["sub"]["category"] == "Other" and sub(state, "iron-temple")["sub"]["classifiedBy"] == "user")

# 4. Usage from the Android companion turns "not measured" into a verdict.
check("no usage yet means not measured", sub(state, "netflix")["verdict"] == "unmeasured")
_, pk = call("/api/usage", method="GET")
check("companion is told which apps to measure", {"com.netflix.mediaclient", "com.spotify.music"} <= {p["package"] for p in pk["packages"]})
days = []
for n in range(30):
    day = (TODAY - dt.timedelta(days=n)).isoformat()
    days.append({"package": "com.spotify.music", "date": day, "minutes": 75})
    days.append({"package": "com.netflix.mediaclient", "date": day, "minutes": 0})
    days.append({"package": "com.random.game", "date": day, "minutes": 40})
_, res = call("/api/usage", {"days": days, "source": "android"})
check("usage accepted for tracked apps only", res["accepted"] == 60 and res["ignored"] == 30, f"{res['accepted']} {res['ignored']}")
state = res["state"]
check("spotify scores as good value, netflix as unused", sub(state, "spotify")["verdict"] == "great" and sub(state, "netflix")["verdict"] == "unused", f"{sub(state, 'spotify')['verdict']} {sub(state, 'netflix')['verdict']}")

# 5. The agent proposes; nothing changes before approval.
status, raw = call("/api/agent", {"mode": "sweep", "engine": "rules"})
events = [json.loads(line) for line in raw.strip().split("\n")]
check("audit streams steps and finishes", events[-1]["type"] == "done" and any(e["type"] == "step" for e in events))
_, state = call("/api/state", method="GET")
pending = {a["subId"]: a for a in state["actions"] if a["status"] == "pending"}
check("agent proposes cancelling the unused subscription", "netflix" in pending and pending["netflix"]["type"] == "cancel", str(list(pending)))
check("amounts in agent text use the user's currency", "₹" in pending["netflix"]["reason"], pending["netflix"]["reason"])
check("nothing executed before approval", sub(state, "netflix")["sub"]["status"] == "active")
call("/api/agent", {"mode": "sweep", "engine": "rules"})
_, state = call("/api/state", method="GET")
check("audit is idempotent", len([a for a in state["actions"] if a["status"] == "pending"]) == len(pending))

# 6. Approval. A bank-billed subscription is guided to the provider, never faked.
_, state = call(f"/api/actions/{pending['netflix']['id']}", {"decision": "approve"})
act = next(a for a in state["actions"] if a["id"] == pending["netflix"]["id"])
check("bank-billed cancel is handed to the user", act["status"] == "guided" and sub(state, "netflix")["sub"]["status"] == "active")
_, state = call(f"/api/actions/{act['id']}", {"decision": "done"})
check("confirming marks it cancelled", sub(state, "netflix")["sub"]["status"] == "cancelled")

# 7. Locked subscriptions are off limits to the agent.
_, state = call("/api/subscriptions/sonyliv", {"policy": "locked"}, method="PATCH")
for a in [a for a in state["actions"] if a["subId"] == "sonyliv" and a["status"] == "pending"]:
    call(f"/api/actions/{a['id']}", {"decision": "reject"})
call("/api/agent", {"mode": "sweep", "engine": "rules"})
_, state = call("/api/state", method="GET")
check("locked subscription gets no proposal", not any(a["subId"] == "sonyliv" and a["status"] == "pending" for a in state["actions"]))

# 8. Subscribing from chat goes through the inbox.
status, raw = call("/api/agent", {"mode": "chat", "engine": "rules", "message": "subscribe to YouTube Premium"})
check("chat asks which plan when there are several", "Individual" in raw and "Family" in raw)
status, raw = call("/api/agent", {"mode": "chat", "engine": "rules", "message": "subscribe to YouTube Premium Family"})
_, state = call("/api/state", method="GET")
prop = next((a for a in state["actions"] if a["type"] == "subscribe"), None)
check("chat creates a subscribe proposal", prop is not None and prop["status"] == "pending" and prop["plan"]["name"] == "Family", str(prop)[:200])
check("no subscription exists before approval", sub(state, "youtube-premium") is None)
_, state = call(f"/api/actions/{prop['id']}", {"decision": "approve"})
prop = next(a for a in state["actions"] if a["id"] == prop["id"])
if paypal_on:
    check("approval creates a PayPal agreement awaiting the buyer", prop["status"] == "guided" and str(prop.get("approveUrl", "")).startswith("https://"), prop["status"])
else:
    check("without PayPal the subscribe fails loudly and charges nothing", prop["status"] == "failed" and sub(state, "youtube-premium") is None, prop["status"])
status, raw = call("/api/agent", {"mode": "chat", "engine": "rules", "message": "pause spotify"})
_, state = call("/api/state", method="GET")
check("chat can propose a pause", any(a["subId"] == "spotify" and a["type"] == "pause" and a["status"] == "pending" for a in state["actions"]))

# 9. Services directory: add something you already pay for.
status, state = call("/api/services", {"intent": "track", "providerId": "chatgpt-plus", "plan": "Plus", "price": 1999, "cycle": "monthly", "lastChargedOn": TODAY.isoformat()})
check("manual add from the directory", status == 200 and sub(state, "chatgpt-plus")["sub"]["source"] == "manual" and sub(state, "chatgpt-plus")["sub"]["category"] == "AI")
status, _ = call("/api/services", {"intent": "track", "providerId": "chatgpt-plus", "plan": "Plus", "price": 1999})
check("cannot add the same service twice", status == 409, str(status))

# 10. Account linking never takes a password.
_, state = call("/api/accounts/link", {"providerId": "netflix", "action": "confirm"})
check("self-reported sign-in is recorded without credentials", state["accounts"] == [{"providerId": "netflix", "method": "self", "connectedAt": state["accounts"][0]["connectedAt"]}], str(state["accounts"]))

# 11. Webhooks must verify; bank routes refuse without a link.
status, _ = call("/api/paypal/webhook", {"event_type": "BILLING.SUBSCRIPTION.CANCELLED", "resource": {"id": "I-FAKE"}})
check("unsigned PayPal webhook rejected", status == 401, str(status))
status, res = call("/api/bank/sync")
check("bank sync refuses when nothing is linked", status == 400, str(status))

# 12. Logs.
_, logs = call("/api/logs?level=debug&limit=1000", method="GET")
scopes = {e["scope"] for e in logs["entries"]}
check("application logs cover the main scopes", {"http", "agent", "discovery", "actions", "statement", "subscriptions", "classification"} <= scopes, str(sorted(scopes)))
check("log entries are structured and tied to requests", all("at" in e and "level" in e and "message" in e for e in logs["entries"]) and any(e.get("requestId") for e in logs["entries"]))
_, warn = call("/api/logs?level=warn", method="GET")
check("level filter works", warn["entries"] and all(e["level"] in ("warn", "error") for e in warn["entries"]))
check("no secrets in logs", "access_token" not in json.dumps(logs) and "client_secret" not in json.dumps(logs).lower())

call("/api/reset")
print("\nFAILED: " + ", ".join(FAILS) if FAILS else "\nALL PASSED")
sys.exit(1 if FAILS else 0)
