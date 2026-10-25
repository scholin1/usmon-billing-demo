/* The shell: router, scene registry, components, view switch, toasts. Owner: the Insurance Billing
   seat (ask before editing). Scenes register as window.SCENES.<name> = { title, render(root, api) }
   and are chosen by the first segment of location.hash. */
(function () {
  "use strict";
  var D = window.DEMO_DATA, ST = window.STORE;
  window.SCENES = window.SCENES || {};

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function byId(id) { return document.getElementById(id); }
  function fmtDate(iso) { if (!iso) return ""; var p = iso.slice(0, 10).split("-"); return p[1] + "/" + p[2] + "/" + p[0]; }
  function fmtDays(n) { return n === 1 ? "1 day" : n + " days"; }

  // ----------------------------------------------------------------------------------- labels per view
  var LABELS = {
    familiar: { new: "New Insurance Billing", ongoing: "Ongoing Insurance Billing", refile: "Refile", work: "Work denial", file: "File", days: "Days", payments: "Payments", denials: "Denials", idr: "Out-of-network and IDR", assign: "Assignments", inbox: "Inbox", reports: "Reports", settings: "Settings", confirm: "confirm", patient: "Patient", collected: "Collected", balance: "Balance", lastRemit: "Last remit", status: "Status", next: "Next", clock: "Filing clock", readiness: "Readiness", box33: "Box 33", biller: "Biller", payer: "Payer", open: "Open", back: "Back", reset: "Reset demo" },
    classic: { new: "New Insurance Billing", ongoing: "Ongoing Insurance Billing", refile: "Refile Claim", work: "Work Denial", file: "File Claim", days: "Days Aged", payments: "Payment Posting", denials: "Denial Management", idr: "OON / IDR", assign: "Biller Assignments", inbox: "Messages", reports: "Reports", settings: "Setup", confirm: "Confirm", patient: "Patient Name", collected: "Collected", balance: "Claim Balance", lastRemit: "Last Remit Date", status: "Claim Status", next: "Action", clock: "Days To File", readiness: "Checks", box33: "Box 33 Entity", biller: "Biller", payer: "Insurance", open: "Open Claim", back: "Return", reset: "Reset Demo" }
  };
  function label(k) { var v = ST.get().view; return (LABELS[v] && LABELS[v][k]) || LABELS.familiar[k] || k; }

  // ----------------------------------------------------------------------------------- toasts
  function toast(m, kind) {
    var w = byId("toasts"); var t = document.createElement("div"); t.className = "toast" + (kind ? " " + kind : ""); t.textContent = m; w.appendChild(t);
    setTimeout(function () { t.classList.add("show"); }, 10);
    setTimeout(function () { t.classList.remove("show"); setTimeout(function () { if (t.parentNode) w.removeChild(t); }, 300); }, 3600);
  }

  // ----------------------------------------------------------------------------------- components (HTML strings)
  var C = {
    pill: function (text, cls) { return '<span class="pill ' + esc(cls || "") + '">' + esc(text) + '</span>'; },
    statusPill: function (c) { var i = ST.statusInfo(c); var t = i.label; if (c.status === "denied" && c.fin && c.fin.code) t = "Denied " + c.fin.code; return C.pill(t, i.cls); },
    panel: function (title, body, extra) { return '<section class="panel">' + (title ? '<div class="panel-title">' + title + (extra ? '<span class="panel-extra">' + extra + '</span>' : '') + '</div>' : '') + '<div class="panel-body">' + body + '</div></section>'; },
    card: function (title, body) { return '<div class="card">' + (title ? '<h3>' + title + '</h3>' : '') + body + '</div>'; },
    kv: function (pairs) { return '<dl class="kv">' + pairs.map(function (p) { return '<dt>' + esc(p[0]) + '</dt><dd>' + (p[2] ? p[1] : esc(p[1])) + '</dd>'; }).join("") + '</dl>'; },
    tabs: function (items, active) { return '<div class="tabs">' + items.map(function (t) { return '<a class="tab' + (t.key === active ? ' on' : '') + '" href="' + esc(t.href) + '">' + esc(t.label) + (t.count != null ? ' <span class="count">' + t.count + '</span>' : '') + '</a>'; }).join("") + '</div>'; },
    tiles: function (items) { return '<div class="tiles">' + items.map(function (t) { return '<div class="tile' + (t.cls ? ' ' + t.cls : '') + '"' + (t.href ? ' data-href="' + esc(t.href) + '"' : '') + '><div class="n">' + esc(t.n) + '</div><div class="l">' + esc(t.l) + '</div></div>'; }).join("") + '</div>'; },
    clock: function (ck, suffix) { if (!ck) return ''; var t = ck.left < 0 ? Math.abs(ck.left) + " over" : ck.left + (suffix || " left"); return '<span class="clock ' + ck.cls + '">' + esc(t) + '</span>'; },
    confirmChip: function (c) { return c.confirmed ? '<span class="confirmed">confirmed</span>' : '<span class="confirm" data-act="confirm" data-seq="' + c.seq + '" title="Confirm the Box 33 entity the rule chose">' + esc(label("confirm")) + '</span>'; },
    btn: function (text, act, data, cls) { var d = ''; if (data) Object.keys(data).forEach(function (k) { d += ' data-' + k + '="' + esc(data[k]) + '"'; }); return '<button type="button" class="btn ' + (cls || '') + '" data-act="' + esc(act) + '"' + d + '>' + esc(text) + '</button>'; },
    patLink: function (c, sub) { return '<a class="pat" href="#claim/' + c.seq + '"><b>' + esc(c.pat) + '</b></a>' + (c.isNew ? ' <span class="badge-new">new</span>' : '') + (sub ? '<br><span class="sub">' + sub + '</span>' : ''); },
    avatar: function (uid) { var u = ST.user(uid); return '<span class="avatar" title="' + esc(u.name) + '">' + esc(u.initials || "?") + '</span>'; },
    checks: function (c) { return '<ul class="checks">' + c.checks.map(function (x, i) { return '<li class="' + x[1] + '" data-idx="' + i + '"><b>' + esc(x[0]) + '</b><span class="sub">' + esc(x[2]) + '</span></li>'; }).join("") + '</ul>'; },
    grid: function (opts) {
      // opts: {columns:[{key,label,cls,render(row),sort(row)}], rows:[], sort:{key,dir}, id}
      var cols = opts.columns.filter(function (col) { return !opts.hidden || !opts.hidden[col.key]; });
      var rows = opts.rows.slice();
      if (opts.sort && opts.sort.key) { var col = opts.columns.find(function (x) { return x.key === opts.sort.key; }); if (col) { rows.sort(function (a, b) { var va = col.sort ? col.sort(a) : a[col.key], vb = col.sort ? col.sort(b) : b[col.key]; if (va == null) va = ""; if (vb == null) vb = ""; var r = va < vb ? -1 : va > vb ? 1 : 0; return opts.sort.dir === "desc" ? -r : r; }); } }
      var h = '<table class="grid"' + (opts.id ? ' id="' + esc(opts.id) + '"' : '') + '><thead><tr>' + cols.map(function (col) { var on = opts.sort && opts.sort.key === col.key; return '<th class="' + esc(col.cls || '') + (on ? ' sorted ' + opts.sort.dir : '') + '" data-sort="' + esc(col.key) + '">' + esc(col.label) + (on ? '<span class="arrow">' + (opts.sort.dir === "desc" ? "▼" : "▲") + '</span>' : '') + '</th>'; }).join("") + '</tr></thead><tbody>';
      if (!rows.length) h += '<tr><td class="empty" colspan="' + cols.length + '">' + esc(opts.empty || "Nothing here.") + '</td></tr>';
      rows.forEach(function (r) { h += '<tr data-seq="' + esc(r.seq != null ? r.seq : '') + '"' + (opts.rowCls ? ' class="' + esc(opts.rowCls(r)) + '"' : '') + '>' + cols.map(function (col) { return '<td class="' + esc(col.cls || '') + '">' + (col.render ? col.render(r) : esc(r[col.key])) + '</td>'; }).join("") + '</tr>'; });
      return h + '</tbody></table>';
    },
    dialog: function (title, body, buttons) {
      // returns nothing; draws a modal. buttons: [{text, act, cls}] ; the caller handles data-act clicks in #dialog
      var el = byId("dialog"); el.innerHTML = '<div class="dialog" role="dialog"><div class="dialog-title">' + title + '<button type="button" class="x" data-act="dialog-close" aria-label="Close">×</button></div><div class="dialog-body">' + body + '</div><div class="dialog-buttons">' + (buttons || []).map(function (b) { return C.btn(b.text, b.act, b.data, b.cls); }).join("") + '</div></div>';
      el.classList.add("open");
    },
    closeDialog: function () { var el = byId("dialog"); el.classList.remove("open"); el.innerHTML = ""; },
    banner: function (text) { return '<div class="note-illus">' + esc(text) + '</div>'; }
  };

  // ----------------------------------------------------------------------------------- the api scenes get
  var API = {
    data: D, state: ST, T: ST.T, go: function (h) { location.hash = h; }, toast: toast, esc: esc, label: label,
    get view() { return ST.get().view; },
    fmt: { money: ST.fmtMoney, date: fmtDate, days: fmtDays },
    components: C, rerender: function () { render(); }
  };

  // ----------------------------------------------------------------------------------- router
  function route() {
    var h = (location.hash || "#home").slice(1);
    var parts = h.split("/");
    return { name: parts[0] || "worklist", parts: parts, hash: h };
  }
  var NAV = [
    { key: "home", hash: "#home", label: function () { return "Home"; } },
    { key: "worklist", hash: "#worklist/new", label: function () { return "Worklists"; }, area: "worklist" },
    { key: "notes", hash: "#notes", label: function () { return "Notes"; }, area: "notes", badge: function () { return ST.all().reduce(function (a, c) { return a + ST.openFollowUps(c).filter(function (n) { return n.followUp <= ST.TODAY; }).length; }, 0); } },
    { key: "assign", hash: "#assign", label: function () { return label("assign"); }, area: "assign" },
    { key: "payments", hash: "#payments", label: function () { return label("payments"); }, area: "payments" },
    { key: "denials", hash: "#denials", label: function () { return label("denials"); }, area: "denials" },
    { key: "idr", hash: "#idr", label: function () { return label("idr"); }, area: "idr" },
    { key: "inbox", hash: "#inbox", label: function () { return label("inbox"); }, badge: function () { return ST.unreadCount(); } },
    { key: "reports", hash: "#reports", label: function () { return label("reports"); }, area: "reports" }
  ];
  function renderTop() {
    var r = route(); var s = ST.get(); var me = ST.me();
    var ctx = ST.context();
    byId("tenantbox").innerHTML = ctx ? esc(ST.client(ctx.client).name) + ' <span class="region">' + esc(ST.role(ctx.role).label) + '</span> <a class="switchview" href="#home" title="Switch view: another client or role">Switch view</a> <span class="synthetic">synthetic clients</span>' : '<span class="region">no view chosen</span> <span class="synthetic">synthetic clients</span>';
    byId("nav").innerHTML = NAV.filter(function (n) { return !n.area || (ctx && ST.can(n.area)); }).map(function (n) { var b = n.badge ? n.badge() : 0; return '<a class="navitem' + (r.name === n.key || (n.key === "worklist" && r.name === "claim") ? ' on' : '') + '" href="' + n.hash + '">' + esc(n.label()) + (b ? '<span class="navbadge">' + b + '</span>' : '') + '</a>'; }).join("");
    byId("userbox").innerHTML = C.avatar(me.id) + '<span class="user">' + esc(me.name) + '<span class="sub">' + esc(me.role) + '</span></span>';
    byId("viewswitch").innerHTML = '<button type="button" class="btn sm' + (s.view === "familiar" ? ' primary' : '') + '" data-act="view" data-view="familiar">Familiar</button><button type="button" class="btn sm' + (s.view === "classic" ? ' primary' : '') + '" data-act="view" data-view="classic">Classic</button>';
    byId("settingsbtn").textContent = label("settings") + " ▾";
    document.documentElement.setAttribute("data-view", s.view);
    byId("theme-familiar").disabled = s.view !== "familiar";
    byId("theme-classic").disabled = s.view !== "classic";
  }
  function render() {
    renderTop();
    var r = route(); var root = byId("scene");
    var scene = window.SCENES[r.name];
    var AREA = { worklist: "worklist", claim: "claim", notes: "notes", assign: "assign", payments: "payments", denials: "denials", idr: "idr", inbox: "inbox", reports: "reports", settings: "settings" };
    if (r.name !== "home" && !ST.context()) { scene = window.SCENES.home; r = { name: "home", parts: ["home", "pick", r.hash], hash: "home" }; }
    else if (AREA[r.name] && !ST.can(AREA[r.name])) { root.innerHTML = C.panel("Not in this view", '<p>Your current view (' + esc(ST.viewLabel(ST.context())) + ') does not include ' + esc(r.name) + '. <a href="#home">Switch view</a> or <a href="#worklist/new">go to the worklists</a>.</p>'); renderTop(); return; }
    document.title = (scene && scene.title ? scene.title + " · " : "") + "XYZ Monitoring · Insurance Billing (demo)";
    if (!scene) { root.innerHTML = C.panel("Not built yet", '<p>The scene <code>' + esc(r.name) + '</code> is not in this build. <a href="#worklist/new">Back to the worklists</a>.</p>'); return; }
    try { scene.render(root, API, r); } catch (err) { console.error(err); root.innerHTML = C.panel("This scene hit an error", '<pre>' + esc(err && err.stack || err) + '</pre>'); }
    window.scrollTo(0, 0);
  }

  // ----------------------------------------------------------------------------------- shell events
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest("[data-act]");
    var tile = ev.target.closest(".tile[data-href]");
    if (tile && !t) { location.hash = tile.getAttribute("data-href"); return; }
    if (!t) { var m = byId("settingsmenu"); if (m && !ev.target.closest("#settingsmenu, #settingsbtn")) m.classList.remove("open"); return; }
    var act = t.getAttribute("data-act");
    if (act === "view") { ST.T.setView(t.getAttribute("data-view")); toast("Switched to the " + t.getAttribute("data-view") + " view. Same data, same state.", "info"); return; }
    if (act === "settings-toggle") { byId("settingsmenu").classList.toggle("open"); return; }
    if (act === "settings-go") { byId("settingsmenu").classList.remove("open"); location.hash = t.getAttribute("data-href"); return; }
    if (act === "switch-user") { ST.T.setUser(t.getAttribute("data-user")); byId("settingsmenu").classList.remove("open"); toast("Now working as " + ST.me().name, "info"); return; }
    if (act === "reset") { if (confirm("Reset the demo? Everything you clicked goes back to the start.")) { ST.T.reset(); location.hash = "#worklist/new"; toast("Demo reset.", "info"); } return; }
    if (act === "dialog-close") { C.closeDialog(); return; }
    if (act === "arrive") { var pulled = ST.T.arrive(5); toast(pulled.length ? pulled.length + " cases arrived from legacy into New Insurance Billing." : "No more cases waiting in legacy; reset the demo to see arrivals again.", pulled.length ? "ok" : "warn"); if (location.hash !== "#worklist/new") location.hash = "#worklist/new"; return; }
  });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") C.closeDialog(); });
  window.addEventListener("hashchange", render);
  ST.subscribe(render);

  function settingsMenu() {
    var s = ST.get();
    var sup = ST.can("settings");
    return '<ul class="menu-list">' +
      '<li data-act="settings-go" data-href="#home">Switch view (client or role)</li>' +
      (sup ? '<li data-act="settings-go" data-href="#settings/rules">Billing rules</li>' : '') +
      (sup ? '<li data-act="settings-go" data-href="#settings/box33">Box 33 roster</li>' +
      '<li data-act="settings-go" data-href="#settings/clearinghouses">Clearinghouse connections</li>' +
      '<li data-act="settings-go" data-href="#settings/users">Users and roles</li>' +
      '<li data-act="settings-go" data-href="#settings/addons">Add-ons (Remit ' + (s.addons.remit ? "on" : "off") + ')</li>' : '') +
      '<li data-act="settings-go" data-href="#settings/view">My view (Familiar or Classic)</li>' +
      '<li class="sep"></li>' +
      '<li class="head">Work as</li>' +
      D.users.map(function (u) { return '<li data-act="switch-user" data-user="' + u.id + '"' + (u.id === s.currentUser ? ' class="on"' : '') + '>' + esc(u.name) + ' <span class="sub">' + esc(u.role) + '</span></li>'; }).join("") +
      '<li class="sep"></li><li data-act="reset" class="danger">' + esc(label("reset")) + '</li></ul>';
  }
  byId("settingsmenu").innerHTML = settingsMenu();
  ST.subscribe(function () { byId("settingsmenu").innerHTML = settingsMenu(); });
  render();
  window.APP = API;
})();
