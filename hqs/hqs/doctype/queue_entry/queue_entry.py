import frappe
from frappe.model.document import Document


class QueueEntry(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        called_at: DF.Datetime | None
        care_pathway: DF.Link | None
        counter: DF.Link | None
        current_step: DF.Int
        enqueued_at: DF.Datetime | None
        is_return: DF.Check
        name: DF.Int | None
        next_room: DF.Link | None
        note: DF.SmallText | None
        patient: DF.Link
        phone_numberid: DF.Data | None
        previous_room: DF.Link | None
        priority: DF.Literal["Normal", "Urgent", "Emergency"]
        room: DF.Link
        served_at: DF.Datetime | None
        status: DF.Literal["Waiting", "Called", "Serving", "Done", "No Show"]
        token_number: DF.Data | None
    # end: auto-generated types

    def before_insert(self):
        self.enqueued_at = frappe.utils.now()
        if not self.token_number:
            self.token_number = self._generate_token()

    def _generate_token(self) -> str:
        today = frappe.utils.today()

        # Pull prefix from QMS Setting
        prefix = frappe.db.get_single_value("QMS Setting", "token_prefix") or "T"

        # Count DISTINCT tokens issued today, not raw rows — a room transfer
        # creates a new Queue Entry row but reuses the same token_number,
        # so counting rows would burn a number for every transfer and cause
        # visible gaps in the sequence (e.g. HQ-001 then HQ-003, HQ-002 never seen).
        result = frappe.db.sql("""
            SELECT COUNT(DISTINCT token_number)
            FROM `tabQueue Entry`
            WHERE creation >= %s
        """, (today,))
        count = result[0][0] if result and result[0][0] else 0
        return f"{prefix}-{str(count + 1).zfill(3)}"

    def on_update(self):
        pass  # Routing is now handled manually by clerk via send_to_next_room


# ---------------------------------------------------------------------------
# PERMISSION QUERY — controls what each user sees in Queue Entry list/form
# ---------------------------------------------------------------------------

def get_permission_query_conditions(user):
    """
    This function runs automatically every time anyone opens
    the Queue Entry list or form. It silently adds a WHERE
    clause to the database query so users only see their room.

    The logic is simple:
        1. System Manager  → sees everything
        2. Everyone else   → find their Queue Counter → get the room → filter by that room
        3. No counter found → sees nothing
    """
    if not user:
        user = frappe.session.user

    # System Manager sees everything — no filter applied
    if "System Manager" in frappe.get_roles(user):
        return ""

    # Find which counter this user is assigned to
    # and get the room linked to that counter
    room = frappe.db.get_value(
        "Queue Counter",
        {"assigned_user": user, "is_active": 1},
        "room"
    )

    if room:
        # Only show Queue Entries that belong to this room
        return f'`tabQueue Entry`.`room` = "{room}"'

    # User has no counter assigned — show nothing
    return "1=0"