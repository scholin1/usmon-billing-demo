/* Scene: the two worklists. New Insurance Billing (prepare and file) and Ongoing Insurance Billing
   (filed and collecting) have DIFFERENT columns, as the design says. Reference scene: other scenes
   follow this shape. */
(function () {
  "use strict";
  var UI = { sort: { "new": { key: "left", dir: "asc" }, ongoing: { key: "since", dir: "desc" } }, q: { "new": "", ongoing: "" }, hidden: { "new": {}, ongoing: {} }, mine: false, sel: {} };

  function render(root, api, r) {
    var C = api.components, ST = api.state, esc = api.esc, L = api.label, fmt = api.fmt;
    var tab = r.parts[1] === "ongoing" ? "ongoing" : "new";
    var all = ST.list(tab);
    var me = ST.me();
    var rows = all.filter(function (c) { return !UI.mine || c.assignee === me.id; });
    var q = UI.q[tab].toLowerCase();
    if (q) rows = rows.filter(function (c) { return [c.pat, c.payer, c.hosp, c.surg, c.entity, ST.statusInfo(c).label, String(c.seq)].join(" ").toLowerCase().indexOf(q) >= 0; });
    var pending = ST.list("pending").length;

    // the two note columns both grids share (legacy Billing_Notes: the last note and the next follow-up)
    function lastNoteSort(c) { var n = ST.lastNote(c); return n ? (n.date || "") + " " + (n.createdAt || "") : ""; }
    function lastNoteCell(c) {
      var n = ST.lastNote(c); if (!n) return '<span class="sub">none</span>';
      var body = n.note || (n.privateHidden ? "(private note)" : n.privateNote) || (n.attachment ? "attachment " + n.attachment : "");
      return '<span class="pill" style="font-size:11px;padding:0 6px">' + esc(n.type) + '</span> <span class="sub">' + esc(fmt.date(n.date)) + '</span><br><span class="sub" title="' + esc(body) + '">' + esc(body.length > 60 ? body.slice(0, 60) + "..." : body) + '</span>';
    }
    function followUpSort(c) { var f = ST.nextFollowUp(c); return f ? f.followUp : "9999"; }
    function followUpCell(c) {
      var f = ST.nextFollowUp(c); if (!f) return '<span class="sub">none</span>';
      var left = ST.daysBetween(ST.TODAY, f.followUp);
      return C.clock({ left: left, cls: left < 0 ? "over" : left <= 2 ? "late" : "ok" }, left === 0 ? " left, due today" : " left") + '<br><span class="sub" title="' + esc(f.note || f.type) + '">' + esc(fmt.date(f.followUp)) + '</span>';
    }

    var tiles = tab === "new" ? [
      { n: all.filter(function (c) { return c.status === "new"; }).length, l: "Unassigned", cls: "warn" },
      { n: all.filter(function (c) { return c.status === "scrubbed"; }).length, l: "Ready to file", cls: "ok" },
      { n: all.filter(function (c) { return ST.filingClock(c).cls !== "ok"; }).length, l: "Filing clock under 14 days", cls: "bad" },
      { n: all.filter(function (c) { return c.status === "rejected"; }).length, l: "Rejected, fix and refile", cls: "bad" },
      { n: fmt.money(all.reduce(function (a, c) { return a + c.billed; }, 0)), l: "Charges waiting to file" }
    ] : [
      { n: all.filter(function (c) { return c.status === "awaiting" || c.status === "acknowledged" || c.status === "filed"; }).length, l: "Awaiting remittance" },
      { n: all.filter(function (c) { return c.status === "denied" || c.status === "partial" || c.status === "recoup"; }).length, l: "Denied or short paid", cls: "bad", href: "#denials" },
      { n: all.filter(function (c) { return c.status.indexOf("idr") === 0 || c.status === "negotiating"; }).length, l: "Out-of-network, negotiating or IDR", cls: "idr", href: "#idr" },
      { n: fmt.money(all.reduce(function (a, c) { return a + ST.totals(c).collected; }, 0)), l: "Collected (illustrative)", cls: "ok", href: "#payments" },
      { n: fmt.money(all.reduce(function (a, c) { return a + ST.totals(c).balance; }, 0)), l: "Open balance (illustrative)" }
    ];

    var cols = tab === "new" ? [
      { key: "pat", label: L("patient"), render: function (c) { return C.patLink(c, esc(c.hosp) + " · DOS " + fmt.date(c.dos) + " · " + esc(c.track)); } },
      { key: "payer", label: L("payer"), render: function (c) { return esc(c.payer) + '<br><span class="sub">' + esc(c.instype) + (c.payerClass === "oon" ? ", out-of-network" : c.payerClass === "government" ? ", government" : c.payerClass === "inn" ? ", in-network" : "") + '</span>'; } },
      { key: "billed", label: "Billed", cls: "num", render: function (c) { return fmt.money(c.billed); } },
      { key: "left", label: L("clock"), cls: "num", sort: function (c) { return ST.filingClock(c).left; }, render: function (c) { return C.clock(ST.filingClock(c)); } },
      { key: "ok", label: L("readiness"), render: function (c) { return '<span class="readiness">' + c.checks.map(function (x) { return '<i class="' + x[1] + '"></i>'; }).join("") + '</span> <span class="sub">' + c.ok + " of " + c.of + '</span>'; } },
      { key: "entity", label: L("box33"), render: function (c) { return esc(c.entity) + C.confirmChip(c); } },
      { key: "assignee", label: L("biller"), sort: function (c) { return c.assignee ? ST.user(c.assignee).name : ""; }, render: function (c) { return c.assignee ? C.avatar(c.assignee) + ' ' + esc(ST.user(c.assignee).name) : C.btn("Assign", "assign-one", { seq: c.seq }, "sm"); } },
      { key: "lastnote", label: "Last note", sort: lastNoteSort, render: lastNoteCell },
      { key: "followup", label: "Follow-up", sort: followUpSort, render: followUpCell },
      { key: "status", label: L("status"), sort: function (c) { return ST.statusInfo(c).label; }, render: function (c) { return C.statusPill(c); } },
      { key: "next", label: L("next"), render: function (c) { var n = ST.nextAction(c); return n.act === "file" ? C.btn(L("file"), "file", { seq: c.seq }, "sm primary") : n.act === "assign" ? C.btn("Assign", "assign-one", { seq: c.seq }, "sm") : C.btn(n.label, "open", { seq: c.seq, to: n.act }, "sm"); } }
    ] : [
      { key: "pat", label: L("patient"), render: function (c) { return C.patLink(c, esc(c.hosp) + " · DOS " + fmt.date(c.dos) + " · " + esc(c.track)); } },
      { key: "payer", label: L("payer"), render: function (c) { return esc(c.payer) + '<br><span class="sub">' + (c.payerClass === "oon" ? "out-of-network" : c.payerClass === "government" ? "government" : c.payerClass === "inn" ? "in-network" : esc(c.instype)) + '</span>'; } },
      { key: "filed", label: "Filed", sort: function (c) { return c.filedOn || ""; }, render: function (c) { return fmt.date(c.filedOn) + '<br><span class="sub">' + (c.filedOn ? ST.daysBetween(c.filedOn, ST.TODAY) + " days ago" : "") + '</span>'; } },
      { key: "billed", label: "Billed", cls: "num", render: function (c) { return fmt.money(c.billed); } },
      { key: "collected", label: L("collected"), cls: "num", sort: function (c) { return ST.totals(c).collected; }, render: function (c) { return fmt.money(ST.totals(c).collected); } },
      { key: "recoup", label: "Recoupment", cls: "num", sort: function (c) { return ST.totals(c).recoupment; }, render: function (c) { var r = ST.totals(c).recoupment; return r ? '<span class="pill recoup">' + fmt.money(r) + '</span>' : '<span class="sub">none</span>'; } },
      { key: "balance", label: L("balance"), cls: "num", sort: function (c) { return ST.totals(c).balance; }, render: function (c) { return '<b>' + fmt.money(ST.totals(c).balance) + '</b>'; } },
      { key: "remit", label: L("lastRemit"), sort: function (c) { return (c.fin && c.fin.last_remit) || ""; }, render: function (c) { return c.fin && c.fin.last_remit ? fmt.date(c.fin.last_remit) : '<span class="sub">none yet</span>'; } },
      { key: "lastnote", label: "Last note", sort: lastNoteSort, render: lastNoteCell },
      { key: "followup", label: "Follow-up", sort: followUpSort, render: followUpCell },
      { key: "status", label: L("status"), sort: function (c) { return ST.statusInfo(c).label; }, render: function (c) { return C.statusPill(c); } },
      { key: "assignee", label: L("biller"), sort: function (c) { return c.assignee ? ST.user(c.assignee).name : ""; }, render: function (c) { return c.assignee ? C.avatar(c.assignee) : ""; } },
      { key: "next", label: L("next"), render: function (c) { var n = ST.nextAction(c); if (!n.label) return '<span class="sub">closed</span>'; var cls = n.act === "denial" || n.act === "idr" ? "sm primary" : "sm"; return C.btn(n.act === "denial" ? L("work") : n.label, "open", { seq: c.seq, to: n.act }, cls); } }
    ];

    var html = C.tabs([
      { key: "new", href: "#worklist/new", label: L("new"), count: ST.list("new").length },
      { key: "ongoing", href: "#worklist/ongoing", label: L("ongoing"), count: ST.list("ongoing").length }
    ], tab);
    html += C.tiles(tiles);
    html += '<div class="toolbar"><div class="searchbar"><input id="wl-q" type="search" placeholder="Find a patient, payer, facility, status" value="' + esc(UI.q[tab]) + '"></div>' +
      '<label class="chk"><input type="checkbox" id="wl-mine"' + (UI.mine ? ' checked' : '') + '> Only mine (' + esc(me.name) + ')</label>' +
      '<span class="spacer"></span>' +
      (tab === "new" ? C.btn(pending ? "Arrivals from legacy (" + pending + " waiting)" : "Arrivals from legacy (none waiting)", "arrive", null, "sm" + (pending ? " primary" : "")) + ' ' : '') +
      C.btn("Columns", "columns", { tab: tab }, "sm") + ' <span class="sub">' + rows.length + " of " + all.length + ' claims</span></div>';
    html += C.grid({ id: "wl-grid", columns: cols, rows: rows, sort: UI.sort[tab], hidden: UI.hidden[tab], empty: tab === "new" && pending ? "Nothing in New right now. Click Arrivals from legacy." : "Nothing matches.", rowCls: function (c) { return c.isNew ? "arrived" : ""; } });
    if (tab === "ongoing") html += C.banner(api.data.illustrative);
    root.innerHTML = html;

    root.querySelector("#wl-q").addEventListener("input", function (ev) { UI.q[tab] = ev.target.value; var pos = ev.target.selectionStart; render(root, api, r); var el = root.querySelector("#wl-q"); el.focus(); el.setSelectionRange(pos, pos); });
    root.querySelector("#wl-mine").addEventListener("change", function (ev) { UI.mine = ev.target.checked; render(root, api, r); });
    root.querySelectorAll("th[data-sort]").forEach(function (th) { th.addEventListener("click", function () { var k = th.getAttribute("data-sort"); var s = UI.sort[tab]; UI.sort[tab] = { key: k, dir: s.key === k && s.dir === "asc" ? "desc" : "asc" }; render(root, api, r); }); });
    root.onclick = onClick;
    function onClick(ev) {
      var t = ev.target.closest("[data-act]"); if (!t) return;
      var act = t.getAttribute("data-act"), seq = Number(t.getAttribute("data-seq"));
      if (act === "confirm") { ST.T.confirmBox33(seq); api.toast("Box 33 confirmed: " + ST.claim(seq).entity, "ok"); }
      else if (act === "file") { var res = ST.T.file(seq, "837"); if (res.ok) api.toast("Filed. The claim moved to " + L("ongoing") + ".", "ok"); else { api.toast("Cannot file: " + res.why, "warn"); api.go("#claim/" + seq + "/scrub"); } }
      else if (act === "open") { var to = t.getAttribute("data-to"); api.go("#claim/" + seq + (to && to !== "track" && to !== "assign" ? "/" + to : "")); }
      else if (act === "assign-one") { assignDialog(api, seq); }
      else if (act === "columns") { columnsDialog(api, tab, root, r); }
    }
  }

  function assignDialog(api, seq) {
    var C = api.components, ST = api.state, esc = api.esc;
    var billers = api.data.users.filter(function (u) { return u.role === "biller"; });
    C.dialog("Assign " + esc(ST.claim(seq).pat), '<p class="sub">Pick the biller. The supervisor can also assign in bulk from Assignments.</p><ul class="menu-list">' + billers.map(function (u) { return '<li data-act="pick" data-user="' + u.id + '">' + C.avatar(u.id) + ' ' + esc(u.name) + ' <span class="sub">' + esc(u.team) + ' · ' + ST.all().filter(function (c) { return c.assignee === u.id && ST.statusInfo(c).list === "new"; }).length + ' in New</span></li>'; }).join("") + '</ul>', [{ text: "Cancel", act: "dialog-close" }]);
    document.getElementById("dialog").onclick = function (ev) { var t = ev.target.closest("[data-act=pick]"); if (!t) return; ST.T.assign(seq, t.getAttribute("data-user")); C.closeDialog(); api.toast("Assigned to " + ST.user(t.getAttribute("data-user")).name, "ok"); };
  }

  function columnsDialog(api, tab, root, r) {
    var C = api.components, esc = api.esc;
    var names = tab === "new" ? { pat: "Patient", payer: "Payer", billed: "Billed", left: "Filing clock", ok: "Readiness", entity: "Box 33", assignee: "Biller", lastnote: "Last note", followup: "Follow-up", status: "Status", next: "Next" } : { pat: "Patient", payer: "Payer", filed: "Filed", billed: "Billed", collected: "Collected", recoup: "Recoupment", balance: "Balance", remit: "Last remit", lastnote: "Last note", followup: "Follow-up", status: "Status", assignee: "Biller", next: "Next" };
    C.dialog("Show or hide columns", '<p class="sub">Your choice is kept for this session (per-biller default view in the module).</p>' + Object.keys(names).map(function (k) { return '<label class="chk" style="display:flex"><input type="checkbox" data-col="' + k + '"' + (UI.hidden[tab][k] ? '' : ' checked') + '> ' + esc(names[k]) + '</label>'; }).join(""), [{ text: "Done", act: "dialog-close" }]);
    document.getElementById("dialog").onchange = function (ev) { var t = ev.target.closest("[data-col]"); if (!t) return; UI.hidden[tab][t.getAttribute("data-col")] = !t.checked; render(root, api, r); };
  }

  window.SCENES.worklist = { title: "Worklists", render: render };
})();
