import frappe
from frappe.utils import get_site_path


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------

def get_current_user_room():
    """Returns the QMS Room for the currently logged-in user via their counter."""
    user = frappe.session.user
    room = frappe.db.get_value("Queue Counter", {"assigned_user": user, "is_active": 1}, "room")
    return room


# ---------------------------------------------------------------------------
# DASHBOARD
# ---------------------------------------------------------------------------

@frappe.whitelist(allow_guest=True)
def get_queue_dashboard():
    serving = frappe.get_all("Queue Entry",
        filters={"status": ["in", ["Called", "Serving"]]},
        fields=["token_number", "room", "counter", "priority"],
        order_by="called_at asc"
    )

    waiting = frappe.get_all("Queue Entry",
        filters={"status": "Waiting"},
        fields=["token_number", "room", "priority", "enqueued_at"],
        order_by="enqueued_at asc"
    )

    priority_order = {"Emergency": 0, "Urgent": 1, "Normal": 2}
    waiting = sorted(waiting, key=lambda x: priority_order.get(x.get("priority"), 3))

    try:
        counters = frappe.get_all("Queue Counter",
            filters={"is_active": 1},
            fields=["counter_name", "room", "display_order"],
            order_by="display_order asc"
        )
    except Exception:
        counters = frappe.get_all("Queue Counter",
            filters={"is_active": 1},
            fields=["counter_name", "room"],
            order_by="counter_name asc"
        )

    return {"serving": serving, "waiting": waiting, "counters": counters}


# ---------------------------------------------------------------------------
# SETTINGS
# ---------------------------------------------------------------------------

@frappe.whitelist(allow_guest=True)
def get_qms_settings():
    """Returns QMS Settings for use in kiosk, print, and display pages."""
    settings = frappe.get_single("QMS Setting")
    return {
        "token_prefix": settings.token_prefix or "T",
        "logo": settings.logo or None,
        "organization_name": settings.organization_name or "Hospital",
        "display_title": settings.display_title or settings.organization_name or "Hospital",
        "kiosk_title": settings.kiosk_title or "Queue Management System",
        "receipt_header": settings.receipt_header or "Hospital",
        "receipt_footer": settings.receipt_footer or "Thank You",
        "enable_printing": settings.enable_printing,
        "enable_sound": settings.enable_sound,
    }


@frappe.whitelist(allow_guest=True)
def get_company_details():
    company = frappe.db.get_single_value("Global Defaults", "default_company")
    if not company:
        companies = frappe.get_all("Company", limit=1)
        company = companies[0].name if companies else None

    if not company:
        return {"logo": None, "color": "#2B5BA8", "name": "Hospital"}

    details = frappe.db.get_value("Company", company,
        ["company_logo", "name"],
        as_dict=True
    )

    return {
        "logo": details.company_logo if details else None,
        "name": details.name if details else company,
        "color": "#2B5BA8"
    }


# ---------------------------------------------------------------------------
# PATIENT / CHECK-IN
# ---------------------------------------------------------------------------

@frappe.whitelist(allow_guest=True)
def check_patient(phone: str):
    existing = frappe.db.get_value("HQS Patient",
        {"mobile": phone},
        ["name", "patient_name"],
        as_dict=True
    )
    if existing:
        return {"exists": True, "name": existing.patient_name}
    return {"exists": False}


@frappe.whitelist(allow_guest=True)
def create_patient_visit(phone: str, full_name: str, reason_for_visit: str = ""):
    # Find or create HQS Patient
    patient = frappe.db.get_value("HQS Patient", {"mobile": phone}, "name")

    if not patient:
        parts = full_name.strip().split(" ", 1)
        first_name = parts[0]
        last_name = parts[1] if len(parts) > 1 else ""

        patient_doc = frappe.get_doc({
            "doctype": "HQS Patient",
            "first_name": first_name,
            "last_name": last_name,
            "patient_name": full_name,
            "mobile": phone,
            "name": phone,
        })
        patient_doc.insert(ignore_permissions=True)
        frappe.db.commit()
        patient = patient_doc.name

    assignment = get_least_busy_counter("Reception")

    if not assignment:
        frappe.throw("No active reception counters configured. Please contact staff.")

    entry = frappe.get_doc({
        "doctype": "Queue Entry",
        "patient": patient,
        "room": assignment["room"],
        "counter": assignment["counter"],
        "priority": "Normal",
        "status": "Waiting",
        "phone_numberid": phone,
    })
    entry.insert(ignore_permissions=True)
    frappe.db.commit()

    print_receipt({"token": entry.token_number, "full_name": full_name})

    return {
        "token": entry.token_number,
        "room": assignment["room"],
        "counter": assignment["counter"],
        "queue_entry": entry.name
    }


def get_least_busy_counter(room_name="Reception"):
    """
    Finds the active counter inside the given room with the
    fewest waiting/called/serving patients.
    """
    room = frappe.db.get_value("QMS Room",
        {"active": 1, "name": room_name}, "name"
    )
    if not room:
        # fallback: get any active room
        room = frappe.db.get_value("QMS Room", {"active": 1}, "name")
    if not room:
        return None

    counters = frappe.get_all("Queue Counter",
        filters={"room": room, "is_active": 1},
        fields=["name"]
    )
    if not counters:
        return None

    counter_loads = []
    for c in counters:
        count = frappe.db.count("Queue Entry", filters={
            "counter": c.name,
            "status": ["in", ["Waiting", "Called", "Serving"]]
        })
        counter_loads.append({"name": c.name, "load": count})

    least_busy = min(counter_loads, key=lambda x: x["load"])
    return {"room": room, "counter": least_busy["name"]}


def get_least_busy_room():
    """Returns the least busy active room."""
    rooms = frappe.get_all("QMS Room",
        filters={"active": 1},
        fields=["name"]
    )
    if not rooms:
        return None

    room_loads = []
    for r in rooms:
        count = frappe.db.count("Queue Entry", filters={
            "room": r.name,
            "status": ["in", ["Waiting", "Called", "Serving"]]
        })
        room_loads.append({"name": r.name, "load": count})

    least_busy = min(room_loads, key=lambda x: x["load"])
    return least_busy["name"]


# ---------------------------------------------------------------------------
# ROUTING
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_allowed_next_rooms(room: str):
    """Returns the list of rooms this room can forward patients to."""
    routing = frappe.get_all(
        "QMS Room Routing",
        filters={"parent": room, "parenttype": "QMS Room"},
        fields=["next_room"]
    )
    return routing


@frappe.whitelist()
def send_to_next_room(queue_entry: str, next_room: str, notes: str = ""):
    """Clerk selects which room to send the patient to next."""
    entry = frappe.get_doc("Queue Entry", queue_entry)

    if entry.status not in ["Called", "Serving"]:
        return {"success": False, "message": "Patient is not currently being served"}

    entry.status = "Done"
    entry.served_at = frappe.utils.now()
    if notes:
        entry.notes = notes
    entry.save(ignore_permissions=True)

    if next_room:
        new_entry = frappe.get_doc({
            "doctype": "Queue Entry",
            "patient": entry.patient,
            "room": next_room,
            "priority": entry.priority,
            "status": "Waiting",
            "token_number": entry.token_number,
            "current_step": (entry.current_step or 0) + 1,
        })
        new_entry.insert(ignore_permissions=True)

    frappe.db.commit()

    return {
        "success": True,
        "message": f"{entry.token_number} sent to {next_room}" if next_room else f"{entry.token_number} marked Done"
    }


# ---------------------------------------------------------------------------
# QUEUE — ROOM-BASED
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_my_room_queue():
    """Returns queue entries for the room assigned to the current user only."""
    user = frappe.session.user
    is_system_manager = "System Manager" in frappe.get_roles(user)

    filters = {"status": ["in", ["Waiting", "Called", "Serving"]]}

    if not is_system_manager:
        room = get_current_user_room()
        if not room:
            return {"error": "No room assigned to your account. Please contact the administrator."}
        filters["room"] = room

    return frappe.get_all("Queue Entry",
        filters=filters,
        fields=["name", "token_number", "room", "counter", "priority",
                "status", "patient", "enqueued_at", "called_at"],
        order_by="enqueued_at asc"
    )


@frappe.whitelist()
def get_my_counter():
    """Returns the counter record linked to the currently logged-in user."""
    user = frappe.session.user
    counter = frappe.db.get_value(
        "Queue Counter",
        {"assigned_user": user, "is_active": 1},
        ["name", "counter_name", "room"],
        as_dict=True
    )
    return counter or {}


@frappe.whitelist()
def peek_next_patient(room: str):
    """Returns who is next in the room queue without calling them."""
    priority_order = {"Emergency": 0, "Urgent": 1, "Normal": 2}

    waiting = frappe.get_all("Queue Entry",
        filters={"status": "Waiting", "room": room},
        fields=["name", "token_number", "priority", "patient", "enqueued_at"],
        order_by="enqueued_at asc"
    )

    if not waiting:
        return {"success": False, "message": "No patients waiting"}

    waiting = sorted(waiting, key=lambda x: priority_order.get(x.get("priority"), 3))
    next_patient = waiting[0]

    waiting_since = ""
    if next_patient.get("enqueued_at"):
        diff_mins = int(frappe.utils.time_diff_in_seconds(
            frappe.utils.now(), next_patient["enqueued_at"]
        ) / 60)
        if diff_mins < 1:
            waiting_since = "just now"
        elif diff_mins == 1:
            waiting_since = "1 minute"
        else:
            waiting_since = f"{diff_mins} minutes"

    return {
        "success": True,
        "name": next_patient["name"],
        "token_number": next_patient["token_number"],
        "patient": next_patient.get("patient") or "—",
        "priority": next_patient.get("priority") or "Normal",
        "waiting_since": waiting_since
    }


@frappe.whitelist()
def call_next_patient(room: str, counter: str, queue_entry: str = None):
    """Calls the next patient in the room queue."""
    already_called = frappe.db.count("Queue Entry", {
        "room": room,
        "status": "Called"
    })
    if already_called >= 1:
        return {
            "success": False,
            "message": f"Cannot call more patients — {room} already has a patient called. Please serve them first."
        }

    if queue_entry:
        entry = frappe.get_doc("Queue Entry", queue_entry)
    else:
        priority_order = {"Emergency": 0, "Urgent": 1, "Normal": 2}
        waiting = frappe.get_all("Queue Entry",
            filters={"status": "Waiting", "room": room},
            fields=["name", "token_number", "priority", "patient"],
            order_by="enqueued_at asc"
        )
        if not waiting:
            return {"success": False, "message": "No patients waiting"}
        waiting = sorted(waiting, key=lambda x: priority_order.get(x.get("priority"), 3))
        entry = frappe.get_doc("Queue Entry", waiting[0].name)

    entry.status = "Called"
    entry.called_at = frappe.utils.now()
    entry.counter = counter
    entry.save(ignore_permissions=True)
    frappe.db.commit()

    return {
        "success": True,
        "queue_entry": entry.name,
        "token": entry.token_number,
        "patient": entry.patient,
        "room": entry.room,
        "counter": counter,
        "message": f"Called {entry.token_number}"
    }


# ---------------------------------------------------------------------------
# STATS — FILTERED BY CURRENT USER'S ROOM (NO DEPARTMENTS)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_room_stats(room: str = None):
    """
    Returns stats filtered purely by room.
    - System Manager: sees all rooms combined
    - Everyone else: sees only their assigned room
    """
    today = frappe.utils.today()
    user = frappe.session.user
    is_system_manager = "System Manager" in frappe.get_roles(user)

    if is_system_manager:
        rooms = frappe.get_all('QMS Room',
            filters={'active': 1},
            pluck='name'
        )
    else:
        user_room = get_current_user_room()
        rooms = [user_room] if user_room else []

    if not rooms:
        return {
            'waiting': 0, 'serving': 0,
            'called': 0, 'done': 0,
            'now_serving': None, 'hourly': []
        }

    waiting  = frappe.db.count('Queue Entry', {'room': ['in', rooms], 'status': 'Waiting'})
    serving  = frappe.db.count('Queue Entry', {'room': ['in', rooms], 'status': ['in', ['Called', 'Serving']]})
    called   = frappe.db.count('Queue Entry', {'room': ['in', rooms], 'status': 'Called'})
    done     = frappe.db.count('Queue Entry', {'room': ['in', rooms], 'status': 'Done', 'served_at': ['>=', today]})

    now_serving = frappe.db.get_value('Queue Entry',
        {'room': ['in', rooms], 'status': ['in', ['Called', 'Serving']]},
        ['token_number', 'room'],
        as_dict=True, order_by='called_at desc'
    )

    rooms_str = "', '".join(rooms)
    hourly_raw = frappe.db.sql(f"""
        SELECT HOUR(served_at) as hr, COUNT(*) as count
        FROM `tabQueue Entry`
        WHERE room IN ('{rooms_str}')
          AND status = 'Done'
          AND DATE(served_at) = %(today)s
        GROUP BY HOUR(served_at)
    """, {'today': today}, as_dict=True)

    hour_map = {r.hr: r.count for r in hourly_raw}
    hourly = [{'hour': h, 'count': hour_map.get(h, 0)} for h in range(0, 24)]

    return {
        'waiting': waiting,
        'serving': serving,
        'called': called,
        'done': done,
        'now_serving': now_serving,
        'hourly': hourly
    }


# Keep old name as alias so existing frontend calls don't break
@frappe.whitelist()
def get_department_stats(department: str = None):
    return get_room_stats()


# ---------------------------------------------------------------------------
# DEBUG — Remove after testing
# ---------------------------------------------------------------------------

@frappe.whitelist(allow_guest=True)
def debug_counters():
    rooms = frappe.get_all("QMS Room", fields=["name", "active"])
    counters = frappe.get_all("Queue Counter",
        fields=["name", "counter_name", "room", "is_active", "assigned_user"])
    return {"rooms": rooms, "counters": counters}



@frappe.whitelist()
def debug_my_session():
    user = frappe.session.user
    roles = frappe.get_roles(user)
    counter = frappe.db.get_value(
        "Queue Counter",
        {"assigned_user": user, "is_active": 1},
        ["name", "counter_name", "room"],
        as_dict=True
    )
    room = get_current_user_room()
    room_queue = []
    if room:
        room_queue = frappe.get_all("Queue Entry",
            filters={"room": room, "status": ["in", ["Waiting", "Called", "Serving"]]},
            fields=["name", "token_number", "status", "room", "counter"],
            order_by="enqueued_at asc"
        )
    all_queue = frappe.get_all("Queue Entry",
        filters={"status": ["in", ["Waiting", "Called", "Serving"]]},
        fields=["name", "token_number", "status", "room", "counter"],
        order_by="enqueued_at asc"
    )
    return {
        "user": user,
        "roles": roles,
        "counter_assigned": counter or "NO COUNTER ASSIGNED",
        "room_from_counter": room or "NO ROOM FOUND",
        "entries_in_my_room": room_queue,
        "all_entries_in_system": all_queue,
    }


# ---------------------------------------------------------------------------
# SESSION / DEFAULT ROUTE
# ---------------------------------------------------------------------------

# NOTE: No @frappe.whitelist() — this is a hook, not an API endpoint
def set_default_route(**kwargs):
    """
    Called on session creation via hooks.py:
        on_session_creation = "hqs.hqs.api.set_default_route"
    """
    user = frappe.session.user

    if not user or user == "Guest":
        return

    RECEPTION_ROLES = {
        "Receptionist",
        "Nursing User",
        "Laboratory User",
        "Pharmacy",
        "Doctor",
        "Radiology",
    }

    user_roles = set(frappe.get_roles(user))

    if user_roles & RECEPTION_ROLES:
        frappe.response["home_page"] = "/desk/reception-desks"

        
def print_receipt(visit):
    """Print a full receipt-style ticket on the configured network thermal printer.
    Fails silently (logs error) so a printer issue never blocks check-in."""
    settings = frappe.get_single("QMS Setting")

    if not settings.enable_printing:
        return

    if not settings.printer_ip_address:
        frappe.log_error("QMS Printing", "enable_printing is on but no printer_ip_address set")
        return

    try:
        from escpos.printer import Network

        printer = Network(settings.printer_ip_address, timeout=5)

        if settings.logo:
            try:
                logo_path = get_site_path("public", settings.logo.lstrip("/"))
                printer.image(logo_path)
            except Exception:
                frappe.log_error("QMS Printing", frappe.get_traceback())

        printer.set(align="center", bold=True, width=2, height=2)
        printer.text(f"{settings.organization_name or ''}\n")

        printer.set(align="center", bold=False, width=1, height=1)
        if settings.receipt_header:
            printer.text(f"{settings.receipt_header}\n")
        printer.text("-" * 32 + "\n")

        printer.set(align="center", bold=True, width=3, height=3)
        printer.text(f"{visit.get('token')}\n")

        printer.set(align="center", bold=False, width=1, height=1)
        printer.text("-" * 32 + "\n")
        printer.set(align="left")
        printer.text(f"Name: {visit.get('full_name', '')}\n")
        printer.text(f"Time: {frappe.utils.now_datetime().strftime('%Y-%m-%d %H:%M')}\n")

        if settings.receipt_footer:
            printer.set(align="center")
            printer.text("-" * 32 + "\n")
            printer.text(f"{settings.receipt_footer}\n")

        printer.cut()
        printer.close()

    except Exception:
        frappe.log_error("QMS Printing", frappe.get_traceback())


# ---------------------------------------------------------------------------
# ROOM OCCUPANCY DISPLAY
# ---------------------------------------------------------------------------

@frappe.whitelist(allow_guest=True)
def get_room_occupancy():
    """Returns waiting/serving counts per active counter, for the public display screen."""
    counters = frappe.get_all("Queue Counter",
        filters={"is_active": 1},
        fields=["name", "counter_name", "room"],
        order_by="room asc, display_order asc"
    )

    result = []
    for c in counters:
        if not c.room:
            continue
        waiting = frappe.db.count("Queue Entry", {"room": c.room, "status": "Waiting"})
        serving = frappe.db.count("Queue Entry", {"room": c.room, "status": ["in", ["Called", "Serving"]]})
        result.append({
            "counter": c.counter_name or c.name,
            "room": c.room,
            "waiting": waiting,
            "serving": serving
        })

    return result
