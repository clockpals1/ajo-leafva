"""End-to-end backend tests for Ajo Platform API."""
import os
import time
import base64
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://payout-trust.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# small red-dot png for receipt upload
PNG_B64 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
RECEIPT = f"data:image/png;base64,{PNG_B64}"

TS = int(time.time())
MEMBER_EMAIL = f"TEST_member_{TS}@ajo.com".lower()
MEMBER_PW = "member123"

state = {}


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@ajo.com", "password": "admin123"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["user"]["role"] == "super_admin"
    return s


@pytest.fixture(scope="module")
def member():
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"name": "Test Member", "email": MEMBER_EMAIL, "password": MEMBER_PW})
    assert r.status_code == 200, r.text
    state["member_id"] = r.json()["user"]["id"]
    return s


# ---- Auth ----
class TestAuth:
    def test_me_unauth_401(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_register_returns_user_and_token(self, member):
        r = member.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == MEMBER_EMAIL
        assert r.json()["role"] == "member"

    def test_admin_login_super_admin(self, admin):
        r = admin.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["role"] == "super_admin"


# ---- Groups ----
class TestGroups:
    def test_member_cannot_create_group(self, member):
        payload = {"name": "BadGroup", "contribution_amount": 1000, "start_date": "2026-02-01",
                   "total_cycles": 6, "member_limit": 10}
        r = member.post(f"{API}/admin/groups", json=payload)
        assert r.status_code == 403

    def test_admin_creates_group_with_cycles(self, admin):
        payload = {"name": f"TEST_Group_{TS}", "description": "test", "contribution_amount": 5000,
                   "frequency": "monthly", "start_date": "2026-02-01",
                   "total_cycles": 6, "member_limit": 10}
        r = admin.post(f"{API}/admin/groups", json=payload)
        assert r.status_code == 200, r.text
        g = r.json()
        assert g["total_cycles"] == 6
        state["group_id"] = g["id"]
        # verify cycles generated
        d = admin.get(f"{API}/admin/groups/{g['id']}").json()
        assert len(d["cycles"]) == 6

    def test_member_cannot_add_member(self, member):
        r = member.post(f"{API}/admin/groups/{state['group_id']}/members",
                        json={"email": MEMBER_EMAIL})
        assert r.status_code == 403

    def test_admin_adds_member_generates_status(self, admin):
        r = admin.post(f"{API}/admin/groups/{state['group_id']}/members",
                       json={"email": MEMBER_EMAIL, "payout_position": 1})
        assert r.status_code == 200, r.text
        d = admin.get(f"{API}/admin/groups/{state['group_id']}").json()
        assert any(m["user_email"] == MEMBER_EMAIL for m in d["members"])

    def test_my_groups_returns_group(self, member):
        r = member.get(f"{API}/groups/my")
        assert r.status_code == 200
        arr = r.json()
        assert any(g["id"] == state["group_id"] for g in arr)

    def test_group_detail_member_access(self, member):
        r = member.get(f"{API}/groups/{state['group_id']}/detail")
        assert r.status_code == 200
        assert len(r.json()["cycles"]) == 6

    def test_group_detail_unrelated_member_403(self):
        s = requests.Session()
        email = f"TEST_other_{TS}@ajo.com"
        r = s.post(f"{API}/auth/register", json={"name": "Other", "email": email, "password": "x123456"})
        assert r.status_code == 200
        r = s.get(f"{API}/groups/{state['group_id']}/detail")
        assert r.status_code == 403


# ---- Payments ----
class TestPayments:
    def test_member_uploads_payment(self, member):
        r = member.post(f"{API}/payments/upload", json={
            "group_id": state["group_id"], "cycle_no": 1, "amount": 5000,
            "receipt_data_url": RECEIPT, "note": "test"
        })
        assert r.status_code == 200, r.text
        state["payment_id"] = r.json()["id"]
        assert r.json()["status"] == "submitted"

    def test_admin_sees_pending(self, admin):
        r = admin.get(f"{API}/admin/payments/pending")
        assert r.status_code == 200
        assert any(p["id"] == state["payment_id"] for p in r.json())

    def test_admin_approves_payment(self, admin):
        r = admin.post(f"{API}/admin/payments/{state['payment_id']}/decision",
                       json={"decision": "approve", "note": "ok"})
        assert r.status_code == 200
        assert r.json()["status"] == "approved"
        # verify cycle status Paid
        detail = admin.get(f"{API}/groups/{state['group_id']}/detail").json()
        paid = [s for s in detail["statuses"] if s["cycle_no"] == 1 and s["user_id"] == state["member_id"]]
        assert paid and paid[0]["status"] == "Paid"

    def test_reject_flow(self, admin, member):
        r = member.post(f"{API}/payments/upload", json={
            "group_id": state["group_id"], "cycle_no": 2, "amount": 5000,
            "receipt_data_url": RECEIPT, "note": "bad"
        })
        pid = r.json()["id"]
        r = admin.post(f"{API}/admin/payments/{pid}/decision", json={"decision": "reject", "note": "fake"})
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"


# ---- Payout ----
class TestPayout:
    def test_confirm_payout(self, admin):
        r = admin.post(f"{API}/admin/payouts/{state['group_id']}/1/confirm")
        assert r.status_code == 200, r.text
        detail = admin.get(f"{API}/groups/{state['group_id']}/detail").json()
        rec = [s for s in detail["statuses"] if s["cycle_no"] == 1 and s["user_id"] == state["member_id"]]
        assert rec and rec[0]["status"] == "Payout_Completed"


# ---- Dashboard, Audit, Notifs ----
class TestAdminMisc:
    def test_dashboard_stats(self, admin):
        r = admin.get(f"{API}/admin/dashboard-stats")
        assert r.status_code == 200
        data = r.json()
        for k in ["active_groups", "total_members", "pending_payments", "upcoming_payouts", "total_collections"]:
            assert k in data

    def test_audit_logs_have_actor(self, admin):
        r = admin.get(f"{API}/admin/audit-logs")
        assert r.status_code == 200
        logs = r.json()
        assert len(logs) > 0
        assert "actor_name" in logs[0] and "action" in logs[0]

    def test_notifications(self, member):
        r = member.get(f"{API}/notifications/my")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---- Visibility ----
class TestVisibility:
    def test_profile_visibility_change_creates_request(self, member):
        r = member.put(f"{API}/me/profile", json={"visibility_preference": "hidden"})
        assert r.status_code == 200
        assert r.json()["visibility_status"] == "pending"

    def test_admin_lists_and_approves(self, admin):
        r = admin.get(f"{API}/admin/visibility-requests")
        assert r.status_code == 200
        reqs = r.json()
        assert len(reqs) > 0
        rid = reqs[0]["id"]
        r = admin.post(f"{API}/admin/visibility-requests/{rid}/decision",
                       json={"decision": "approve"})
        assert r.status_code == 200

    def test_profile_non_visibility_direct_update(self, member):
        r = member.put(f"{API}/me/profile", json={"phone": "+1234567890"})
        assert r.status_code == 200
        assert r.json()["phone"] == "+1234567890"
