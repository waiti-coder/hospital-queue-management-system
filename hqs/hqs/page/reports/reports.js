frappe.pages["reports"].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: "HQS Reports",
        single_column: true,
    });
    const report = new HQSReports(page);
    report.init();
};

class HQSReports {
    constructor(page) {
        this.page = page;
        this.raw_legs = [];
        this.patients = [];
        this.filters = {
            from_date: frappe.datetime.get_today(),
            to_date: frappe.datetime.get_today(),
            room: "Reception",
            status: "",
        };
        this.auto_refresh_timer = null;
    }

    init() {
        this.inject_html();
        this.setup_page_actions();
        this.load_rooms();
        this.load_data();
        this.maybe_start_auto_refresh();
    }

    setup_page_actions() {
        this.page.set_primary_action("Refresh", () => this.load_data(), "refresh");
        this.page.add_menu_item("Export CSV", () => this.export_csv());
    }

    is_today_range() {
        return this.filters.from_date === frappe.datetime.get_today()
            && this.filters.to_date === frappe.datetime.get_today();
    }

    maybe_start_auto_refresh() {
        if (this.auto_refresh_timer) clearInterval(this.auto_refresh_timer);
        this.auto_refresh_timer = setInterval(() => {
            if (this.is_today_range()) this.load_data(true);
        }, 30000);
    }

    inject_html() {
        $(this.page.main).html(`
            <div class="hqs-reports-page">

                <div class="hqs-card hqs-top-filter-card">
                    <div class="hqs-table-filters">
                        <div class="hqs-fg">
                            <label>From Date</label>
                            <input type="date" id="tf-from-date" value="${this.filters.from_date}">
                        </div>
                        <div class="hqs-fg">
                            <label>To Date</label>
                            <input type="date" id="tf-to-date" value="${this.filters.to_date}">
                        </div>
                        <div class="hqs-fg">
                            <label>Location</label>
                            <select id="tf-room"><option value="">All Locations</option></select>
                        </div>
                        <div class="hqs-fg">
                            <label>Status</label>
                            <select id="tf-status">
                                <option value="">All</option>
                                <option>Waiting</option>
                                <option>Called</option>
                                <option>Serving</option>
                                <option>Done</option>
                                <option>No Show</option>
                            </select>
                        </div>
                        <div class="hqs-fg hqs-filter-btns">
                            <label>&nbsp;</label>
                            <div style="display:flex;gap:6px">
                                <button class="hqs-btn-apply" id="tf-apply"><i class="fa fa-filter"></i> Apply</button>
                                <button class="hqs-btn-clear" id="tf-today">Today</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="hqs-kpi-row">
                    <div class="hqs-kpi-card" data-kpi="total">
                        <div class="hqs-kpi-icon hqs-icon-blue"><i class="fa fa-users"></i></div>
                        <div><div class="hqs-kpi-value">-</div><div class="hqs-kpi-label" id="hqs-total-label">Patients Seen</div></div>
                    </div>
                    <div class="hqs-kpi-card" data-kpi="avg-time">
                        <div class="hqs-kpi-icon hqs-icon-teal"><i class="fa fa-hourglass-half"></i></div>
                        <div><div class="hqs-kpi-value">-</div><div class="hqs-kpi-label">Avg Turnaround</div></div>
                    </div>
                    <div class="hqs-kpi-card" data-kpi="urgent">
                        <div class="hqs-kpi-icon hqs-icon-amber"><i class="fa fa-exclamation-circle"></i></div>
                        <div><div class="hqs-kpi-value">-</div><div class="hqs-kpi-label">Urgent Cases</div></div>
                    </div>
                    <div class="hqs-kpi-card" data-kpi="emergency">
                        <div class="hqs-kpi-icon hqs-icon-red"><i class="fa fa-ambulance"></i></div>
                        <div><div class="hqs-kpi-value">-</div><div class="hqs-kpi-label">Emergency Cases</div></div>
                    </div>
                </div>

                <div class="hqs-charts-row">
                    <div class="hqs-card">
                        <div class="hqs-card-header"><span>Patients by Department</span>
                            <span style="font-size:11px;color:#6db8f7;font-weight:400">all patients, by % share</span>
                        </div>
                        <div id="hqs-dept-pie" style="min-height:260px;display:flex;align-items:center;justify-content:center;"></div>
                    </div>
                    <div class="hqs-card">
                        <div class="hqs-card-header"><span>Average Turnaround per Department (min)</span></div>
                        <div id="hqs-time-chart" style="min-height:260px;"></div>
                    </div>
                </div>

                <div class="hqs-card">
                    <div class="hqs-card-header">
                        <span>Patients Seen</span>
                        <span class="hqs-record-count" id="hqs-record-count"></span>
                    </div>
                    <div id="hqs-datatable" class="hqs-datatable-wrap"></div>
                </div>

                <div id="hqs-loading" class="hqs-loading-overlay" style="display:none;">
                    <div class="hqs-spinner"></div><span>Loading...</span>
                </div>
            </div>
        `);

        this.inject_styles();
        document.getElementById("tf-apply").addEventListener("click", () => this.apply_filters());
        document.getElementById("tf-today").addEventListener("click", () => this.reset_to_today());
    }

    load_rooms() {
        frappe.call({
            method: "frappe.client.get_list",
            args: { doctype: "QMS Room", fields: ["name"], limit: 100, order_by: "name asc" },
            callback: (r) => {
                if (!r.message) return;
                const opts = r.message.map(row => `<option value="${row.name}">${row.name}</option>`).join("");
                const el = document.getElementById("tf-room");
                if (el) {
                    el.innerHTML = `<option value="">All Locations</option>${opts}`;
                    el.value = this.filters.room || "";
                }
            },
        });
    }

    read_filters() {
        this.filters.from_date = document.getElementById("tf-from-date")?.value || frappe.datetime.get_today();
        this.filters.to_date   = document.getElementById("tf-to-date")?.value   || frappe.datetime.get_today();
        this.filters.room      = document.getElementById("tf-room")?.value     || "";
        this.filters.status    = document.getElementById("tf-status")?.value   || "";
    }

    apply_filters() {
        this.read_filters();
        this.load_data();
        this.maybe_start_auto_refresh();
    }

    reset_to_today() {
        const t = frappe.datetime.get_today();
        document.getElementById("tf-from-date").value = t;
        document.getElementById("tf-to-date").value = t;
        document.getElementById("tf-room").value = "Reception";
        document.getElementById("tf-status").value = "";
        this.filters = { from_date: t, to_date: t, room: "Reception", status: "" };
        this.load_data();
        this.maybe_start_auto_refresh();
    }

    load_data(silent) {
        if (!silent) this.show_loading(true);
        const f = this.filters;
        frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Queue Entry",
                filters: [
                    ["enqueued_at", ">=", f.from_date + " 00:00:00"],
                    ["enqueued_at", "<=", f.to_date + " 23:59:59"],
                ],
                fields: ["name","token_number","patient","room","previous_room",
                    "status","priority","enqueued_at","called_at","served_at","counter"],
                limit: 5000,
                order_by: "enqueued_at asc",
            },
            callback: (r) => {
                this.show_loading(false);
                this.raw_legs = r.message || [];
                this.patients = this.group_by_patient(this.raw_legs);
                this.render_all();
            },
            error: () => {
                this.show_loading(false);
                if (!silent) frappe.msgprint({ title: "Error", message: "Could not load report data.", indicator: "red" });
            },
        });
    }

    render_all() {
        const f = this.filters;
        const any_extra_filter = !!((f.room && f.room !== "Reception") || f.status);

        const status_scoped_patients = this.patients.filter(p => !f.status || p.status === f.status);
        const status_scoped_legs = this.raw_legs.filter(l => !f.status || l.status === f.status);

        const fully_filtered = this.filter_patients(this.patients);

        this.render_kpis(fully_filtered);
        $("#hqs-total-label").text(any_extra_filter ? "Filtered Patients" : "Patients Seen");
        this.render_dept_pie(status_scoped_patients);
        this.render_time_chart(status_scoped_legs);
        this.render_table(fully_filtered);
    }

    group_by_patient(legs) {
        const by_patient = {};
        legs.forEach(leg => {
            const key = leg.patient || leg.token_number || leg.name;
            if (!by_patient[key]) by_patient[key] = [];
            by_patient[key].push(leg);
        });

        const priority_rank = { Emergency: 3, Urgent: 2, Normal: 1 };

        return Object.entries(by_patient).map(([key, legs]) => {
            legs.sort((a, b) => new Date(a.enqueued_at) - new Date(b.enqueued_at));
            const first = legs[0];
            const last = legs[legs.length - 1];
            const worst_priority = legs.reduce((acc, l) => {
                return (priority_rank[l.priority] || 0) > (priority_rank[acc] || 0) ? l.priority : acc;
            }, "Normal");

            let turnaround = null;
            if (last.status === "Done" && last.served_at) {
                const mins = Math.round((new Date(last.served_at) - new Date(first.enqueued_at)) / 60000);
                if (mins >= 0 && mins < 1440) turnaround = mins;
            }

            return {
                patient: key,
                token_number: first.token_number,
                location: last.room || "-",
                status: last.status,
                priority: worst_priority,
                first_arrived: first.enqueued_at,
                turnaround,
            };
        });
    }

    filter_patients(patients) {
        const f = this.filters;
        return patients.filter(p => {
            if (f.room && p.location !== f.room) return false;
            if (f.status && p.status !== f.status) return false;
            return true;
        });
    }

    render_kpis(patients) {
        const total = patients.length;
        const urgent = patients.filter(p => p.priority === "Urgent").length;
        const emergency = patients.filter(p => p.priority === "Emergency").length;
        const done_times = patients.filter(p => p.turnaround !== null).map(p => p.turnaround);
        const avg = done_times.length ? Math.round(done_times.reduce((a, b) => a + b, 0) / done_times.length) : null;

        this.set_kpi("total", total.toLocaleString());
        this.set_kpi("avg-time", avg !== null ? avg + " min" : "N/A");
        this.set_kpi("urgent", urgent.toLocaleString());
        this.set_kpi("emergency", emergency.toLocaleString());
    }

    set_kpi(key, value) {
        $(`.hqs-kpi-card[data-kpi="${key}"] .hqs-kpi-value`).text(value);
    }

    render_dept_pie(patients) {
        const el = document.getElementById("hqs-dept-pie");
        if (!el) return;
        const by_room = {};
        patients.forEach(p => { const r = p.location || "Unknown"; by_room[r] = (by_room[r] || 0) + 1; });
        const total = patients.length;
        const sorted = Object.entries(by_room).sort((a, b) => b[1] - a[1]);

        if (!sorted.length || !total) {
            el.innerHTML = `<p class="text-muted" style="padding:20px;text-align:center;">No patients in this range yet</p>`;
            return;
        }

        const palette = ["#2490EF","#6db8f7","#f59e0b","#ef4444","#10b981","#8b5cf6","#ec4899","#64748b"];
        const labels = sorted.map(s => {
            const pct = Math.round((s[1] / total) * 100);
            return `${s[0]} - ${pct}% (${s[1]})`;
        });

        try {
            new frappe.Chart(el, {
                type: "pie",
                data: {
                    labels: labels,
                    datasets: [{ values: sorted.map(s => s[1]) }],
                },
                colors: palette,
                height: 260,
            });
        } catch (e) {
            el.innerHTML = `<p class="text-muted" style="padding:20px;text-align:center;">No data</p>`;
        }
    }

    render_time_chart(legs) {
        const room_times = {};
        legs.filter(d => d.enqueued_at && d.served_at).forEach(d => {
            const mins = (new Date(d.served_at) - new Date(d.enqueued_at)) / 60000;
            if (mins <= 0 || mins > 600) return;
            const r = d.room || "Unknown";
            if (!room_times[r]) room_times[r] = [];
            room_times[r].push(mins);
        });
        const sorted = Object.entries(room_times)
            .map(([r, t]) => [r, Math.round(t.reduce((a, b) => a + b, 0) / t.length)])
            .sort((a, b) => b[1] - a[1]);

        const el = document.getElementById("hqs-time-chart");
        if (!sorted.length) {
            if (el) el.innerHTML = `<p class="text-muted" style="padding:20px;text-align:center;">No completed visits in this range yet</p>`;
            return;
        }
        try {
            new frappe.Chart(el, {
                type: "bar",
                data: { labels: sorted.map(s => s[0]), datasets: [{ name: "Avg min", values: sorted.map(s => s[1]) }] },
                colors: ["#2490EF"], height: 260,
            });
        } catch (e) {
            el.innerHTML = `<p class="text-muted" style="padding:20px;text-align:center;">No data</p>`;
        }
    }

    render_table(patients) {
        $("#hqs-record-count").text(`${patients.length.toLocaleString()} patients`);
        const columns = [
            { name: "Token",       id: "token_number", width: 90  },
            { name: "Patient",     id: "patient",      width: 150 },
            { name: "Location",    id: "location",     width: 130 },
            { name: "Status",      id: "status",       width: 100 },
            { name: "Priority",    id: "priority",     width: 100 },
            { name: "Arrived",     id: "first_arrived",width: 140 },
            { name: "Turnaround",  id: "turnaround",   width: 100 },
        ];
        const rows = patients.map(p => ({
            token_number: p.token_number || "-",
            patient: p.patient || "-",
            location: p.location,
            status: this.status_badge(p.status),
            priority: this.priority_badge(p.priority),
            first_arrived: p.first_arrived ? p.first_arrived.slice(0, 16) : "-",
            turnaround: p.turnaround !== null ? p.turnaround + " min" : "In progress",
        }));

        const wrap = document.getElementById("hqs-datatable");
        wrap.innerHTML = "";
        if (!rows.length) {
            wrap.innerHTML = `<p class="text-muted" style="padding:24px;text-align:center;">No patients found for the selected filters.</p>`;
            return;
        }
        try {
            this.datatable = new DataTable(wrap, { columns, data: rows, layout: "fluid", serialNoColumn: true });
        } catch (e) {
            wrap.innerHTML = this.build_html_table(columns, rows);
        }
    }

    build_html_table(columns, rows) {
        const h = columns.map(c => `<th>${c.name}</th>`).join("");
        const b = rows.map((r, i) =>
            `<tr><td>${i+1}</td>${columns.map(c => `<td>${r[c.id]}</td>`).join("")}</tr>`
        ).join("");
        return `<div style="overflow-x:auto;"><table class="hqs-table">
            <thead><tr><th>#</th>${h}</tr></thead><tbody>${b}</tbody></table></div>`;
    }

    status_badge(s) {
        const c = { Done:"#2490EF", Serving:"#6db8f7", Called:"#a8d8f8", Waiting:"#b8dcfb", "No Show":"#94a3b8" };
        const col = c[s] || "#94a3b8";
        return `<span style="background:${col}22;color:${col};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">${s||"-"}</span>`;
    }

    priority_badge(p) {
        const c = { Normal:"#2490EF", Urgent:"#f59e0b", Emergency:"#ef4444" };
        const col = c[p] || "#2490EF";
        return `<span style="background:${col}22;color:${col};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">${p||"-"}</span>`;
    }

    export_csv() {
        const patients = this.filter_patients(this.patients);
        if (!patients.length) { frappe.msgprint("No data to export."); return; }
        const fields = ["token_number","patient","location","status","priority","first_arrived","turnaround"];
        const header = fields.join(",");
        const rows = patients.map(p =>
            fields.map(f => `"${(p[f] ?? "").toString().replace(/"/g,'""')}"`).join(",")
        ).join("\n");
        const blob = new Blob([header+"\n"+rows], { type:"text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `hqs_patients_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    show_loading(show) { $("#hqs-loading").toggle(show); }

    inject_styles() {
        if (document.getElementById("hqs-reports-style")) return;
        const s = document.createElement("style");
        s.id = "hqs-reports-style";
        s.textContent = `
        .hqs-reports-page{padding:16px;position:relative;font-family:var(--font-stack)}
        .hqs-top-filter-card{margin-bottom:18px;}
        .hqs-kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:18px}
        .hqs-kpi-card{border-radius:12px;padding:18px 20px;display:flex;align-items:center;gap:14px;
            background:#fff;border:1.5px solid #e2eefc;box-shadow:0 1px 3px rgba(20,60,110,.06);
            transition:transform .15s ease, box-shadow .15s ease}
        .hqs-kpi-card:hover{transform:translateY(-3px);box-shadow:0 8px 20px rgba(36,144,239,.16)}
        .hqs-kpi-icon{width:42px;height:42px;border-radius:12px;font-size:20px;
            display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .hqs-icon-blue{background:#e8f4fd;color:#2490EF}
        .hqs-icon-teal{background:#e6faf6;color:#0d9488}
        .hqs-icon-amber{background:#fef3e0;color:#f59e0b}
        .hqs-icon-red{background:#fde8e8;color:#ef4444}
        .hqs-kpi-value{font-size:27px;font-weight:800;color:#1a5fa8;line-height:1.1}
        .hqs-kpi-label{font-size:11.5px;color:#6db8f7;margin-top:3px;text-transform:uppercase;letter-spacing:.05em;font-weight:600}
        .hqs-card{background:#fff;border-radius:12px;border:1px solid #e2eefc;overflow:hidden;margin-bottom:16px;
            box-shadow:0 1px 3px rgba(20,60,110,.05)}
        .hqs-card-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px 10px;
            font-weight:700;font-size:13px;color:#1a5fa8;border-bottom:1px solid #e8f4fd;background:#f7fbff}
        .hqs-record-count{font-size:12px;font-weight:500;color:#6db8f7}
        .hqs-charts-row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:0}
        .hqs-charts-row .hqs-card{margin-bottom:16px}
        @media(max-width:768px){.hqs-charts-row{grid-template-columns:1fr}}
        .hqs-table-filters{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px;
            padding:14px 18px;background:#f7fbff;}
        .hqs-fg{display:flex;flex-direction:column;gap:3px;min-width:100px}
        .hqs-fg label{font-size:10px;font-weight:700;color:#2490EF;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
        .hqs-fg input,.hqs-fg select{height:28px;padding:0 7px;border:1px solid #b8dcfb;
            border-radius:6px;font-size:12px;color:#1a5fa8;background:#fff;outline:none;width:100%}
        .hqs-fg input:focus,.hqs-fg select:focus{border-color:#2490EF;box-shadow:0 0 0 2px #2490ef22}
        .hqs-filter-btns label{color:transparent!important}
        .hqs-btn-apply{height:28px;padding:0 12px;background:#2490EF;color:#fff;border:none;
            border-radius:6px;font-size:12px;font-weight:600;cursor:pointer}
        .hqs-btn-apply:hover{background:#1a7fd4}
        .hqs-btn-clear{height:28px;padding:0 10px;background:#fff;color:#2490EF;
            border:1px solid #b8dcfb;border-radius:6px;font-size:12px;cursor:pointer}
        .hqs-btn-clear:hover{background:#f0f8ff}
        .hqs-datatable-wrap{overflow-x:auto}
        .hqs-table{width:100%;border-collapse:collapse;font-size:12.5px}
        .hqs-table th{background:#f0f8ff;padding:9px 12px;text-align:left;font-weight:600;
            color:#2490EF;font-size:11px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;border-bottom:2px solid #b8dcfb}
        .hqs-table td{padding:8px 12px;border-bottom:1px solid #e8f4fd;color:#334155;vertical-align:middle}
        .hqs-table tr:hover td{background:#f5fbff}
        .hqs-loading-overlay{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,.85);
            display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:100;font-size:14px;color:#6db8f7}
        .hqs-spinner{width:36px;height:36px;border:3px solid #b8dcfb;border-top-color:#2490EF;
            border-radius:50%;animation:hqs-spin .7s linear infinite}
        @keyframes hqs-spin{to{transform:rotate(360deg)}}`;
        document.head.appendChild(s);
    }
}