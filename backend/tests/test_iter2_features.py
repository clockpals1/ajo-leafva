"""Iteration-2 backend tests: Settings, Invitations, Comments, Group rules/comments toggle."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

TS = int(time.time())
state = {}


# ---------------- Fixtures ----------------
@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@ajo.com", "password": "admin123"})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def member():
    s = requests.Session()
    email = f"TEST_iter2_member_{TS}@ajo.com".lower()
    r = s.post(f"{API}/auth/register", json={"name": "Iter2 Member", "email": email, "password": "member123"})
    assert r.status_code == 200, r.text
    state["member_email"] = email
    state["member_id"] = r.json()["user"]["id"]
    return s


@pytest.fixture(scope="module")
def outsider():
    s = requests.Session()
    email = f"TEST_iter2_out_{TS}@ajo.com".lower()
    r = s.post(f"{API}/auth/register", json={"name": "Outsider", "email": email, "password": "outpass1"})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def group_with_rules(admin):
    payload = {
        "name": f"TEST_RulesGroup_{TS}",
        "description": "iter2 group",
        "contribution_amount": 5000,
        "frequency": "monthly",
        "start_date": "2026-03-01",
        "total_cycles": 6,
        "member_limit": 10,
        "rules_text": "Rule 1: Be on time.\nRule 2: No swearing.",
        "enable_comments": True,
    }
    r = admin.post(f"{API}/admin/groups", json=payload)
    assert r.status_code == 200, r.text
    g = r.json()
    state["group_id"] = g["id"]
    assert g["rules_text"].startswith("Rule 1")
    assert g["enable_comments"] is True
    return g


# ---------------- Settings ----------------
class TestSettings:
    def test_get_settings_admin(self, admin):
        r = admin.get(f"{API}/admin/settings")
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ["brand_name", "resend_sender", "twilio_whatsapp_from",
                  "has_resend", "has_twilio",
                  "resend_api_key_masked", "twilio_account_sid_masked", "twilio_auth_token_masked"]:
            assert k in data
        assert isinstance(data["has_resend"], bool)
        assert isinstance(data["has_twilio"], bool)

    def test_member_cannot_get_settings(self, member):
        r = member.get(f"{API}/admin/settings")
        assert r.status_code == 403

    def test_member_cannot_put_settings(self, member):
        r = member.put(f"{API}/admin/settings", json={"brand_name": "Hacker"})
        assert r.status_code == 403

    def test_admin_updates_settings_persists(self, admin):
        new_brand = f"TEST_Brand_{TS}"
        r = admin.put(f"{API}/admin/settings", json={
            "brand_name": new_brand,
            "resend_sender": "noreply@isunday.me",
            "twilio_account_sid": "ACtest1234567890abcdef",
            "twilio_auth_token": "tok_test_abcdef1234567890",
            "twilio_whatsapp_from": "whatsapp:+14155238886",
        })
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True
        # GET back to verify persistence
        r2 = admin.get(f"{API}/admin/settings")
        d = r2.json()
        assert d["brand_name"] == new_brand
        assert d["resend_sender"] == "noreply@isunday.me"
        assert d["twilio_whatsapp_from"] == "whatsapp:+14155238886"
        assert d["has_twilio"] is True
        # Secrets must be masked
        assert "***" in d["twilio_account_sid_masked"]
        assert "***" in d["twilio_auth_token_masked"]

    def test_admin_partial_update_does_not_clear_other_fields(self, admin):
        r = admin.put(f"{API}/admin/settings", json={"brand_name": f"TEST_Brand_{TS}_v2"})
        assert r.status_code == 200
        d = admin.get(f"{API}/admin/settings").json()
        assert d["brand_name"] == f"TEST_Brand_{TS}_v2"
        # Twilio still configured
        assert d["has_twilio"] is True


# ---------------- Group create with rules + comments toggle ----------------
class TestGroupExtras:
    def test_create_group_persists_rules_and_comments_flag(self, group_with_rules, admin):
        # GET group detail to verify (admin endpoint returns {group, members, cycles})
        r = admin.get(f"{API}/admin/groups/{state['group_id']}")
        assert r.status_code == 200
        d = r.json()
        g = d["group"]
        assert g["rules_text"].startswith("Rule 1")
        assert g["enable_comments"] is True
        assert len(d["cycles"]) == 6


# ---------------- Invitations ----------------
class TestInvitations:
    def test_member_cannot_create_invite(self, member):
        r = member.post(f"{API}/admin/invitations", json={
            "group_id": state["group_id"],
            "email": "x@y.com",
        })
        assert r.status_code == 403

    def test_admin_creates_email_invite(self, admin):
        invitee_email = f"TEST_invitee_{TS}@ajo.com".lower()
        state["invitee_email"] = invitee_email
        r = admin.post(f"{API}/admin/invitations", json={
            "group_id": state["group_id"],
            "email": invitee_email,
            "send_email": True,
            "send_whatsapp": False,
            "note": "Welcome!",
        })
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv["status"] == "pending"
        assert "token" in inv and len(inv["token"]) > 10
        assert inv["sent"]["whatsapp"] is False  # twilio not really configured for sending
        state["invite_id"] = inv["id"]
        state["invite_token"] = inv["token"]

    def test_admin_create_invite_requires_email_or_phone(self, admin):
        r = admin.post(f"{API}/admin/invitations", json={"group_id": state["group_id"]})
        assert r.status_code == 400

    def test_admin_create_invite_invalid_group(self, admin):
        r = admin.post(f"{API}/admin/invitations", json={"group_id": "no-such-group", "email": "a@b.com"})
        assert r.status_code == 404

    def test_list_invitations_for_group(self, admin):
        r = admin.get(f"{API}/admin/invitations", params={"group_id": state["group_id"]})
        assert r.status_code == 200
        items = r.json()
        assert any(i["id"] == state["invite_id"] for i in items)

    def test_public_view_invite(self):
        r = requests.get(f"{API}/invite/{state['invite_token']}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "pending"
        assert d["group"]["id"] == state["group_id"]
        assert d["group"]["rules_text"].startswith("Rule 1")
        assert d["invitation"]["email"] == state["invitee_email"]

    def test_view_invite_invalid_token_404(self):
        r = requests.get(f"{API}/invite/badtoken12345")
        assert r.status_code == 404

    def test_accept_invite_rejects_unaccepted_rules(self):
        s = requests.Session()
        r = s.post(f"{API}/invite/{state['invite_token']}/accept",
                   json={"name": "X", "password": "abcdef", "accepted_rules": False})
        assert r.status_code == 400

    def test_accept_invite_creates_user_and_joins_group(self):
        # Use a fresh session (anonymous user)
        s = requests.Session()
        r = s.post(f"{API}/invite/{state['invite_token']}/accept",
                   json={"name": "Invited User", "password": "abcdef", "accepted_rules": True})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["group_id"] == state["group_id"]
        assert d["user"]["email"] == state["invitee_email"]
        state["invitee_session"] = s
        state["invitee_user_id"] = d["user"]["id"]
        # Verify cookie was set: /auth/me should now return them
        r2 = s.get(f"{API}/auth/me")
        assert r2.status_code == 200
        assert r2.json()["email"] == state["invitee_email"]

    def test_accept_invite_marks_invitation_accepted(self, admin):
        items = admin.get(f"{API}/admin/invitations", params={"group_id": state["group_id"]}).json()
        target = [i for i in items if i["id"] == state["invite_id"]][0]
        assert target["status"] == "accepted"
        assert target["accepted_user_id"] == state["invitee_user_id"]

    def test_invitee_in_group_member_list(self, admin):
        # admin endpoint returns {group, members, cycles} - check membership
        d = admin.get(f"{API}/admin/groups/{state['group_id']}").json()
        assert any(m["user_email"] == state["invitee_email"] for m in d["members"])
        # Verify cycle statuses generated via the group detail endpoint (uses invitee session)
        s = state["invitee_session"]
        gd = s.get(f"{API}/groups/{state['group_id']}/detail").json()
        my_statuses = [st for st in gd.get("statuses", []) if st["user_id"] == state["invitee_user_id"]]
        assert len(my_statuses) == 6  # total_cycles for the test group

    def test_accept_invite_when_email_already_exists_409(self, admin):
        # Create new invite for existing user (member)
        r = admin.post(f"{API}/admin/invitations", json={
            "group_id": state["group_id"],
            "email": state["member_email"],
        })
        assert r.status_code == 200
        token = r.json()["token"]
        # Try anonymously -> 409 because user with email exists
        s = requests.Session()
        r2 = s.post(f"{API}/invite/{token}/accept",
                    json={"name": "X", "password": "abcdef", "accepted_rules": True})
        assert r2.status_code == 409

    def test_accept_invite_when_logged_in_auto_joins(self, admin, member):
        # Create an invite directed at member (already registered)
        r = admin.post(f"{API}/admin/invitations", json={
            "group_id": state["group_id"],
            "email": state["member_email"],
        })
        assert r.status_code == 200
        token = r.json()["token"]
        # Member is logged in, accept without name/password
        r2 = member.post(f"{API}/invite/{token}/accept", json={"accepted_rules": True})
        assert r2.status_code == 200, r2.text
        # Should now appear as a group member
        d = admin.get(f"{API}/admin/groups/{state['group_id']}").json()
        assert any(m["user_email"] == state["member_email"] for m in d["members"])

    def test_revoke_invitation(self, admin):
        # New invitation
        r = admin.post(f"{API}/admin/invitations", json={
            "group_id": state["group_id"],
            "email": f"TEST_revoke_{TS}@ajo.com",
        })
        inv_id = r.json()["id"]
        token = r.json()["token"]
        # Revoke
        r2 = admin.delete(f"{API}/admin/invitations/{inv_id}")
        assert r2.status_code == 200
        # Listing shows revoked
        items = admin.get(f"{API}/admin/invitations", params={"group_id": state["group_id"]}).json()
        rev = [i for i in items if i["id"] == inv_id][0]
        assert rev["status"] == "revoked"
        # Public view shows revoked status
        pv = requests.get(f"{API}/invite/{token}").json()
        assert pv["status"] == "revoked"
        # Accept should fail
        s = requests.Session()
        r3 = s.post(f"{API}/invite/{token}/accept",
                    json={"name": "X", "password": "abcdef", "accepted_rules": True})
        assert r3.status_code == 400


# ---------------- Comments ----------------
class TestComments:
    def test_outsider_cannot_list_comments(self, outsider):
        r = outsider.get(f"{API}/groups/{state['group_id']}/comments")
        assert r.status_code == 403

    def test_admin_can_list_comments(self, admin):
        r = admin.get(f"{API}/groups/{state['group_id']}/comments")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_member_can_post_comment(self, member):
        r = member.post(f"{API}/groups/{state['group_id']}/comments", json={"body": "Hello group!"})
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["body"] == "Hello group!"
        assert c["is_admin"] is False
        state["member_comment_id"] = c["id"]

    def test_admin_can_post_comment(self, admin):
        r = admin.post(f"{API}/groups/{state['group_id']}/comments", json={"body": "Admin announce"})
        assert r.status_code == 200
        c = r.json()
        assert c["is_admin"] is True
        state["admin_comment_id"] = c["id"]

    def test_empty_comment_rejected(self, member):
        r = member.post(f"{API}/groups/{state['group_id']}/comments", json={"body": "   "})
        assert r.status_code == 400

    def test_outsider_cannot_post_comment(self, outsider):
        r = outsider.post(f"{API}/groups/{state['group_id']}/comments", json={"body": "spam"})
        assert r.status_code == 403

    def test_member_cannot_delete_admin_comment(self, member):
        r = member.delete(f"{API}/groups/{state['group_id']}/comments/{state['admin_comment_id']}")
        assert r.status_code == 403

    def test_owner_can_delete_own_comment(self, member):
        r = member.delete(f"{API}/groups/{state['group_id']}/comments/{state['member_comment_id']}")
        assert r.status_code == 200

    def test_admin_can_delete_others_comment(self, admin, member):
        # Member posts new comment, admin deletes
        r = member.post(f"{API}/groups/{state['group_id']}/comments", json={"body": "to delete"})
        cid = r.json()["id"]
        r2 = admin.delete(f"{API}/groups/{state['group_id']}/comments/{cid}")
        assert r2.status_code == 200

    def test_disable_comments_blocks_members_but_not_admin(self, admin, member):
        # Create new group with enable_comments=False
        payload = {
            "name": f"TEST_NoComments_{TS}",
            "contribution_amount": 1000,
            "frequency": "monthly",
            "start_date": "2026-04-01",
            "total_cycles": 3,
            "member_limit": 5,
            "rules_text": "no comments allowed",
            "enable_comments": False,
        }
        r = admin.post(f"{API}/admin/groups", json=payload)
        assert r.status_code == 200
        gid = r.json()["id"]
        # Add member to that group
        r2 = admin.post(f"{API}/admin/groups/{gid}/members",
                        json={"email": state["member_email"], "payout_position": 1})
        assert r2.status_code == 200
        # Member tries to post -> 403
        r3 = member.post(f"{API}/groups/{gid}/comments", json={"body": "hello"})
        assert r3.status_code == 403
        # Admin can still post
        r4 = admin.post(f"{API}/groups/{gid}/comments", json={"body": "admin override"})
        assert r4.status_code == 200


# ---------------- Existing flow regression smoke ----------------
class TestRegressionSmoke:
    def test_admin_dashboard_stats(self, admin):
        r = admin.get(f"{API}/admin/dashboard-stats")
        assert r.status_code == 200
        for k in ["active_groups", "total_members", "pending_payments", "upcoming_payouts", "total_collections"]:
            assert k in r.json()

    def test_audit_logs_recorded(self, admin):
        r = admin.get(f"{API}/admin/audit-logs")
        assert r.status_code == 200
        actions = [log["action"] for log in r.json()]
        # We did a settings update + invitation create + invite accepted in this run
        assert any(a in actions for a in ["settings_updated", "invite_created", "invite_accepted"])
