from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Literal
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from email_service import send_email

# ---------------- DB & APP ----------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Ajo Platform API")
api = APIRouter(prefix="/api")

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"

# ---------------- HELPERS ----------------
def now_utc():
    return datetime.now(timezone.utc)

def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def make_token(user_id: str, email: str, role: str, ttl_min=60*24):
    payload = {"sub": user_id, "email": email, "role": role,
               "exp": now_utc() + timedelta(minutes=ttl_min), "type": "access"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def set_auth_cookie(response: Response, token: str):
    response.set_cookie(key="access_token", value=token, httponly=True,
                        secure=True, samesite="none", max_age=60*60*24, path="/")

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

async def require_admin(user=Depends(get_current_user)):
    if user.get("role") not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    return user

# ---------------- MODELS ----------------
class RegisterIn(BaseModel):
    name: str
    email: EmailStr
    password: str

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_number: Optional[str] = None
    bank_account_name: Optional[str] = None
    visibility_preference: Optional[Literal["visible", "limited", "hidden"]] = None

class GroupCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    contribution_amount: float
    frequency: Literal["monthly", "weekly", "biweekly"] = "monthly"
    start_date: str  # YYYY-MM-DD
    total_cycles: int
    member_limit: int
    due_day: int = 1  # day of month / day index
    due_time: str = "23:59"
    first_payment_fee: float = 0.0
    late_fee_amount: float = 0.0
    late_fee_method: Literal["fixed", "percent"] = "fixed"
    grace_period_days: int = 0
    payment_account_details: Optional[str] = ""
    whatsapp_invite_link: Optional[str] = ""
    whatsapp_group_name: Optional[str] = ""

class AddMember(BaseModel):
    email: EmailStr
    payout_position: Optional[int] = None

class PaymentUpload(BaseModel):
    group_id: str
    cycle_no: int
    amount: float
    receipt_data_url: str  # base64 data url
    note: Optional[str] = ""

class DecisionIn(BaseModel):
    decision: Literal["approve", "reject"]
    note: Optional[str] = ""

class VisibilityDecision(BaseModel):
    decision: Literal["approve", "reject"]
    note: Optional[str] = ""

# ---------------- AUDIT ----------------
async def log_audit(actor_id: str, action: str, target: str = "", meta: dict = None):
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "actor_id": actor_id,
        "action": action,
        "target": target,
        "meta": meta or {},
        "timestamp": now_utc().isoformat(),
    })

async def push_notification(user_id: str, title: str, body: str, link: str = ""):
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "title": title,
        "body": body,
        "link": link,
        "read": False,
        "timestamp": now_utc().isoformat(),
    })

# ---------------- AUTH ROUTES ----------------
@api.post("/auth/register")
async def register(data: RegisterIn, response: Response):
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    user = {
        "id": user_id,
        "email": email,
        "name": data.name,
        "password_hash": hash_pw(data.password),
        "role": "member",
        "phone": "",
        "bank_name": "",
        "bank_account_number": "",
        "bank_account_name": "",
        "visibility_preference": "visible",
        "visibility_status": "approved",
        "created_at": now_utc().isoformat(),
    }
    await db.users.insert_one(user.copy())
    token = make_token(user_id, email, "member")
    set_auth_cookie(response, token)
    await push_notification(user_id, "Welcome to Ajo Platform",
                            "Your account is created. Wait for an admin to assign you to a group.")
    await send_email(email, "Welcome to Ajo Platform",
                     f"Hi {data.name},",
                     "Your member account is ready. An admin will add you to a group shortly. "
                     "You can update your bank details and profile preferences from your dashboard.",
                     cta_label="Open dashboard",
                     cta_link=f"{os.environ.get('FRONTEND_URL','')}/dashboard")
    user.pop("password_hash", None)
    return {"user": user, "token": token}

@api.post("/auth/login")
async def login(data: LoginIn, response: Response):
    email = data.email.lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_pw(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = make_token(user["id"], user["email"], user["role"])
    set_auth_cookie(response, token)
    user.pop("password_hash", None)
    return {"user": user, "token": token}

@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}

@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user

# ---------------- PROFILE ----------------
@api.put("/me/profile")
async def update_profile(data: ProfileUpdate, user=Depends(get_current_user)):
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if "visibility_preference" in update:
        # Visibility change requires admin approval
        await db.visibility_requests.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "user_email": user["email"],
            "user_name": user["name"],
            "requested_preference": update["visibility_preference"],
            "current_preference": user.get("visibility_preference", "visible"),
            "status": "pending",
            "created_at": now_utc().isoformat(),
        })
        update["visibility_status"] = "pending"
        await log_audit(user["id"], "visibility_request", meta={"requested": update["visibility_preference"]})
    if update:
        await db.users.update_one({"id": user["id"]}, {"$set": update})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return fresh

# ---------------- ADMIN: GROUP CREATE ----------------
def _add_period(start: date, frequency: str, n: int) -> date:
    if frequency == "weekly":
        return start + timedelta(weeks=n)
    if frequency == "biweekly":
        return start + timedelta(weeks=2*n)
    # monthly
    month = start.month - 1 + n
    year = start.year + month // 12
    month = month % 12 + 1
    day = min(start.day, 28)
    return date(year, month, day)

@api.post("/admin/groups")
async def create_group(data: GroupCreate, admin=Depends(require_admin)):
    gid = str(uuid.uuid4())
    start = date.fromisoformat(data.start_date)
    group_doc = {
        "id": gid,
        "name": data.name,
        "description": data.description,
        "contribution_amount": data.contribution_amount,
        "frequency": data.frequency,
        "start_date": data.start_date,
        "total_cycles": data.total_cycles,
        "member_limit": data.member_limit,
        "due_day": data.due_day,
        "due_time": data.due_time,
        "first_payment_fee": data.first_payment_fee,
        "late_fee_amount": data.late_fee_amount,
        "late_fee_method": data.late_fee_method,
        "grace_period_days": data.grace_period_days,
        "payment_account_details": data.payment_account_details,
        "whatsapp_invite_link": data.whatsapp_invite_link or "",
        "whatsapp_group_name": data.whatsapp_group_name or "",
        "status": "active",
        "created_by": admin["id"],
        "created_at": now_utc().isoformat(),
    }
    await db.groups.insert_one(group_doc.copy())
    # generate cycles
    cycles = []
    for i in range(data.total_cycles):
        due = _add_period(start, data.frequency, i)
        cycles.append({
            "id": str(uuid.uuid4()),
            "group_id": gid,
            "cycle_no": i + 1,
            "due_date": due.isoformat(),
            "due_time": data.due_time,
            "expected_amount": data.contribution_amount + (data.first_payment_fee if i == 0 else 0),
            "payout_user_id": None,
            "payout_status": "pending",
            "payout_confirmed_at": None,
        })
    if cycles:
        await db.cycles.insert_many(cycles)
    await log_audit(admin["id"], "group_created", target=gid, meta={"name": data.name})
    group_doc.pop("_id", None)
    return group_doc

@api.get("/admin/groups")
async def list_groups_admin(admin=Depends(require_admin)):
    groups = await db.groups.find({}, {"_id": 0}).to_list(1000)
    for g in groups:
        g["member_count"] = await db.group_members.count_documents({"group_id": g["id"]})
    return groups

@api.get("/admin/groups/{group_id}")
async def get_group_admin(group_id: str, admin=Depends(require_admin)):
    g = await db.groups.find_one({"id": group_id}, {"_id": 0})
    if not g:
        raise HTTPException(404, "Group not found")
    members = await db.group_members.find({"group_id": group_id}, {"_id": 0}).to_list(1000)
    cycles = await db.cycles.find({"group_id": group_id}, {"_id": 0}).sort("cycle_no", 1).to_list(1000)
    return {"group": g, "members": members, "cycles": cycles}

@api.post("/admin/groups/{group_id}/members")
async def add_member(group_id: str, data: AddMember, admin=Depends(require_admin)):
    group = await db.groups.find_one({"id": group_id})
    if not group:
        raise HTTPException(404, "Group not found")
    user = await db.users.find_one({"email": data.email.lower()}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found. Member must sign up first.")
    if user["role"] not in ("member", "admin", "super_admin"):
        raise HTTPException(400, "Invalid user")
    existing = await db.group_members.find_one({"group_id": group_id, "user_id": user["id"]})
    if existing:
        raise HTTPException(400, "User already in group")
    count = await db.group_members.count_documents({"group_id": group_id})
    if count >= group["member_limit"]:
        raise HTTPException(400, "Group member limit reached")
    position = data.payout_position or (count + 1)
    gm = {
        "id": str(uuid.uuid4()),
        "group_id": group_id,
        "user_id": user["id"],
        "user_email": user["email"],
        "user_name": user["name"],
        "payout_position": position,
        "joined_at": now_utc().isoformat(),
        "status": "active",
    }
    await db.group_members.insert_one(gm.copy())
    # create cycle status records
    cycles = await db.cycles.find({"group_id": group_id}).to_list(1000)
    today = now_utc().date()
    docs = []
    for c in cycles:
        due = date.fromisoformat(c["due_date"])
        status_val = "Due" if due <= today else "Not_Due"
        docs.append({
            "id": str(uuid.uuid4()),
            "group_id": group_id,
            "cycle_no": c["cycle_no"],
            "user_id": user["id"],
            "status": status_val,
            "expected_amount": c["expected_amount"],
            "paid_amount": 0,
            "approved_at": None,
            "approver_id": None,
            "updated_at": now_utc().isoformat(),
        })
    if docs:
        await db.member_cycle_status.insert_many(docs)
    # assign payout if no other for this position
    cycle = await db.cycles.find_one({"group_id": group_id, "cycle_no": position})
    if cycle and not cycle.get("payout_user_id"):
        await db.cycles.update_one({"id": cycle["id"]}, {"$set": {"payout_user_id": user["id"]}})
    await log_audit(admin["id"], "member_added", target=group_id, meta={"user": user["email"]})
    await push_notification(user["id"], "Added to a group",
                            f"You have been added to '{group['name']}' (Payout #{position}).",
                            link=f"/groups/{group_id}")
    wa_html = ""
    if group.get("whatsapp_invite_link"):
        wa_html = f'<p style="margin-top:12px">Join the WhatsApp group: <a href="{group["whatsapp_invite_link"]}">{group.get("whatsapp_group_name") or "Open invite"}</a></p>'
    await send_email(user["email"], f"You've been added to {group['name']}",
                     f"Welcome to {group['name']}",
                     f"You are payout #{position} in this {group['frequency']} contribution. "
                     f"Contribution amount: {group['contribution_amount']}.{wa_html}",
                     cta_label="View group",
                     cta_link=f"{os.environ.get('FRONTEND_URL','')}/groups/{group_id}")
    return gm

@api.delete("/admin/groups/{group_id}/members/{user_id}")
async def remove_member(group_id: str, user_id: str, admin=Depends(require_admin)):
    res = await db.group_members.delete_one({"group_id": group_id, "user_id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Member not found")
    await log_audit(admin["id"], "member_removed", target=group_id, meta={"user_id": user_id})
    return {"ok": True}

# ---------------- PAYMENTS ----------------
@api.post("/payments/upload")
async def upload_payment(data: PaymentUpload, user=Depends(get_current_user)):
    gm = await db.group_members.find_one({"group_id": data.group_id, "user_id": user["id"]})
    if not gm:
        raise HTTPException(403, "You are not a member of this group")
    cycle = await db.cycles.find_one({"group_id": data.group_id, "cycle_no": data.cycle_no})
    if not cycle:
        raise HTTPException(404, "Cycle not found")
    pid = str(uuid.uuid4())
    doc = {
        "id": pid,
        "group_id": data.group_id,
        "cycle_no": data.cycle_no,
        "user_id": user["id"],
        "user_name": user["name"],
        "user_email": user["email"],
        "amount": data.amount,
        "receipt_data_url": data.receipt_data_url,
        "note": data.note,
        "status": "submitted",
        "decision_note": "",
        "approver_id": None,
        "submitted_at": now_utc().isoformat(),
        "decided_at": None,
    }
    await db.payments.insert_one(doc.copy())
    await db.member_cycle_status.update_one(
        {"group_id": data.group_id, "cycle_no": data.cycle_no, "user_id": user["id"]},
        {"$set": {"status": "Submitted", "paid_amount": data.amount,
                  "updated_at": now_utc().isoformat(), "last_payment_id": pid}}
    )
    await log_audit(user["id"], "payment_uploaded", target=pid,
                    meta={"group_id": data.group_id, "cycle": data.cycle_no})
    # notify admin
    admins = await db.users.find({"role": {"$in": ["admin", "super_admin"]}}).to_list(100)
    for a in admins:
        await push_notification(a["id"], "New payment submitted",
                                f"{user['name']} submitted ₦{data.amount} for cycle {data.cycle_no}.",
                                link=f"/admin")
    doc.pop("_id", None)
    return doc

@api.get("/payments/my")
async def my_payments(user=Depends(get_current_user)):
    items = await db.payments.find({"user_id": user["id"]}, {"_id": 0, "receipt_data_url": 0}).sort("submitted_at", -1).to_list(500)
    return items

@api.get("/payments/{payment_id}")
async def get_payment(payment_id: str, user=Depends(get_current_user)):
    p = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Not found")
    if user["role"] not in ("admin", "super_admin") and p["user_id"] != user["id"]:
        raise HTTPException(403, "Forbidden")
    return p

@api.get("/admin/payments/pending")
async def pending_payments(admin=Depends(require_admin)):
    items = await db.payments.find({"status": "submitted"}, {"_id": 0, "receipt_data_url": 0}).sort("submitted_at", -1).to_list(500)
    return items

@api.post("/admin/payments/{payment_id}/decision")
async def decide_payment(payment_id: str, data: DecisionIn, admin=Depends(require_admin)):
    p = await db.payments.find_one({"id": payment_id})
    if not p:
        raise HTTPException(404, "Payment not found")
    new_status = "approved" if data.decision == "approve" else "rejected"
    cycle_status = "Paid" if data.decision == "approve" else "Rejected"
    await db.payments.update_one({"id": payment_id}, {"$set": {
        "status": new_status,
        "decision_note": data.note,
        "approver_id": admin["id"],
        "decided_at": now_utc().isoformat(),
    }})
    await db.member_cycle_status.update_one(
        {"group_id": p["group_id"], "cycle_no": p["cycle_no"], "user_id": p["user_id"]},
        {"$set": {"status": cycle_status,
                  "approved_at": now_utc().isoformat() if data.decision == "approve" else None,
                  "approver_id": admin["id"] if data.decision == "approve" else None,
                  "updated_at": now_utc().isoformat()}}
    )
    await log_audit(admin["id"], f"payment_{new_status}", target=payment_id,
                    meta={"group_id": p["group_id"], "user_id": p["user_id"]})
    await push_notification(
        p["user_id"],
        "Payment approved" if data.decision == "approve" else "Payment rejected",
        f"Your payment for cycle {p['cycle_no']} was {new_status}." + (f" Note: {data.note}" if data.note else ""),
        link=f"/groups/{p['group_id']}"
    )
    await send_email(
        p["user_email"],
        f"Payment {new_status} — Cycle {p['cycle_no']}",
        f"Payment {new_status}",
        f"Your payment of {p['amount']} for cycle {p['cycle_no']} was <b>{new_status}</b>." +
        (f"<br><br>Admin note: {data.note}" if data.note else ""),
        cta_label="View group",
        cta_link=f"{os.environ.get('FRONTEND_URL','')}/groups/{p['group_id']}"
    )
    return {"ok": True, "status": new_status}

# ---------------- PAYOUTS ----------------
@api.post("/admin/payouts/{group_id}/{cycle_no}/confirm")
async def confirm_payout(group_id: str, cycle_no: int, admin=Depends(require_admin)):
    cycle = await db.cycles.find_one({"group_id": group_id, "cycle_no": cycle_no})
    if not cycle:
        raise HTTPException(404, "Cycle not found")
    if not cycle.get("payout_user_id"):
        raise HTTPException(400, "No payout recipient assigned")
    await db.cycles.update_one({"id": cycle["id"]}, {"$set": {
        "payout_status": "completed",
        "payout_confirmed_at": now_utc().isoformat(),
    }})
    await db.member_cycle_status.update_one(
        {"group_id": group_id, "cycle_no": cycle_no, "user_id": cycle["payout_user_id"]},
        {"$set": {"status": "Payout_Completed", "updated_at": now_utc().isoformat()}}
    )
    await log_audit(admin["id"], "payout_confirmed", target=group_id,
                    meta={"cycle": cycle_no, "user_id": cycle["payout_user_id"]})
    await push_notification(cycle["payout_user_id"], "Payout completed",
                            f"Your payout for cycle {cycle_no} has been confirmed.",
                            link=f"/groups/{group_id}")
    recipient = await db.users.find_one({"id": cycle["payout_user_id"]}, {"_id": 0, "email": 1})
    if recipient:
        group = await db.groups.find_one({"id": group_id}, {"_id": 0, "name": 1})
        await send_email(recipient["email"], "Payout completed",
                         "Your payout has been confirmed",
                         f"The payout for cycle {cycle_no} of <b>{group.get('name','your group')}</b> has been confirmed by the admin.",
                         cta_label="View group",
                         cta_link=f"{os.environ.get('FRONTEND_URL','')}/groups/{group_id}")
    return {"ok": True}

# ---------------- MEMBER VIEWS ----------------
@api.get("/groups/my")
async def my_groups(user=Depends(get_current_user)):
    memberships = await db.group_members.find({"user_id": user["id"]}, {"_id": 0}).to_list(100)
    out = []
    for m in memberships:
        g = await db.groups.find_one({"id": m["group_id"]}, {"_id": 0})
        if g:
            out.append({**g, "payout_position": m["payout_position"]})
    return out

@api.get("/groups/{group_id}/detail")
async def group_detail(group_id: str, user=Depends(get_current_user)):
    g = await db.groups.find_one({"id": group_id}, {"_id": 0})
    if not g:
        raise HTTPException(404, "Group not found")
    is_admin = user["role"] in ("admin", "super_admin")
    is_member = await db.group_members.find_one({"group_id": group_id, "user_id": user["id"]})
    if not is_admin and not is_member:
        raise HTTPException(403, "Not a member of this group")
    cycles = await db.cycles.find({"group_id": group_id}, {"_id": 0}).sort("cycle_no", 1).to_list(1000)
    members = await db.group_members.find({"group_id": group_id}, {"_id": 0}).to_list(1000)
    # attach payout names
    user_map = {}
    for m in members:
        user_map[m["user_id"]] = m["user_name"]
    for c in cycles:
        c["payout_user_name"] = user_map.get(c.get("payout_user_id"), None)
    if is_admin:
        my_status = await db.member_cycle_status.find({"group_id": group_id}, {"_id": 0}).to_list(5000)
    else:
        my_status = await db.member_cycle_status.find({"group_id": group_id, "user_id": user["id"]}, {"_id": 0}).to_list(1000)
    return {"group": g, "cycles": cycles, "members": members, "statuses": my_status}

# ---------------- DASHBOARD STATS ----------------
@api.get("/admin/dashboard-stats")
async def dashboard_stats(admin=Depends(require_admin)):
    active_groups = await db.groups.count_documents({"status": "active"})
    total_members = await db.users.count_documents({"role": "member"})
    pending_payments = await db.payments.count_documents({"status": "submitted"})
    overdue = await db.member_cycle_status.count_documents({"status": "Overdue"})
    due_now = await db.member_cycle_status.count_documents({"status": "Due"})
    # total collections = sum of approved payments
    pipeline = [{"$match": {"status": "approved"}}, {"$group": {"_id": None, "total": {"$sum": "$amount"}}}]
    res = await db.payments.aggregate(pipeline).to_list(1)
    total_collections = res[0]["total"] if res else 0
    upcoming_payouts = await db.cycles.count_documents({"payout_status": "pending"})
    return {
        "active_groups": active_groups,
        "total_members": total_members,
        "pending_payments": pending_payments,
        "overdue_payments": overdue,
        "due_now": due_now,
        "upcoming_payouts": upcoming_payouts,
        "total_collections": total_collections,
    }

@api.get("/admin/users")
async def list_users(admin=Depends(require_admin)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return users

# ---------------- VISIBILITY ----------------
@api.get("/admin/visibility-requests")
async def list_visibility_requests(admin=Depends(require_admin)):
    items = await db.visibility_requests.find({"status": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items

@api.post("/admin/visibility-requests/{rid}/decision")
async def decide_visibility(rid: str, data: VisibilityDecision, admin=Depends(require_admin)):
    r = await db.visibility_requests.find_one({"id": rid})
    if not r:
        raise HTTPException(404, "Request not found")
    new_status = "approved" if data.decision == "approve" else "rejected"
    await db.visibility_requests.update_one({"id": rid}, {"$set": {
        "status": new_status,
        "decision_note": data.note,
        "decided_by": admin["id"],
        "decided_at": now_utc().isoformat(),
    }})
    upd = {"visibility_status": new_status}
    if data.decision == "approve":
        upd["visibility_preference"] = r["requested_preference"]
    await db.users.update_one({"id": r["user_id"]}, {"$set": upd})
    await log_audit(admin["id"], f"visibility_{new_status}", target=r["user_id"])
    await push_notification(r["user_id"], f"Visibility request {new_status}",
                            f"Your visibility preference change was {new_status}.")
    return {"ok": True}

# ---------------- AUDIT LOGS & NOTIFS ----------------
@api.get("/admin/audit-logs")
async def audit_logs(admin=Depends(require_admin)):
    logs = await db.audit_logs.find({}, {"_id": 0}).sort("timestamp", -1).limit(500).to_list(500)
    # attach actor names
    actor_ids = list({l["actor_id"] for l in logs})
    users = await db.users.find({"id": {"$in": actor_ids}}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(1000)
    umap = {u["id"]: u for u in users}
    for l in logs:
        u = umap.get(l["actor_id"], {})
        l["actor_name"] = u.get("name", "Unknown")
        l["actor_email"] = u.get("email", "")
    return logs

@api.get("/notifications/my")
async def my_notifications(user=Depends(get_current_user)):
    items = await db.notifications.find({"user_id": user["id"]}, {"_id": 0}).sort("timestamp", -1).limit(200).to_list(200)
    return items

@api.post("/notifications/read-all")
async def read_all(user=Depends(get_current_user)):
    await db.notifications.update_many({"user_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}

# ---------------- INCLUDE ROUTER ----------------
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_origin_regex=".*",
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ajo")

# ---------------- STARTUP ----------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.group_members.create_index([("group_id", 1), ("user_id", 1)], unique=True)
    await db.member_cycle_status.create_index([("group_id", 1), ("cycle_no", 1), ("user_id", 1)], unique=True)
    await db.cycles.create_index([("group_id", 1), ("cycle_no", 1)], unique=True)
    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@ajo.com").lower()
    admin_pw = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "name": "Platform Admin",
            "password_hash": hash_pw(admin_pw),
            "role": "super_admin",
            "phone": "",
            "bank_name": "",
            "bank_account_number": "",
            "bank_account_name": "",
            "visibility_preference": "visible",
            "visibility_status": "approved",
            "created_at": now_utc().isoformat(),
        })
        logger.info(f"Seeded admin: {admin_email}")

@app.on_event("shutdown")
async def shutdown():
    client.close()
