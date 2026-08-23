// Copyright (c) 2026, ed/mwihaki and contributors
// For license information, please see license.txt

frappe.ui.form.on("Queue Entry", {
    refresh: function(frm) {
        frm.clear_custom_buttons();

        // Lock room field for non-managers
        if (!frappe.user.has_role('System Manager')) {
            frm.set_df_property('room', 'read_only', 1);
        }

        // ── CALL PATIENT ── show when Waiting
        if (frm.doc.status === 'Waiting') {
            frm.add_custom_button(__('Call Patient'), function() {
                frappe.call({
                    method: 'hqs.hqs.api.get_my_counter',
                    callback: function(r) {
                    const counter = r.message?.name;
                    if (!counter) {
                        frappe.msgprint({
                            title: __('No Counter Found'),
                            message: __('You are not assigned to an active counter. Contact your administrator.'),
                            indicator: 'red'
                        });
                        return;
                    }

                    frappe.call({
                        method: 'hqs.hqs.api.call_next_patient',
                        args: {
                            room: frm.doc.room,
                            counter: counter,
                            queue_entry: frm.doc.name
                        },
                        callback: function(r) {
                            if (r.message && r.message.success) {
                                frappe.show_alert({
                                    message: __('Called ') + r.message.token,
                                    indicator: 'green'
                                });
                                frm.reload_doc();
                            } else {
                                frappe.show_alert({
                                    message: r.message?.message || __('Error'),
                                    indicator: 'red'
                                });
                            }
                        }
                    });
                    }
                });
            }).addClass('btn-primary');
        }

        // ── SEND TO NEXT ROOM ── show when Called or Serving
        if (frm.doc.status === 'Called' || frm.doc.status === 'Serving') {

            frm.add_custom_button(__('Send to Next Room'), function() {
                // Fetch allowed next rooms for this room from QMS Room Routing
                frappe.call({
                    method: 'hqs.hqs.api.get_allowed_next_rooms',
                    args: { room: frm.doc.room },
                    callback: function(r) {
                        if (!r.message || r.message.length === 0) {
                            frappe.msgprint({
                                title: __('Final Stop'),
                                message: __('This room has no further routing. Use Mark Done instead.'),
                                indicator: 'blue'
                            });
                            return;
                        }

                        const room_options = r.message.map(row => row.next_room);

                        const d = new frappe.ui.Dialog({
                            title: __('Send Patient to Next Room'),
                            fields: [
                                {
                                    fieldtype: 'HTML',
                                    options: `
                                        <div style="background:#f0f4ff;border-radius:8px;padding:12px 16px;margin-bottom:12px;border-left:4px solid #2B5BA8;">
                                            <div style="font-size:0.75rem;color:#999;text-transform:uppercase;letter-spacing:1px;">Patient</div>
                                            <div style="font-size:1.4rem;font-weight:800;color:#2B5BA8;">${frm.doc.token_number}</div>
                                            <div style="font-size:0.9rem;color:#555;margin-top:4px;">Currently in: <b>${frm.doc.room}</b></div>
                                        </div>
                                    `
                                },
                                {
                                    fieldtype: 'Select',
                                    fieldname: 'next_room',
                                    label: 'Send to Room',
                                    options: room_options,
                                    reqd: 1
                                },
                                {
                                    fieldtype: 'Check',
                                    fieldname: 'is_return',
                                    label: 'This is a return visit (send to front of queue)',
                                    default: 0
                                },
                                {
                                    fieldtype: 'Small Text',
                                    fieldname: 'notes',
                                    label: 'Clinical Notes (optional)'
                                }
                            ],
                            primary_action_label: __('Send Patient'),
                            primary_action: function(values) {
                                frappe.call({
                                    method: 'hqs.hqs.api.send_to_next_room',
                                    args: {
                                        queue_entry: frm.doc.name,
                                        next_room: values.next_room,
                                        notes: values.notes || '',
                                        is_return: values.is_return ? 1 : 0
                                    },
                                    callback: function(res) {
                                        if (res.message && res.message.success) {
                                            frappe.show_alert({
                                                message: __('Patient sent to ') + values.next_room,
                                                indicator: 'green'
                                            }, 4);
                                            d.hide();

                                            // Auto-call next patient in this room
                                            frappe.call({
                                                method: 'hqs.hqs.api.get_my_counter',
                                                callback: function(rc) {
                                                const counter = rc.message?.name;
                                                if (!counter) {
                                                    frappe.set_route('List', 'Queue Entry');
                                                    return;
                                                }
                                                frappe.call({
                                                    method: 'hqs.hqs.api.call_next_patient',
                                                    args: { room: frm.doc.room, counter: counter },
                                                    callback: function(r2) {
                                                        if (r2.message && r2.message.success) {
                                                            frappe.show_alert({
                                                                message: __('Now calling: ') + r2.message.token,
                                                                indicator: 'blue'
                                                            }, 4);
                                                            frappe.set_route('Form', 'Queue Entry', r2.message.queue_entry);
                                                        } else {
                                                            frappe.show_alert({
                                                                message: __('No more patients waiting'),
                                                                indicator: 'orange'
                                                            }, 4);
                                                            frappe.set_route('List', 'Queue Entry');
                                                        }
                                                    }
                                                });
                                                }
                                            });

                                        } else {
                                            frappe.show_alert({
                                                message: res.message?.message || __('Error sending patient'),
                                                indicator: 'red'
                                            });
                                        }
                                    }
                                });
                            }
                        });
                        d.show();
                    }
                });
            }).addClass('btn-success');

            // ── MARK DONE (no further rooms) ──
            frm.add_custom_button(__('Mark Done'), function() {
                frappe.confirm(
                    __('Mark <b>') + frm.doc.token_number + __('</b> as Done with no further rooms?'),
                    function() {
                        frappe.call({
                            method: 'hqs.hqs.api.send_to_next_room',
                            args: {
                                queue_entry: frm.doc.name,
                                next_room: '',
                                notes: ''
                            },
                            callback: function(r) {
                                if (r.message && r.message.success) {
                                    frappe.show_alert({
                                        message: __('Patient marked Done'),
                                        indicator: 'green'
                                    }, 4);
                                    frappe.set_route('List', 'Queue Entry');
                                }
                            }
                        });
                    }
                );
            }).addClass('btn-default');
        }

        // ── NO SHOW ── show when Called
        if (frm.doc.status === 'Called') {
            frm.add_custom_button(__('No Show'), function() {
                frappe.confirm(
                    __('Mark ') + frm.doc.token_number + __(' as No Show?'),
                    function() {
                        frappe.db.set_value('Queue Entry', frm.doc.name, 'status', 'No Show')
                            .then(() => {
                                frappe.show_alert({
                                    message: __('Marked as No Show'),
                                    indicator: 'orange'
                                });
                                frm.reload_doc();
                            });
                    }
                );
            }).addClass('btn-danger');
        }
    }
});


// ── LIST VIEW ──
frappe.listview_settings['Queue Entry'] = {
    onload: function(listview) {
        if (listview.call_next_added) return;
        listview.call_next_added = true;

        // Get this user's room and counter first
        frappe.call({
            method: 'hqs.hqs.api.get_my_counter',
            callback: function(r) {
                const myCounter = r.message?.name;
                const myRoom = r.message?.room;

                if (!myRoom || !myCounter) {
                    // System Manager fallback — show button but prompt for room
                    if (frappe.user.has_role('System Manager')) {
                        listview.page.add_primary_button(__('Call Next'), function() {
                            frappe.prompt({
                                fieldtype: 'Link',
                                fieldname: 'room',
                                label: 'Room',
                                options: 'QMS Room',
                                reqd: 1
                            }, function(vals) {
                                _doCallNext(vals.room, null, listview);
                            }, 'Select Room', 'Call Next');
                        });
                    }
                    return;
                }

                listview.page.add_primary_button(__('Call Next'), function() {
                    _doCallNext(myRoom, myCounter, listview);
                });
            }
        });
    },

    get_indicator: function(doc) {
        const indicators = {
            'Waiting': [__('Waiting'), 'orange', 'status,=,Waiting'],
            'Called':  [__('Called'),  'blue',   'status,=,Called'],
            'Serving': [__('Serving'), 'green',  'status,=,Serving'],
            'Done':    [__('Done'),    'grey',   'status,=,Done'],
            'No Show': [__('No Show'), 'red',    'status,=,No Show'],
        };
        return indicators[doc.status];
    }
};


// ── HELPER: show peek dialog then call ──
function _doCallNext(room, counter, listview) {
    frappe.call({
        method: 'hqs.hqs.api.peek_next_patient',
        args: { room: room },
        callback: function(r) {
            if (!r.message || !r.message.success) {
                frappe.msgprint({
                    title: __('Queue Empty'),
                    message: __('No patients waiting in ') + room,
                    indicator: 'blue'
                });
                return;
            }

            const next = r.message;
            const priority_color = {
                'Emergency': '<span style="color:red;font-weight:700;">🚨 Emergency</span>',
                'Urgent':    '<span style="color:orange;font-weight:700;">⚠️ Urgent</span>',
                'Normal':    '<span style="color:green;font-weight:700;">✔ Normal</span>',
            }[next.priority] || next.priority;

            const dialog = new frappe.ui.Dialog({
                title: __('Call Next Patient'),
                fields: [
                    {
                        fieldtype: 'HTML',
                        options: `
                            <div style="background:#f0f4ff;border-radius:10px;padding:16px 20px;margin-bottom:16px;border-left:4px solid #2B5BA8;">
                                <div style="font-size:0.75rem;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Next in Queue — ${room}</div>
                                <div style="font-size:2.2rem;font-weight:900;color:#2B5BA8;line-height:1;">${next.token_number}</div>
                                <div style="margin-top:8px;font-size:0.95rem;color:#555;line-height:1.8;">
                                    Patient: <b>${next.patient || '—'}</b><br>
                                    Priority: ${priority_color}<br>
                                    Waiting: <b>${next.waiting_since}</b>
                                </div>
                            </div>
                        `
                    }
                ],
                primary_action_label: __('Call Patient'),
                primary_action: function() {
                    dialog.hide();

                    // If no counter passed (System Manager), fetch one
                    if (!counter) {
                        frappe.db.get_value('Queue Counter',
                            { room: room, is_active: 1 }, 'name'
                        ).then(rc => {
                            _callPatient(room, rc.message?.name, null, listview);
                        });
                    } else {
                        _callPatient(room, counter, null, listview);
                    }
                }
            });
            dialog.show();
        }
    });
}


function _callPatient(room, counter, queue_entry, listview) {
    if (!counter) {
        frappe.show_alert({
            message: __('No active counter found for ') + room,
            indicator: 'red'
        }, 4);
        return;
    }

    frappe.call({
        method: 'hqs.hqs.api.call_next_patient',
        args: { room: room, counter: counter, queue_entry: queue_entry || null },
        callback: function(r) {
            if (r.message && r.message.success) {
                frappe.show_alert({
                    message: __('Calling Token ') + r.message.token,
                    indicator: 'green'
                }, 4);
                frappe.set_route('Form', 'Queue Entry', r.message.queue_entry);
            } else {
                frappe.show_alert({
                    message: r.message?.message || __('No patients waiting'),
                    indicator: 'orange'
                }, 4);
                if (listview) listview.refresh();
            }
        }
    });
}