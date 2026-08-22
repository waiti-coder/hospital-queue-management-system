app_name = "hqs"
app_title = "hqs"
app_publisher = "ed/mwihaki"
app_description = "hqs"
app_email = "edwinwaititu@gmail.com"
app_license = "mit"

export_python_type_annotations = True
require_type_annotated_api_methods = True

permission_query_conditions = {
    "Queue Entry": "hqs.hqs.doctype.queue_entry.queue_entry.get_permission_query_conditions"
}

fixtures = [
    {
        "doctype": "QMS Room",
        "filters": [["active", "=", 1]]
    },
    {
        "doctype": "QMS Room Routing"
    },
    {
        "doctype": "Role",
        "filters": [["name", "in", [
            "Receptionist",
            "Nursing User",
            "Laboratory User",
            "Doctor",
            "Pharmacy",
            "Radiology"
        ]]]
    }
]

on_session_creation = "hqs.hqs.api.set_default_route"