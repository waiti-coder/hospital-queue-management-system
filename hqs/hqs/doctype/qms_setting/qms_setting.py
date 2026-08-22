# Copyright (c) 2026, ed/mwihaki and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class QMSSetting(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		display_title: DF.Data | None
		enable_printing: DF.Check
		enable_sound: DF.Check
		kiosk_title: DF.Data | None
		logo: DF.AttachImage | None
		no_show_timeout: DF.Int
		organization_name: DF.Data | None
		printer_ip_address: DF.Data | None
		receipt_footer: DF.Data | None
		receipt_header: DF.Data | None
		token_prefix: DF.Data | None
		token_reset_time: DF.Time | None
	# end: auto-generated types

	_DOCTYPE_NAME = "QMS Setting"
