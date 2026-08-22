frappe.pages['reception-desks'].on_page_load = function(wrapper) {
  var page = frappe.ui.make_app_page({
    parent: wrapper,
    title: 'Reception Desk',
    single_column: true
  });

  frappe.require([
    '/assets/hqs/css/reception_desks.css'
  ], function() {
    $(wrapper).find('.page-content').html(
      frappe.render_template('reception_desks', {})
    );
    reception_desk.init(wrapper);
  });
};

var reception_desk = {
  department: 'Reception',

  init: function(wrapper) {
    this.wrapper = wrapper;
    $('#rp-user').text(frappe.session.user);
    frappe.call({
      method: 'hqs.hqs.api.get_my_counter',
      callback: (r) => {
        this.my_counter = r.message?.name || null;
        this.my_room = r.message?.room || null;
        this.bind_nav_cards();
      }
    });
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 15000);
  },

  refresh: function() {
    frappe.call({
      method: 'hqs.hqs.api.get_department_stats',
      args: { department: this.department },
      callback: (r) => {
        if (r.message) this.render(r.message);
      }
    });
  },

  render: function(data) {
    $('#count-waiting').text(data.waiting);
    $('#count-serving').text(data.serving);
    $('#count-done').text(data.done);
    $('#nav-count-waiting').text(data.waiting);
    $('#nav-count-called').text(data.called);

    if (data.now_serving) {
      $('#ns-token').text(data.now_serving.token_number);
      $('#ns-name').text(data.now_serving.patient_name || '');
      $('#ns-counter').text(data.now_serving.room || '');
      $('#rp-now-serving').show();
    } else {
      $('#rp-now-serving').hide();
    }

    this.render_chart(data.hourly);
  },

  render_chart: function(hourly) {
    var bars = $('#rp-bars').empty();
    if (!hourly || !hourly.length) return;
    var max = Math.max(...hourly.map(h => h.count), 1);
    hourly.forEach(function(h) {
      var pct = Math.round((h.count / max) * 72);
      var isPeak = h.count === max;
      bars.append(`
        <div class="rp-bar-col">
          <div class="rp-bar${isPeak ? ' peak' : ''}" style="height:${pct}px"></div>
          <div class="rp-bar-lbl">${h.count || ''}</div>
        </div>
      `);
    });
  },

  bind_nav_cards: function() {
    var dept = this.department;
    $('#nav-waiting').on('click', () => {
      const filters = { status: 'Waiting' };
      if (this.my_room) filters.room = this.my_room;
      frappe.set_route('List', 'Queue Entry', filters);
    });
    $('#nav-called').on('click', () => {
      const filters = { status: 'Called' };
      if (this.my_counter) filters.counter = this.my_counter;
      frappe.set_route('List', 'Queue Entry', filters);
    });
    $('#nav-new').on('click', function() {
      frappe.new_doc('Queue Entry');
    });
  }
};