/* Scene: assign. The supervisor's view of who holds what. One column per biller plus Unassigned,
   a Move select on every claim, multi-select with bulk reassign, Balance the queue (round-robin,
   lightest queue first), and the assignment history across every claim. Ongoing claims sit in a
   second, collapsed grid (collections and denials ownership) with the same Move select.
   Scene UI state (selection, open panels) lives in UI; claim state lives in the store. */
(function () {
  "use strict";
  var UI = { sel: {}, ongoingOpen: false, bulkTo: "", allHistory: false, seen: {}, seenN: 0 };

  var STYLE = '<style>' +
    '.as-board { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; align-items: start; margin-bottom: 14px; }' +
    '.as-col { margin-bottom: 0; } .as-col h3 { display: flex; align-items: center; gap: 8px; } .as-col h3 .count { margin-left: auto; color: var(--muted); font-weight: 400; font-size: 12px; }' +
    '.as-col .team { color: var(--muted); font-size: 12px; margin: -4px 0 6px; }' +
    '.as-item { border-top: 1px solid var(--line); padding: 8px 6px; margin: 0 -6px; display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: start; }' +
    '.as-item .meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; grid-column: 2; }' +
    '.as-item select { grid-column: 2; max-width: 100%; }' +
    '.as-item.selected { background: var(--accent); }' +
    '.as-unassigned h3 { color: var(--warn); }' +
    '.as-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 8px 12px; border: 1px solid var(--line2); background: var(--accent); margin: 10px 0; }' +
    '.as-empty { color: var(--muted); font-size: 12px; padding: 8px 0; }' +
    '</style>';

  function render(root, api, r) {
    var C = api.components, ST = api.state, esc = api.esc, L = api.label, fmt = api.fmt;
    var users = api.data.users;
    var billers = users.filter(function (u) { return u.role === "biller"; });
    var newClaims = ST.list("new"), ongoing = ST.list("ongoing");
    var unassigned = newClaims.filter(function (c) { return !c.assignee; });
    var oldest = unassigned.reduce(function (m, c) { return Math.max(m, ST.daysBetween(c.dos, ST.TODAY)); }, 0);
    var perBiller = billers.map(function (u) { return newClaims.filter(function (c) { return c.assignee === u.id; }).length; });
    var me = ST.me();

    // keep only selections that still sit in New (a filed claim leaves the board)
    var selSeqs = Object.keys(UI.sel).filter(function (k) { var c = ST.claim(k); return UI.sel[k] && c && ST.statusInfo(c).list === "new"; }).map(Number);
    UI.sel = {}; selSeqs.forEach(function (s) { UI.sel[s] = true; });

    function byClock(a, b) { return ST.filingClock(a).left - ST.filingClock(b).left; }
    function moveSelect(c) {
      var opts = billers.filter(function (u) { return u.id !== c.assignee; });
      return '<select data-act="as-move" data-seq="' + c.seq + '" title="Move this claim to another biller"><option value="">Move to...</option>' +
        opts.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.name) + ' (' + esc(u.team) + ')</option>'; }).join("") + '</select>';
    }
    function item(c) {
      return '<div class="as-item' + (UI.sel[c.seq] ? ' selected' : '') + '">' +
        '<input type="checkbox" data-act="as-sel" data-seq="' + c.seq + '"' + (UI.sel[c.seq] ? ' checked' : '') + ' title="Select for bulk reassign">' +
        '<div>' + C.patLink(c, esc(c.payer) + ' · ' + fmt.money(c.billed)) + '</div>' +
        '<div class="meta">' + C.clock(ST.filingClock(c)) + ' ' + C.statusPill(c) + ' <a class="sub" href="#claim/' + c.seq + '">' + esc(L("open")) + '</a></div>' +
        moveSelect(c) + '</div>';
    }
    function column(title, sub, cls, items, emptyText) {
      return '<div class="card as-col ' + cls + '"><h3>' + title + '<span class="count">' + items.length + '</span></h3><div class="team">' + esc(sub) + '</div>' +
        (items.length ? items.slice().sort(byClock).map(item).join("") : '<div class="as-empty">' + esc(emptyText) + '</div>') + '</div>';
    }

    var html = STYLE + '<h1>' + esc(L("assign")) + '</h1>' +
      '<p class="sub">Who holds what in ' + esc(L("new")) + '. Move one claim with its select, tick several and reassign them together, or balance the whole unassigned queue. ' +
      (me.role === "supervisor" ? 'You are working as a supervisor.' : 'You are working as a biller; in the module this screen is the supervisor’s, and a biller sees only their own column.') + '</p>';

    html += C.tiles([
      { n: unassigned.length, l: "Unassigned in " + L("new"), cls: unassigned.length ? "warn" : "ok", href: "#worklist/new" },
      { n: billers.length ? Math.min.apply(null, perBiller) + " to " + Math.max.apply(null, perBiller) : "0", l: "New claims per biller (fewest to most)" },
      { n: oldest ? fmt.days(oldest) : "none", l: "Oldest unassigned, days since service", cls: oldest > 60 ? "bad" : oldest > 30 ? "warn" : "" },
      { n: ongoing.filter(function (c) { return !c.assignee && c.status !== "closed"; }).length, l: "Ongoing without an owner" }
    ]);

    html += '<div class="toolbar">' +
      (unassigned.length ? C.btn("Balance the queue (" + unassigned.length + " unassigned)", "as-balance", null, "sm primary") : '<button type="button" class="btn sm" disabled title="Nothing is unassigned right now">Balance the queue</button>') + ' ' +
      (unassigned.length ? C.btn("Select all unassigned", "as-select-unassigned", null, "sm") : '') +
      '<span class="spacer"></span><span class="sub">' + newClaims.length + ' claims in ' + esc(L("new")) + ', ' + billers.length + ' billers</span></div>';

    if (selSeqs.length) {
      html += '<div class="as-bar"><b>' + selSeqs.length + ' selected</b> Reassign selected to ' +
        '<select data-act="as-bulk-to"><option value="">choose a biller</option>' + billers.map(function (u) { return '<option value="' + esc(u.id) + '"' + (UI.bulkTo === u.id ? ' selected' : '') + '>' + esc(u.name) + ' (' + esc(u.team) + ')</option>'; }).join("") + '</select> ' +
        C.btn("Reassign", "as-bulk", null, "sm primary") + ' ' + C.btn("Clear selection", "as-clear", null, "sm") + '</div>';
    }

    html += '<div class="as-board">';
    html += column("Unassigned", "Waiting for a biller", "as-unassigned", unassigned, "Everything in " + L("new") + " has a biller.");
    billers.forEach(function (u) {
      html += column(C.avatar(u.id) + ' ' + esc(u.name), u.team, "", newClaims.filter(function (c) { return c.assignee === u.id; }), "Nothing in " + L("new") + " for " + u.name + ".");
    });
    html += '</div>';

    // Ongoing: collections and denials ownership (collapsed by default)
    var ongoingOpen = ongoing.filter(function (c) { return c.status !== "closed"; });
    var ongoingBody;
    if (UI.ongoingOpen) {
      ongoingBody = C.grid({
        id: "as-ongoing",
        columns: [
          { key: "pat", label: L("patient"), render: function (c) { return C.patLink(c, esc(c.hosp) + " · DOS " + fmt.date(c.dos)); } },
          { key: "payer", label: L("payer"), render: function (c) { return esc(c.payer) + '<br><span class="sub">' + (c.payerClass === "oon" ? "out-of-network" : c.payerClass === "government" ? "government" : "in-network") + '</span>'; } },
          { key: "status", label: L("status"), render: function (c) { return C.statusPill(c); } },
          { key: "balance", label: L("balance"), cls: "num", render: function (c) { return fmt.money(ST.totals(c).balance); } },
          { key: "assignee", label: L("biller"), render: function (c) { return c.assignee ? C.avatar(c.assignee) + ' ' + esc(ST.user(c.assignee).name) : '<span class="pill new">Unassigned</span>'; } },
          { key: "move", label: "Move", render: moveSelect }
        ],
        rows: ongoingOpen.slice().sort(function (a, b) { return (a.assignee || "") < (b.assignee || "") ? -1 : 1; }),
        empty: "Nothing in " + L("ongoing") + "."
      }) + C.banner(api.data.illustrative);
    } else {
      ongoingBody = '<p class="sub">' + ongoingOpen.length + ' open claims in ' + esc(L("ongoing")) + '. Show the grid to see who owns collections, denials and IDR on each one and move them the same way.</p>';
    }
    var toggleBtn = C.btn(UI.ongoingOpen ? "Hide" : "Show", "as-toggle-ongoing", null, "sm");

    // Assignment history across every claim, newest first
    // events carry a date, not a time; the scene numbers each event the first time it sees it so
    // moves made while on this screen sort newest first within the day
    var hist = [];
    ST.all().forEach(function (c) { c.history.forEach(function (e, i) { if (e.kind === "assigned") { var key = c.seq + "|" + i; if (!UI.seen[key]) UI.seen[key] = ++UI.seenN; hist.push({ date: e.date, who: e.who, text: e.text, seq: c.seq, pat: c.pat, n: UI.seen[key] }); } }); });
    hist.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.n - a.n; });
    var shown = UI.allHistory ? hist : hist.slice(0, 15);
    var histBody = hist.length ? '<ul class="history">' + shown.map(function (h) {
      return '<li><a href="#claim/' + h.seq + '"><b>' + esc(h.pat) + '</b></a> ' + esc(h.text.replace(/^Assigned to /, "to ")) + '<span class="sub">by ' + esc(ST.user(h.who).name) + ' on ' + esc(fmt.date(h.date)) + '</span></li>';
    }).join("") + '</ul>' + (hist.length > 15 ? '<p>' + C.btn(UI.allHistory ? "Show the latest 15" : "Show all " + hist.length, "as-all-history", null, "sm") + '</p>' : '')
      : '<p class="sub">No assignments yet in this session. The billers’ current queues came over from legacy with the claims; every move you make here is written to the claim’s history and shows up in this list.</p>';

    html += '<div class="row"><div>' + C.panel("Collections and denials ownership", ongoingBody, toggleBtn) + '</div>' +
      '<div class="side">' + C.panel("Assignment history", histBody, '<span>' + hist.length + '</span>') + '</div></div>';

    root.innerHTML = html;

    // ---- events (properties, not addEventListener, so a re-render never stacks handlers)
    root.onclick = function (ev) {
      var t = ev.target.closest("[data-act]"); if (!t || !root.contains(t)) return;
      var act = t.getAttribute("data-act");
      if (act === "as-balance") balance();
      else if (act === "as-select-unassigned") { unassigned.forEach(function (c) { UI.sel[c.seq] = true; }); render(root, api, r); }
      else if (act === "as-clear") { UI.sel = {}; UI.bulkTo = ""; render(root, api, r); }
      else if (act === "as-bulk") {
        var uid = UI.bulkTo;
        if (!uid) { api.toast("Pick a biller first.", "warn"); return; }
        var seqs = selSeqs.slice();
        UI.sel = {}; UI.bulkTo = "";
        ST.T.bulkAssign(seqs, uid);
        api.toast(seqs.length + (seqs.length === 1 ? " claim" : " claims") + " reassigned to " + ST.user(uid).name + ".", "ok");
      }
      else if (act === "as-toggle-ongoing") { UI.ongoingOpen = !UI.ongoingOpen; render(root, api, r); }
      else if (act === "as-all-history") { UI.allHistory = !UI.allHistory; render(root, api, r); }
    };
    root.onchange = function (ev) {
      var t = ev.target.closest("[data-act]"); if (!t) return;
      var act = t.getAttribute("data-act"), seq = Number(t.getAttribute("data-seq"));
      if (act === "as-sel") { UI.sel[seq] = t.checked; render(root, api, r); }
      else if (act === "as-bulk-to") { UI.bulkTo = t.value; }
      else if (act === "as-move") {
        var uid = t.value; if (!uid) return;
        var c = ST.claim(seq); var from = c.assignee ? ST.user(c.assignee).name : "Unassigned";
        ST.T.assign(seq, uid);
        api.toast(c.pat + " moved from " + from + " to " + ST.user(uid).name + ".", "ok");
      }
    };

    function balance() {
      if (!unassigned.length) { api.toast("Nothing is unassigned.", "info"); return; }
      var load = {}, buckets = {};
      billers.forEach(function (u, i) { load[u.id] = perBiller[i]; buckets[u.id] = []; });
      unassigned.slice().sort(byClock).forEach(function (c) {
        var pick = billers[0].id;
        billers.forEach(function (u) { if (load[u.id] < load[pick]) pick = u.id; });
        buckets[pick].push(c.seq); load[pick]++;
      });
      var n = 0;
      billers.forEach(function (u) { if (buckets[u.id].length) { n += buckets[u.id].length; ST.T.bulkAssign(buckets[u.id], u.id); } });
      api.toast(n + (n === 1 ? " claim" : " claims") + " assigned round-robin across " + billers.length + " billers, lightest queue first.", "ok");
    }
  }

  window.SCENES.assign = { title: "Assignments", render: render };
})();
