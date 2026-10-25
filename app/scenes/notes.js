/* Scene: Notes, the per-client worklist of every note on every claim (legacy Billing_Notes is the
   collections history a biller reads first). Routes: #notes (all), #notes/followups (open follow-ups,
   overdue first), #notes/mine (my notes). Tiles, filters (type, author, dates, text), a sortable grid,
   Add note, Done on a follow-up, Delete (supervisors and admins), Export CSV. Reads through
   api.state (notesFor, allNotes, openFollowUps, noteTypes, canSeePrivate); writes through
   T.addNote, T.followUpDone, T.deleteNote. Edits only this file. */
(function () {
  "use strict";
  window.SCENES = window.SCENES || {};

  // scene UI state; the store re-renders after every transition so nothing below lives in the DOM
  var UI = { sort: { all: { key: "date", dir: "desc" }, followups: { key: "followup", dir: "asc" }, mine: { key: "date", dir: "desc" } }, type: "", author: "", from: "", to: "", q: "" };

  var STYLE = '<style>' +
    '.nt-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; } .nt-head h1 { margin: 0; } .nt-head .spacer { flex: 1; }' +
    '.nt-filters select, .nt-filters input[type=date] { max-width: 190px; } .nt-filters label.chk { gap: 4px; }' +
    '.nt-note { min-width: 240px; max-width: 440px; white-space: normal; line-height: 1.35; }' +
    '.nt-lock { display: inline-block; font-size: 11px; padding: 0 6px; margin-left: 4px; border: 1px dashed var(--line2); color: var(--muted); border-radius: 6px; white-space: nowrap; }' +
    '.nt-priv { background: var(--warn-bg); border-left: 3px solid var(--warn); padding: 3px 6px; margin-top: 4px; font-size: 12px; color: var(--ink); }' +
    '.nt-chip { display: inline-block; font-size: 11.5px; padding: 0 7px; border: 1px solid var(--line2); border-radius: 10px; background: var(--accent); color: var(--ink); max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }' +
    '.nt-type { font-size: 11px; padding: 0 6px; }' +
    '.nt-fu { white-space: nowrap; } .nt-fu .btn { margin-left: 4px; }' +
    '.nt-form label.full textarea { min-height: 60px; } .nt-form select { width: 100%; box-sizing: border-box; }' +
    '.nt-who .sub { display: block; }' +
    '</style>';

  // a modest colour per note type, with the status-pill classes both skins already style
  var TYPE_CLS = { "First Level Appeal Pro": "appeal", "Payer Call": "filed", "Patient Call": "filed", "Patient Statement": "await", "Pre-Authorization": "prep", "Verification": "ready", "Billing Research": "idr", "Correspondence (letter or EOB)": "filed", "Claim Follow-up-PA": "partial" };

  function excerpt(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n) + "..." : s; }
  function bodyOf(n) { return n.note || (n.privateHidden ? "(private note)" : n.privateNote) || (n.attachment ? "attachment " + n.attachment : ""); }
  function isOpen(n) { return !!n.followUp && !n.followUpDone; }
  function fuClock(ST, iso) { var left = ST.daysBetween(ST.TODAY, iso); var cls = left < 0 ? "over" : left <= 2 ? "late" : "ok"; var t = left < 0 ? Math.abs(left) + " over" : left === 0 ? "due today" : left + " left"; return '<span class="clock ' + cls + '">' + t + '</span>'; }

  function render(root, api, r) {
    var C = api.components, ST = api.state, esc = api.esc, fmt = api.fmt, L = api.label, D = api.data;
    var TODAY = ST.TODAY, ctx = ST.context(), me = ST.me(), priv = ST.canSeePrivate();
    var tab = r.parts[1] === "followups" ? "followups" : r.parts[1] === "mine" ? "mine" : "all";
    var client = ST.client(ctx.client);
    var weekEnd = ST.addDays(TODAY, 6);

    // every note of the active client's claims, newest first, as {note, claim}
    var every = ST.allNotes();
    var opens = every.filter(function (x) { return isOpen(x.note); });
    var dueNow = opens.filter(function (x) { return x.note.followUp <= TODAY; });
    var mine = every.filter(function (x) { return x.note.who === me.id; });

    // the tab's rows, then the filters
    var rows = tab === "followups" ? opens.slice() : tab === "mine" ? mine.slice() : every.slice();
    if (UI.type) rows = rows.filter(function (x) { return x.note.type === UI.type; });
    if (UI.author === "legacy") rows = rows.filter(function (x) { return x.note.source === "legacy"; });
    else if (UI.author === "system") rows = rows.filter(function (x) { return x.note.source === "system" || x.note.who === "system"; });
    else if (UI.author) rows = rows.filter(function (x) { return x.note.who === UI.author; });
    if (UI.from) rows = rows.filter(function (x) { return x.note.date >= UI.from; });
    if (UI.to) rows = rows.filter(function (x) { return x.note.date <= UI.to; });
    var q = UI.q.trim().toLowerCase();
    if (q) rows = rows.filter(function (x) { var n = x.note, c = x.claim; return [n.note, priv ? n.privateNote : "", n.type, n.attachment, c.pat, c.payer, String(c.seq), ST.user(n.who).name].join(" ").toLowerCase().indexOf(q) >= 0; });
    rows = rows.map(function (x) { return { seq: x.claim.seq, note: x.note, claim: x.claim }; });

    var html = STYLE;
    html += '<div class="nt-head"><h1>Notes</h1><span class="sub">' + esc(client.name) + ' (' + esc(client.id) + ')</span><span class="spacer"></span>' +
      C.btn("Add note", "nt-add", null, "primary") + ' ' + C.btn("Export CSV", "nt-export", null, "") + '</div>';
    html += '<div class="sub">Note types are the client\'s own list (legacy Billing_Notes_Types); types marked notify alert the supervisor when filed.' +
      (priv ? ' Private notes are shown shaded; billers do not see them.' : ' Private notes exist on some claims; your role sees only that they exist.') + '</div>';

    // tiles
    var tiles = [
      { n: every.filter(function (x) { return x.note.date === TODAY; }).length, l: "Notes filed today", href: "#notes" },
      { n: dueNow.length, l: "Follow-ups due today or overdue", cls: dueNow.length ? "bad" : "ok", href: "#notes/followups" },
      { n: opens.filter(function (x) { return x.note.followUp <= weekEnd; }).length, l: "Follow-ups this week", cls: "warn", href: "#notes/followups" }
    ];
    if (priv) tiles.push({ n: every.filter(function (x) { return !!x.note.privateNote; }).length, l: "Private notes (supervisors and admins)" });
    tiles.push({ n: mine.length, l: "Notes by me (" + me.name + ")", href: "#notes/mine" });
    html += C.tiles(tiles);

    // tabs
    html += C.tabs([
      { key: "all", href: "#notes", label: "All notes", count: every.length },
      { key: "followups", href: "#notes/followups", label: "Follow-ups", count: opens.length },
      { key: "mine", href: "#notes/mine", label: "My notes", count: mine.length }
    ], tab);

    // filters
    var users = D.users || [];
    html += '<div class="toolbar nt-filters">' +
      '<label class="chk">Type <select data-filter="type"><option value="">All types</option>' + ST.noteTypes().map(function (t) { return '<option value="' + esc(t.type) + '"' + (UI.type === t.type ? ' selected' : '') + '>' + esc(t.type) + (t.notify ? ' (notifies ' + esc(t.notify) + ')' : '') + '</option>'; }).join("") + '</select></label>' +
      '<label class="chk">Author <select data-filter="author"><option value="">Anyone</option>' + users.map(function (u) { return '<option value="' + esc(u.id) + '"' + (UI.author === u.id ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join("") +
        '<option value="legacy"' + (UI.author === "legacy" ? ' selected' : '') + '>Legacy (came over from legacy)</option><option value="system"' + (UI.author === "system" ? ' selected' : '') + '>System</option></select></label>' +
      '<label class="chk">From <input type="date" data-filter="from" value="' + esc(UI.from) + '"></label>' +
      '<label class="chk">To <input type="date" data-filter="to" value="' + esc(UI.to) + '"></label>' +
      '<div class="searchbar"><input id="nt-q" type="search" placeholder="Find in notes, patients, claims" value="' + esc(UI.q) + '"></div>' +
      (UI.type || UI.author || UI.from || UI.to || UI.q ? C.btn("Clear filters", "nt-clear", null, "sm") : '') +
      '<span class="spacer"></span><span class="sub">' + rows.length + ' of ' + (tab === "followups" ? opens.length : tab === "mine" ? mine.length : every.length) + ' notes</span></div>';

    if (tab === "followups") {
      var over = rows.filter(function (x) { return x.note.followUp < TODAY; }).length, today = rows.filter(function (x) { return x.note.followUp === TODAY; }).length;
      html += '<p class="sub"><b>' + over + ' overdue, ' + today + ' due today</b>; ' + (rows.length - over - today) + ' later. Open follow-ups only, overdue first. Done takes a follow-up off the list and writes it to the claim\'s history.</p>';
    }

    // the grid
    var cols = [
      { key: "date", label: "Date", sort: function (x) { return (x.note.date || "") + " " + (x.note.createdAt || ""); }, render: function (x) { return esc(fmt.date(x.note.date)); } },
      { key: "pat", label: L("patient"), sort: function (x) { return x.claim.pat; }, render: function (x) { return C.patLink(x.claim, '<span title="' + esc(x.claim.payer) + '">DOS ' + esc(fmt.date(x.claim.dos)) + '</span>'); } },
      { key: "claim", label: "Claim", sort: function (x) { return x.seq; }, render: function (x) { return '<span class="mono">' + esc(x.seq) + '</span><br>' + C.statusPill(x.claim); } },
      { key: "type", label: "Type", sort: function (x) { return x.note.type; }, render: function (x) { return '<span class="pill nt-type ' + esc(TYPE_CLS[x.note.type] || "") + '">' + esc(x.note.type) + '</span>'; } },
      { key: "note", label: "Note", cls: "nt-note", sort: function (x) { return bodyOf(x.note).toLowerCase(); }, render: function (x) {
        var n = x.note, h = '<span title="' + esc(n.note) + '">' + esc(excerpt(n.note, 120)) + '</span>';
        if (!n.note && !n.privateNote && !n.privateHidden && n.attachment) h = '<span class="sub">attachment only</span>';
        if (n.privateHidden) h += '<span class="nt-lock" title="This note has a private part; supervisors and admins see it">private, locked</span>';
        else if (n.privateNote) h += '<div class="nt-priv" title="' + esc(n.privateNote) + '"><span class="sub">Private</span> ' + esc(excerpt(n.privateNote, 120)) + '</div>';
        if (n.mentions && n.mentions.length) h += '<br><span class="sub">@' + esc(n.mentions.map(function (id) { return ST.user(id).name; }).join(", @")) + '</span>';
        return h; } },
      { key: "who", label: "Author", cls: "nt-who", sort: function (x) { return ST.user(x.note.who).name; }, render: function (x) { var n = x.note; var u = ST.user(n.who); return (u.initials && u.initials !== "?" ? C.avatar(n.who) + ' ' : '') + esc(u.name) + (n.source === "legacy" ? '<span class="sub">from legacy</span>' : n.source === "system" ? '<span class="sub">automatic</span>' : ''); } },
      { key: "corr", label: "Correspondence", sort: function (x) { return x.note.correspondenceDate || ""; }, render: function (x) { return x.note.correspondenceDate ? esc(fmt.date(x.note.correspondenceDate)) : '<span class="sub">none</span>'; } },
      { key: "attach", label: "Attachment", sort: function (x) { return x.note.attachment || ""; }, render: function (x) { return x.note.attachment ? '<span class="nt-chip" title="' + esc(x.note.attachment) + ' (file name only in this demo)">' + esc(x.note.attachment) + '</span>' : '<span class="sub">none</span>'; } },
      { key: "followup", label: "Follow-up", cls: "nt-fu", sort: function (x) { return x.note.followUp ? (x.note.followUpDone ? "9" : "0") + x.note.followUp : "99"; }, render: function (x) {
        var n = x.note; if (!n.followUp) return '<span class="sub">none</span>';
        if (n.followUpDone) return '<span class="sub">' + esc(fmt.date(n.followUp)) + ', done' + (n.followUpDoneBy ? ' by ' + esc(ST.user(n.followUpDoneBy).name) : '') + '</span>';
        return fuClock(ST, n.followUp) + ' <span class="sub">' + esc(fmt.date(n.followUp)) + '</span>' + C.btn("Done", "nt-done", { seq: x.seq, id: n.id }, "sm"); } }
    ];
    if (priv) cols.push({ key: "del", label: "", render: function (x) { return C.btn("Delete", "nt-del", { seq: x.seq, id: x.note.id }, "sm danger"); } });

    html += C.grid({ id: "nt-grid", columns: cols, rows: rows, sort: UI.sort[tab], empty: tab === "followups" ? "No open follow-ups. Add a note with a follow-up date to see one here." : tab === "mine" ? "You have not filed a note on this client's claims yet." : "No notes match." });
    html += '<p class="sub">Export CSV writes the ' + rows.length + ' rows shown, after these filters: date, patient, claim, type, note, author, follow-up' + (priv ? ', private note' : '') + '. ' + (priv ? 'Private bodies are included because your role can see them.' : 'Private bodies are never in a biller\'s export.') + ' Deleted notes stay in the record and are not listed here.</p>';
    root.innerHTML = html;

    // events: filters, sort, actions
    root.querySelector("#nt-q").addEventListener("input", function (ev) { UI.q = ev.target.value; var pos = ev.target.selectionStart; render(root, api, r); var el = root.querySelector("#nt-q"); el.focus(); el.setSelectionRange(pos, pos); });
    root.querySelectorAll("[data-filter]").forEach(function (el) { el.addEventListener("change", function (ev) { UI[el.getAttribute("data-filter")] = ev.target.value; render(root, api, r); }); });
    root.querySelectorAll("th[data-sort]").forEach(function (th) { th.addEventListener("click", function () { var k = th.getAttribute("data-sort"); if (!k) return; var s = UI.sort[tab]; UI.sort[tab] = { key: k, dir: s.key === k && s.dir === "asc" ? "desc" : "asc" }; render(root, api, r); }); });
    root.onclick = function (ev) {
      var t = ev.target.closest("[data-act]"); if (!t) return;
      var act = t.getAttribute("data-act"), seq = Number(t.getAttribute("data-seq")), id = t.getAttribute("data-id");
      if (act === "nt-add") addDialog(api);
      else if (act === "nt-export") exportCsv(api, rows, tab);
      else if (act === "nt-clear") { UI.type = UI.author = UI.from = UI.to = UI.q = ""; render(root, api, r); }
      else if (act === "nt-done") { ST.T.followUpDone(seq, id); api.toast("Follow-up done on " + ST.claim(seq).pat + ".", "ok"); }
      else if (act === "nt-del") deleteDialog(api, seq, id);
    };
  }

  // ----------------------------------------------------------------------------------- Add note
  function addDialog(api) {
    var C = api.components, ST = api.state, esc = api.esc, fmt = api.fmt;
    var priv = ST.canSeePrivate();
    var claims = ST.all().filter(function (c) { return c.status !== "pending"; }).sort(function (a, b) { return a.pat < b.pat ? -1 : a.pat > b.pat ? 1 : a.dos < b.dos ? -1 : 1; });
    function options(q) {
      q = (q || "").toLowerCase();
      var list = claims.filter(function (c) { return !q || [c.pat, fmt.date(c.dos), ST.statusInfo(c).label, c.payer, String(c.seq)].join(" ").toLowerCase().indexOf(q) >= 0; });
      return list.length ? list.map(function (c) { return '<option value="' + c.seq + '">' + esc(c.pat) + ' · DOS ' + esc(fmt.date(c.dos)) + ' · ' + esc(ST.statusInfo(c).label) + '</option>'; }).join("") : '<option value="">No claim matches</option>';
    }
    var types = ST.noteTypes();
    C.dialog("Add a note", '<p class="sub">A note needs a body' + (priv ? ', a private body' : '') + ' or an attachment. The author and time are recorded; the note date is yours to set (legacy lets the biller date a note).</p>' +
      '<div class="form nt-form">' +
      '<label class="full">Claim <input id="nt-find" type="search" placeholder="Type a patient, date of service or status to narrow the list"></label>' +
      '<label class="full"><select id="nt-claim" size="5">' + options("") + '</select></label>' +
      '<label>Type<select id="nt-type">' + types.map(function (t) { return '<option value="' + esc(t.type) + '">' + esc(t.type) + (t.notify ? ' (notifies ' + esc(t.notify) + ')' : '') + '</option>'; }).join("") + '</select></label>' +
      '<label>Note date<input id="nt-date" type="date" value="' + esc(ST.TODAY) + '"></label>' +
      '<label class="full">Note<textarea id="nt-text" placeholder="What happened, what was said, what comes next"></textarea></label>' +
      (priv ? '<label class="full">Private note <span class="sub">(supervisors and admins only)</span><textarea id="nt-priv" placeholder="Not shown to billers"></textarea></label>' : '') +
      '<label>Correspondence date<input id="nt-corr" type="date"></label>' +
      '<label>Follow-up date<input id="nt-fu" type="date"></label>' +
      '<label class="full">Attachment <span class="sub">(the file name only; this demo stores no files)</span><input id="nt-file" type="file"></label>' +
      '</div>',
      [{ text: "Cancel", act: "dialog-close" }, { text: "Save note", act: "nt-save", cls: "primary" }]);
    var dlg = document.getElementById("dialog");
    var sel = dlg.querySelector("#nt-claim"); if (sel.options.length && sel.options[0].value) sel.selectedIndex = 0;
    dlg.oninput = function (ev) { if (ev.target.id !== "nt-find") return; var cur = sel.value; sel.innerHTML = options(ev.target.value); if (cur && sel.querySelector('option[value="' + cur + '"]')) sel.value = cur; else if (sel.options.length && sel.options[0].value) sel.selectedIndex = 0; };
    dlg.onchange = null;
    dlg.onclick = function (ev) {
      var t = ev.target.closest("[data-act=nt-save]"); if (!t) return;
      var seq = Number(sel.value); if (!seq) { api.toast("Pick a claim first.", "warn"); return; }
      var file = dlg.querySelector("#nt-file").files[0];
      var o = { type: dlg.querySelector("#nt-type").value, date: dlg.querySelector("#nt-date").value || ST.TODAY, note: dlg.querySelector("#nt-text").value, privateNote: priv ? dlg.querySelector("#nt-priv").value : "",
                correspondenceDate: dlg.querySelector("#nt-corr").value || null, followUp: dlg.querySelector("#nt-fu").value || null, attachment: file ? file.name : "" };
      if (!o.note.trim() && !o.privateNote.trim() && !o.attachment) { api.toast("The note needs a body" + (priv ? ", a private body" : "") + " or an attachment.", "warn"); return; }
      var n = ST.T.addNote(seq, o, []);
      C.closeDialog();
      var nt = ST.noteTypes().find(function (x) { return x.type === o.type; });
      api.toast("Note filed on " + ST.claim(seq).pat + (n && n.followUp ? ", follow-up " + fmt.date(n.followUp) : "") + (nt && nt.notify ? "; the " + nt.notify + " was notified" : "") + ".", "ok");
    };
  }

  // ----------------------------------------------------------------------------------- Delete (kept in the record)
  function deleteDialog(api, seq, id) {
    var C = api.components, ST = api.state, esc = api.esc;
    var c = ST.claim(seq); var n = (c.notes || []).find(function (x) { return x.id === id; }); if (!n) return;
    C.dialog("Delete this note", '<p>' + esc(c.pat) + ', ' + esc(n.type) + ', ' + esc(api.fmt.date(n.date)) + ' by ' + esc(ST.user(n.who).name) + '.</p><p class="sub">' + esc(excerpt(n.note || n.privateNote || n.attachment, 200)) + '</p>' +
      '<div class="form"><label class="full">Why<textarea id="nt-why" placeholder="The reason is kept with the deleted note"></textarea></label></div>' +
      '<p class="sub">Deleted notes leave the list but stay in the claim\'s record with who deleted them and why, as legacy keeps them.</p>',
      [{ text: "Cancel", act: "dialog-close" }, { text: "Delete note", act: "nt-del-go", cls: "danger" }]);
    var dlg = document.getElementById("dialog"); dlg.oninput = null; dlg.onchange = null;
    dlg.onclick = function (ev) { var t = ev.target.closest("[data-act=nt-del-go]"); if (!t) return; ST.T.deleteNote(seq, id, dlg.querySelector("#nt-why").value.trim()); C.closeDialog(); api.toast("Note deleted; it stays in the record.", "ok"); };
  }

  // ----------------------------------------------------------------------------------- Export CSV
  function csvCell(v) { v = String(v == null ? "" : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function exportCsv(api, rows, tab) {
    var ST = api.state, fmt = api.fmt, priv = ST.canSeePrivate();
    if (!rows.length) { api.toast("Nothing to export with these filters.", "warn"); return; }
    var head = ["date", "patient", "claim", "type", "note", "author", "follow-up"]; if (priv) head.push("private note");
    var lines = [head.map(csvCell).join(",")];
    rows.forEach(function (x) { var n = x.note; var line = [fmt.date(n.date), x.claim.pat, x.seq, n.type, n.note, ST.user(n.who).name + (n.source === "legacy" ? " (legacy)" : ""), n.followUp ? fmt.date(n.followUp) + (n.followUpDone ? " done" : "") : ""]; if (priv) line.push(n.privateNote || ""); lines.push(line.map(csvCell).join(",")); });
    var ctx = ST.context(); var name = "notes-" + (ctx ? ctx.client : "all") + "-" + tab + "-" + ST.TODAY + ".csv";
    try {
      var blob = new Blob([lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
      var url = URL.createObjectURL(blob); var a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      api.toast("Exported " + rows.length + " notes to " + name + ".", "ok");
    } catch (e) { api.toast("The browser refused the download: " + e.message, "bad"); }
  }

  window.SCENES.notes = { title: "Notes", render: render };
})();
