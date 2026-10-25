/* Scene: claim. The per-claim page: a shared header (patient, case, payer, money, status, clocks,
   assignee, the life-cycle strip) and the sub-views Overview, Prepare, Scrub, File and Track.
   #claim/<seq>/<sub> for ledger, denial and idr is delegated to window.CLAIM_VIEWS[sub] when another
   scene has registered it (payments, denials, idr), otherwise a "being built" panel shows.
   State changes go through api.state.T only; scene UI state (typed text, local choices) lives in UI. */
(function () {
  "use strict";
  window.SCENES = window.SCENES || {};
  window.CLAIM_VIEWS = window.CLAIM_VIEWS || {};

  // per-claim scene state the store does not own (keyed by seq); rebuilt from here on every render
  var UI = { auth: {}, dx: {}, npi: {}, how: {}, noteText: {}, mentions: {}, attach: {}, fileWhy: {}, notes: {}, noteForm: {} };

  var STAGES = ["New", "Assigned", "Prepared", "Ready", "Filed", "Accepted", "Remitted", "Closed"];
  var STAGE_OF = {
    pending: 0, "new": 0, assigned: 1, prepared: 2, scrubbed: 3, rejected: 4, filed: 4,
    acknowledged: 5, awaiting: 5, refiled: 5, appealed: 5, negotiating: 5, idr_due: 5, idr_sent: 5,
    paid: 6, partial: 6, denied: 6, recoup: 6, idr_decided: 6, secondary: 6, statement: 6, closed: 7
  };
  // one-line explanation per check title: what the Fix button did (the module does the real edit)
  var FIXES = {
    "Patient and insured": "Subscriber id and DOB corrected from the eligibility (271) response",
    "Payer": "Payer id matched to the clearinghouse payer list",
    "Diagnosis codes": "Diagnosis pointer added to every service line",
    "Service lines": "Missing modifier added (26 for the professional read, TC for the technical part)",
    "Rendering provider NPI": "Rendering NPI set on every line from the provider roster",
    "Box 33 entity": "Box 33 entity confirmed"
  };
  var REJECT_REASON = "277CA: subscriber id does not match the payer's record";

  function payerWords(c) { return c.payerClass === "oon" ? "out-of-network" : c.payerClass === "government" ? "government" : c.payerClass === "inn" ? "in-network" : "other"; }
  function isOngoing(api, c) { return api.state.statusInfo(c).list === "ongoing"; }
  function wasFiled(c) { return !!c.filedOn || ["filed", "rejected"].indexOf(c.status) >= 0; }
  function arr(o, k) { o[k] = o[k] || []; return o[k]; }
  function clearNote(seq) { UI.noteText[seq] = ""; UI.mentions[seq] = []; delete UI.noteForm[seq]; }
  // scene-local Notes state: the list filters and the Add note form (the store owns the notes themselves)
  function noteFilters(seq) { return UI.notes[seq] || (UI.notes[seq] = { type: "", showSys: true, showDel: false, q: "" }); }
  function noteForm(seq, api) { return UI.noteForm[seq] || (UI.noteForm[seq] = { type: "General Billing Notes", date: api.state.TODAY, corr: "", follow: "", priv: "", file: "" }); }

  // ----------------------------------------------------------------------------------- the scene
  function render(root, api, r) {
    var C = api.components, ST = api.state, esc = api.esc, L = api.label;
    var seq = Number(r.parts[1]); var c = ST.claim(seq); var sub = r.parts[2] || "overview";
    if (!c) { root.innerHTML = C.panel("No such claim", '<p>Claim <code>' + esc(r.parts[1]) + '</code> is not in this demo. <a href="#worklist/new">' + esc(L("back")) + ' to ' + esc(L("new")) + '</a>.</p>'); return; }

    var own = { overview: overview, prepare: prepare, scrub: scrub, file: fileView, track: track };
    var html = '<div class="claim-scene"><style>' +
      '.claim-scene .lines input { width: 62px; } .claim-scene .lines input.wide { width: 90px; }' +
      '.claim-scene .head .kv { flex: 1; } .claim-scene .notes li { padding: 6px 0; border-bottom: 1px solid var(--line); } .claim-scene .notes li:last-child { border-bottom: 0; }' +
      '.claim-scene .mentions { margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; } .claim-scene .inline { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }' +
      '.claim-scene .choice { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; } .claim-scene .choice label { display: flex; gap: 6px; align-items: center; }' +
      // the Notes panel (legacy Billing_Notes): first-read surface, so it is not sticky like the other side panels
      '.claim-scene #cl-notes-panel .panel { position: static; } .claim-scene .notes li.note { display: block; padding: 8px 0; }' +
      '.claim-scene .note-head { display: flex; gap: 6px; flex-wrap: wrap; align-items: baseline; margin-bottom: 3px; } .claim-scene .note-head .who { margin-left: auto; font-size: 12px; color: var(--muted); }' +
      '.claim-scene .note-text { white-space: pre-wrap; } .claim-scene .note-line { font-size: 12px; color: var(--muted); margin-top: 3px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }' +
      '.claim-scene .marker { display: inline-block; font-size: 10.5px; text-transform: uppercase; letter-spacing: .4px; padding: 0 6px; border: 1px solid var(--line2); color: var(--muted); border-radius: 4px; } .claim-scene .marker.sys { border-color: var(--info); color: var(--info); background: var(--info-bg); }' +
      '.claim-scene .chip { display: inline-flex; gap: 4px; align-items: center; font-size: 12px; padding: 1px 8px; border: 1px solid var(--line2); border-radius: 10px; background: var(--paper); cursor: pointer; color: var(--ink); } .claim-scene .chip:hover { border-color: var(--brand-2); color: var(--brand-2); } .claim-scene .chip.at { background: var(--accent); color: var(--brand); border-color: var(--accent); cursor: default; }' +
      '.claim-scene .note-private { margin-top: 6px; padding: 6px 8px; background: var(--warn-bg); border-left: 3px solid var(--warn); white-space: pre-wrap; } .claim-scene .note-private .ttl { font-size: 11px; color: var(--warn); font-weight: 650; display: block; margin-bottom: 2px; }' +
      '.claim-scene .note-lock { color: var(--muted); font-size: 12px; margin-top: 4px; font-style: italic; } .claim-scene li.note.deleted { opacity: .55; } .claim-scene li.note.deleted .note-text { text-decoration: line-through; }' +
      '.claim-scene .note-filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; } .claim-scene .note-filters input[type=text] { flex: 1; min-width: 120px; } .claim-scene .note-filters label.chk { margin-right: 0; font-size: 12px; }' +
      '.claim-scene .note-form h3 { margin: 12px 0 6px; } .claim-scene .note-form .form textarea { min-height: 64px; } .claim-scene .note-form .form label { min-width: 0; } .claim-scene .note-form .form input, .claim-scene .note-form .form select, .claim-scene .note-form .form textarea { width: 100%; min-width: 0; box-sizing: border-box; } .claim-scene .note-filters select { max-width: 100%; }' +
      '</style>' + header(c, api, r.parts[2] === "overview" ? "notes" : sub) + '<div id="claim-sub">';
    html += own[sub] ? own[sub](c, api) : '';
    html += '</div></div>';
    root.innerHTML = html;
    var wrap = root.firstElementChild; var box = wrap.querySelector("#claim-sub");

    if (!own[sub]) {
      if (typeof window.CLAIM_VIEWS[sub] === "function") { try { window.CLAIM_VIEWS[sub](box, api, c, r); } catch (err) { console.error(err); box.innerHTML = C.panel("This part hit an error", '<pre>' + esc(err && err.stack || err) + '</pre>'); } }
      else box.innerHTML = C.panel("This part is being built", '<p>The <b>' + esc(sub) + '</b> view for this claim is another scene\'s work and is not in this build yet. <a href="#claim/' + c.seq + '">' + esc(L("back")) + ' to the claim</a>.</p>');
    }

    // listeners live on the wrapper, which dies with the next render (no stacking)
    wrap.addEventListener("click", function (ev) { onClick(ev, root, api, r, c); });
    wrap.addEventListener("change", function (ev) { onChange(ev, root, api, r, c); });
    var ta = wrap.querySelector("#cl-note");
    if (ta) {
      ta.addEventListener("input", function () { UI.noteText[c.seq] = ta.value; mentionBox(wrap, api, c, ta); });
      ta.addEventListener("keyup", function () { mentionBox(wrap, api, c, ta); });
    }
    var pv = wrap.querySelector("#cl-note-private");
    if (pv) pv.addEventListener("input", function () { noteForm(c.seq, api).priv = pv.value; });
    var q = wrap.querySelector("#cl-nf-q");
    if (q) q.addEventListener("input", function () { noteFilters(c.seq).q = q.value; var l = wrap.querySelector("#cl-notes-list"); if (l) l.innerHTML = notesListHtml(c, api); });
    var kb = function (id, act) { var el = wrap.querySelector(id); if (el) el.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); doAct(act, el, root, api, r, c); } }); };
    kb("#cl-auth", "cl-auth-save"); kb("#cl-dx", "cl-dx-add");
    // the Notes tab is an anchor into the overview (#claim/<seq>/overview): same route, scrolled to the panel
    if (r.parts[2] === "overview") setTimeout(function () { var p = wrap.querySelector("#cl-notes-panel"); if (!p) return; var y = p.getBoundingClientRect().top + window.pageYOffset - 72; window.scrollTo({ top: y > 0 ? y : 0, behavior: "smooth" }); }, 0);
  }

  // ----------------------------------------------------------------------------------- header
  function header(c, api, sub) {
    var C = api.components, ST = api.state, esc = api.esc, L = api.label, fmt = api.fmt;
    var list = isOngoing(api, c) ? "ongoing" : "new";
    var ck = ST.filingClock(c);
    var clockHtml = wasFiled(c) && c.filedOn ? esc("Filed " + fmt.date(c.filedOn) + ", " + ST.daysBetween(c.dos, c.filedOn) + " days after DOS") : C.clock(ck) + ' <span class="sub">' + (ck.left < 0 ? "limit passed" : "to the filing limit") + '</span>';
    var who = c.assignee ? C.avatar(c.assignee) + ' ' + esc(ST.user(c.assignee).name) : '<span class="sub">Unassigned</span>';
    var h = '<div class="toolbar"><a href="#worklist/' + list + '">&larr; ' + esc(L("back")) + ' to ' + esc(L(list)) + '</a><span class="spacer"></span><span class="sub">Claim ' + c.seq + ' &middot; ' + esc(c.caseType) + ' &middot; ' + esc(c.tracklong) + '</span></div>';
    h += '<h1>' + esc(c.pat) + ' ' + C.statusPill(c) + (c.isNew ? ' <span class="badge-new">new</span>' : '') + '</h1>';
    h += '<div class="card head"><div class="row">' +
      C.kv([[L("patient"), c.pat], ["DOB", fmt.date(c.dob) + " (" + c.sex + ")"], ["DOS", fmt.date(c.dos)], ["Facility", c.hosp + ", " + c.state], ["Surgeon", c.surgfull || c.surg]]) +
      C.kv([["Case", c.caseType + ", " + c.procedure], ["Track", c.tracklong + " (" + c.track + ")"], [L("payer"), esc(c.payer) + ' <span class="sub">' + payerWords(c) + '</span>', true], ["Member id", c.member], ["Insurance type", c.instype]]) +
      C.kv([["Billed", fmt.money(c.billed)], [L("status"), C.statusPill(c), true], [L("clock"), clockHtml, true], [L("biller"), who + ' ' + C.btn(c.assignee ? "Reassign" : "Assign", "cl-assign", null, "sm"), true], [L("box33"), esc(c.entity) + ' ' + C.confirmChip(c), true]]) +
      '</div>' + steps(c) + '</div>';
    var tabs = [
      { key: "overview", href: "#claim/" + c.seq, label: "Overview" },
      { key: "notes", href: "#claim/" + c.seq + "/overview", label: "Notes", count: ST.notesFor(c).length },
      { key: "prepare", href: "#claim/" + c.seq + "/prepare", label: "Prepare" },
      { key: "scrub", href: "#claim/" + c.seq + "/scrub", label: "Scrub", count: c.ok + "/" + c.of },
      { key: "file", href: "#claim/" + c.seq + "/file", label: L("file") },
      { key: "track", href: "#claim/" + c.seq + "/track", label: "Track" }
    ];
    if (list === "ongoing") {
      tabs.push({ key: "ledger", href: "#claim/" + c.seq + "/ledger", label: "Ledger", count: (c.ledger || []).length });
      if (["denied", "partial", "recoup", "appealed", "refiled"].indexOf(c.status) >= 0 || (c.fin && c.fin.code)) tabs.push({ key: "denial", href: "#claim/" + c.seq + "/denial", label: "Denial" });
      if (c.payerClass === "oon") tabs.push({ key: "idr", href: "#claim/" + c.seq + "/idr", label: "IDR" });
    }
    return h + C.tabs(tabs, sub);
  }
  function steps(c) {
    var idx = STAGE_OF[c.status] != null ? STAGE_OF[c.status] : 0;
    return '<div class="steps">' + STAGES.map(function (s, i) { return '<div class="step' + (i < idx ? ' done' : i === idx ? ' on' : '') + '" title="' + s + '">' + s + '</div>'; }).join("") + '</div>';
  }

  // ----------------------------------------------------------------------------------- overview
  function linesGrid(c, api, editable) {
    var C = api.components, esc = api.esc, fmt = api.fmt;
    var cols = [
      { key: "n", label: "Line", cls: "num" },
      { key: "cpt", label: "CPT", cls: "mono", render: function (l) { return '<b>' + esc(l.cpt) + '</b>'; } },
      { key: "mods", label: "Mod", render: function (l) { return editable ? '<input data-line="' + (l.n - 1) + '" data-field="mods" value="' + esc(l.mods) + '" title="Modifier; change and leave the field to save">' : esc(l.mods); } },
      { key: "frm", label: "Dates", render: function (l) { return fmt.date(l.frm) + (l.to !== l.frm ? " to " + fmt.date(l.to) : ""); } },
      { key: "pos", label: "POS", cls: "num" },
      { key: "units", label: "Units", cls: "num", render: function (l) { return editable ? '<input type="number" min="1" data-line="' + (l.n - 1) + '" data-field="units" value="' + esc(l.units) + '" title="Units; change and leave the field to save">' : esc(l.units); } },
      { key: "charge", label: "Charge", cls: "num", render: function (l) { return fmt.money(l.charge); } },
      { key: "ptr", label: "Dx ptr", render: function (l) { return esc(l.ptr); } },
      { key: "changed", label: "", render: function (l) { return l.changed ? C.pill("changed", "prep") : ""; } }
    ];
    return '<div class="lines">' + C.grid({ columns: cols, rows: c.lines, empty: "No service lines." }) + '</div>';
  }
  function dxHtml(c, api) {
    var C = api.components, esc = api.esc;
    var all = c.dx.concat(UI.dx[c.seq] || []);
    return all.map(function (d, i) { return C.pill(String.fromCharCode(65 + i) + "  " + d, i >= c.dx.length ? "prep" : "") ; }).join(" ") + (UI.dx[c.seq] && UI.dx[c.seq].length ? ' <span class="sub">(added this session, not yet on the claim record)</span>' : '') + (all.length ? '' : '<span class="sub">none</span>');
  }
  function overview(c, api) {
    var C = api.components, ST = api.state, esc = api.esc, L = api.label, fmt = api.fmt;
    var left = C.panel("Service lines", linesGrid(c, api, false) + '<p class="sub">Total billed ' + esc(fmt.money(c.billed)) + ' on ' + c.lines.length + ' lines. Edit lines under <a href="#claim/' + c.seq + '/prepare">Prepare</a>.</p>', esc(c.lines.length + " lines"));
    left += C.panel("Diagnosis codes", dxHtml(c, api), "ICD-10");
    left += C.panel(L("readiness"), C.checks(c) + (c.ok < c.of ? '<p><a href="#claim/' + c.seq + '/scrub">Fix the open checks under Scrub</a></p>' : ''), esc(c.ok + " of " + c.of + " green"));
    var ent = (api.data.entities || []).find(function (e) { return e.name === c.entity; });
    left += C.panel(L("box33") + " (billing entity)", '<div class="inline"><b>' + esc(c.entity) + '</b> ' + C.confirmChip(c) + ' ' + C.btn("Change", "cl-entity", null, "sm") + '</div>' +
      '<p class="sub">' + (ent ? 'NPI ' + esc(ent.npi) + ', ' + esc(ent.city + ", " + ent.st) + '. ' : '') + 'Chosen by the billing rule for ' + esc(c.payer) + ' (' + payerWords(c) + ', ' + esc(c.track) + '). This is where the money goes; confirm before filing.</p>');

    var side = notesPanel(c, api);
    var hist = (c.history || []).slice().reverse();
    side += C.panel("History", '<ul class="history">' + hist.map(function (e) { return '<li>' + esc(e.text) + '<span class="sub">' + esc(fmt.date(e.date)) + ' &middot; ' + esc(ST.user(e.who).name) + ' &middot; ' + esc(e.kind) + '</span></li>'; }).join("") + '</ul>', esc(hist.length + " events"));
    return '<div class="row"><div>' + left + '</div><div class="side">' + side + '</div></div>';
  }

  // ----------------------------------------------------------------------------------- prepare
  function eligibility(c) {
    var ded = [1500, 2500, 3000, 5000][c.seq % 4]; var met = Math.round(ded * ((c.seq % 5) + 1) / 6 / 10) * 10;
    return { ded: ded, met: met, text: "Active, deductible met $" + met.toLocaleString() + " of $" + ded.toLocaleString() };
  }
  function prepare(c, api) {
    var C = api.components, ST = api.state, esc = api.esc, fmt = api.fmt;
    var el = eligibility(c); var ongoing = isOngoing(api, c);
    var canPrepare = ["assigned", "new", "rejected"].indexOf(c.status) >= 0;
    var h = C.banner(api.data.illustrative);
    var left = C.card("Eligibility (270/271)", C.kv([["Result", C.pill(el.text, "ready"), true], ["Checked", fmt.date(ST.TODAY) + " against " + c.payer], ["Coverage", c.instype + ", " + payerWords(c) + (c.payerClass === "oon" ? "; open negotiation and IDR apply if the payer short pays" : c.payerClass === "government" ? "; strict filing limit, no IDR path" : "; contracted rate")]]) +
      '<div class="inline" style="margin-top:8px">' + C.btn("Re-check eligibility", "cl-elig", null, "sm") + '<span class="sub">illustrative: the module asks the clearinghouse and keeps the 271</span></div>');
    var auth = UI.auth[c.seq] || c.authNo;
    left += C.card("Insurance type and authorization", C.kv([["Insurance type", c.instype], ["Relationship", c.rel === "SE" ? "Self" : c.rel], ["Authorization", auth ? auth + (UI.auth[c.seq] ? " (added this session)" : " (on file)") : "none on file"]]) +
      '<div class="inline" style="margin-top:8px"><input id="cl-auth" placeholder="Add authorization number" value="">' + C.btn("Save", "cl-auth-save", null, "sm") + '<span class="sub">kept for this session; the module writes it to the claim</span></div>');
    left += C.card("Diagnosis codes", dxHtml(c, api) + '<div class="inline" style="margin-top:8px"><input id="cl-dx" placeholder="Add ICD-10 code, e.g. G95.9">' + C.btn("Add", "cl-dx-add", null, "sm") + '</div>');
    left += C.card("Service lines", linesGrid(c, api, !ongoing) + '<p class="sub">' + (ongoing ? "Filed; lines are read-only here. Corrections go through a refiled claim." : "Modifier and units are editable; a change saves when you leave the field and marks the line changed.") + '</p>');
    var on = ST.get().addons.codingAssist;
    var sugg = (c.suggestions || []);
    left += C.card("Coding Assist (missed codes)", !on ? '<p class="sub">Coding Assist is switched off under Settings, Add-ons.</p>' : sugg.length ? sugg.map(function (s, i) {
      return '<div class="ai" style="margin-bottom:8px"><b>Line ' + s.line + ': ' + esc(s.cpt) + '</b> suggested in place of ' + esc((c.lines[s.line - 1] || {}).cpt || "") + '<br>' + esc(s.why) + '<br><span class="sub">' + esc(s.source) + '</span><div class="inline" style="margin-top:6px">' +
        (s.decided ? C.pill(s.decided === "accepted" ? "Accepted" : "Declined", s.decided === "accepted" ? "paid" : "closed") : C.btn("Accept", "cl-sugg", { idx: i, accept: "1" }, "sm primary") + C.btn("Decline", "cl-sugg", { idx: i, accept: "0" }, "sm")) + '</div></div>';
    }).join("") : '<p class="sub">No suggestions for this claim. Coding Assist reads the Tech and monitoring reports and flags codes the surgeon\'s note supports but the claim does not carry.</p>');

    var ent = (api.data.entities || []).find(function (e) { return e.name === c.entity; });
    var rendNpi = "1" + String(700000000 + (c.seq % 299999999)).slice(0, 9);
    var npiChoice = UI.npi[c.seq] || "rendering";
    var right = C.card("Rendering provider NPI", '<select id="cl-npi"><option value="rendering"' + (npiChoice === "rendering" ? ' selected' : '') + '>Rendering provider on the lines: ' + rendNpi + ' (' + esc(c.track === "Pro" ? "reading physician" : "technologist group") + ')</option>' + (ent ? '<option value="group"' + (npiChoice === "group" ? ' selected' : '') + '>Billing entity (Box 33): ' + esc(ent.npi) + ' ' + esc(ent.name) + '</option>' : '') + '</select><p class="sub">Box 24J on every line. Illustrative NPIs; the module takes them from the provider roster.</p>');
    var att = [["Operative note", "ok", "attached, from legacy"], ["Monitoring report (" + c.track + ")", "ok", "attached, from the case file"]].concat((UI.attach[c.seq] || []).map(function (a) { return [a, "ok", "attached this session"]; }));
    right += C.card("Attachments", '<ul class="checks">' + att.map(function (a) { return '<li class="' + a[1] + '"><b>' + esc(a[0]) + '</b><span class="sub">' + esc(a[2]) + '</span></li>'; }).join("") + '</ul><div style="margin-top:8px">' + C.btn("Attach a document", "cl-attach", null, "sm") + '</div>');
    right += C.card("When this is done", '<p class="sub">' + (canPrepare ? "Mark the claim prepared, then run the scrub. The checks on the right of the worklist fill as you go." : ongoing ? "This claim is filed; Prepare is read-only." : "Already prepared. Go on to Scrub.") + '</p>' +
      '<div class="inline">' + (canPrepare ? C.btn("Mark prepared", "cl-prepare", null, "primary") : '<button type="button" class="btn primary" disabled title="' + (ongoing ? "Already filed" : "Already marked prepared; next is Scrub") + '">Mark prepared</button>') + ' ' + C.btn("Go to Scrub", "cl-go", { to: "scrub" }, "") + '</div>');
    return h + '<div class="row"><div>' + left + '</div><div class="side">' + right + '</div></div>';
  }

  // ----------------------------------------------------------------------------------- scrub
  function scrub(c, api) {
    var C = api.components, esc = api.esc; var ongoing = isOngoing(api, c);
    var items = c.checks.map(function (x, i) {
      var fix = x[1] === "ok" || ongoing ? '' : (i === 5 ? C.btn("Confirm", "cl-fix", { idx: i }, "sm primary") : C.btn("Fix", "cl-fix", { idx: i }, "sm primary"));
      return '<li class="' + x[1] + '" data-idx="' + i + '"><b>' + esc(x[0]) + '</b><span class="sub">' + esc(x[2]) + (x[1] !== "ok" ? '<br>Fix: ' + esc(FIXES[x[0]] || "corrected by the biller") : '') + '</span>' + fix + '</li>';
    }).join("");
    var open = c.checks.filter(function (x) { return x[1] !== "ok"; }).map(function (x) { return x[0]; });
    var body = '<ul class="checks">' + items + '</ul>' +
      '<div class="inline" style="margin-top:12px">' + (ongoing ? '<button type="button" class="btn primary" disabled title="Already filed on ' + esc(api.fmt.date(c.filedOn)) + '">Run scrub</button>' : C.btn("Run scrub", "cl-scrub", null, "primary")) +
      '<span class="sub">' + (ongoing ? "Filed; the scrub ran before filing." : open.length ? "Open: " + esc(open.join(", ")) + ". Fix each one, then run the scrub." : "Everything is green. Run the scrub to mark the claim ready to file.") + '</span></div>';
    return C.panel("Scrub: the six checks before filing", body, esc(c.ok + " of " + c.of + " green")) +
      (c.status === "rejected" ? C.panel("Rejected by the clearinghouse", '<p>' + esc(c.rejectReason || REJECT_REASON) + '</p><p class="sub">Fix the check it opened, run the scrub, and refile.</p>') : '');
  }

  // ----------------------------------------------------------------------------------- file
  function fileView(c, api) {
    var C = api.components, ST = api.state, esc = api.esc, L = api.label, fmt = api.fmt;
    var chs = api.data.clearinghouses || []; var ch = chs[0] || { name: "Clearinghouse", status: "", last: "" }; var paper = chs.find(function (x) { return x.kind === "print"; }) || { name: "Paper (CMS-1500 print)", status: "ready" };
    if (wasFiled(c) && c.filedOn) {
      var how = c.filedHow || "837";
      var rec = C.card("Filing record", C.kv([["Filed", fmt.date(c.filedOn) + " (" + ST.daysBetween(c.filedOn, ST.TODAY) + " days ago)"], ["How", how === "paper" ? "Paper, CMS-1500 printed" : "Electronic, 837" + (c.track === "Pro" ? "P" : "P") ], ["Batch", c.batch || "legacy batch"], ["Through", how === "paper" ? paper.name : ch.name], ["Payer", c.payer + " (" + c.payerid + ")"]]));
      var ack;
      if (c.status === "filed") ack = C.card("Acknowledgement", '<p>Waiting for the 999 (file accepted) and the 277CA (claim accepted or rejected) from ' + esc(ch.name) + '. In the module these arrive on their own; here you pick the outcome.</p><div class="inline">' + C.btn("Simulate: accepted (999/277CA clean)", "cl-ack-ok", null, "primary") + C.btn("Simulate: rejected", "cl-ack-bad", null, "danger") + '</div>');
      else if (c.status === "rejected") ack = C.card("Acknowledgement: rejected", C.pill("Rejected by clearinghouse", "denied") + '<p>' + esc(c.rejectReason || REJECT_REASON) + '</p><p class="sub">The claim is back in ' + esc(L("new")) + '. Fix it under Prepare and Scrub, then file again.</p>' + C.btn("Fix and refile", "cl-go", { to: "prepare" }, "primary"));
      else ack = C.card("Acknowledgement: accepted", C.pill("Accepted by payer", "filed") + ' <span class="sub">999 and 277CA clean' + (c.ackOn ? ", " + esc(fmt.date(c.ackOn)) : "") + '</span><p><b>Moved to ' + esc(L("ongoing")) + '.</b> From here the claim is tracked for the remittance. <a href="#worklist/ongoing">Open ' + esc(L("ongoing")) + '</a> or <a href="#claim/' + c.seq + '/track">track this claim</a>.</p>');
      return '<div class="row"><div>' + rec + '</div><div class="side">' + ack + '</div></div>';
    }
    var sel = UI.how[c.seq] || "837";
    var batch = "B-" + ST.TODAY.replace(/-/g, "").slice(2) + "-" + (1 + (c.seq % 7));
    var ready = c.confirmed && c.ok === c.of;
    var choice = '<div class="choice"><label><input type="radio" name="cl-how" value="837"' + (sel === "837" ? ' checked' : '') + '> Electronic (837) through the clearinghouse</label><label><input type="radio" name="cl-how" value="paper"' + (sel === "paper" ? ' checked' : '') + '> Paper (CMS-1500 print)</label></div>';
    var route = sel === "837" ? C.kv([["Clearinghouse", ch.name], ["Connection", ch.kind + (ch.host ? ", " + ch.host : "") + ", " + ch.status + (ch.last ? ", last " + ch.last : "")], ["Batch", batch + " (today's batch for this payer group)"], ["Payer", c.payer + " (" + c.payerid + ")"]]) : C.kv([["Output", paper.name], ["Batch", batch + " (print run)"], ["Mail to", c.payer + ", address from the payer record"], ["Why paper", paper.note || "For payers that do not accept 837"]]);
    var why = UI.fileWhy[c.seq];
    var body = choice + route + (why ? '<p><b>Cannot file:</b> ' + esc(why) + ' <a href="#claim/' + c.seq + '/scrub">Go to Scrub</a>.</p>' : '') +
      '<div class="inline" style="margin-top:12px">' + C.btn(L("file"), "cl-file", null, "primary") + '<span class="sub">' + (ready ? "Box 33 confirmed and every check green." : "The store refuses until Box 33 is confirmed and every check is green (" + c.ok + " of " + c.of + " now).") + '</span></div>';
    return '<div class="row"><div>' + C.panel(L("file") + ": how this claim goes out", body) + '</div><div class="side">' + C.card("What happens next", '<ol class="sub" style="margin:0;padding-left:18px"><li>The claim joins the batch and goes out through ' + esc(sel === "837" ? ch.name : "the print run") + '.</li><li>The 999 says the file was accepted; the 277CA says the claim was accepted or rejected.</li><li>Accepted: the claim moves to ' + esc(L("ongoing")) + '. Rejected: it comes back to ' + esc(L("new")) + ' with the reason.</li></ol>') + '</div></div>';
  }

  // ----------------------------------------------------------------------------------- track
  function status277(c, api) {
    var fmt = api.fmt; var code = c.fin && c.fin.code ? " " + c.fin.code : "";
    switch (c.status) {
      case "filed": return "277CA, A1: claim acknowledged by the clearinghouse and forwarded to " + c.payer + ".";
      case "acknowledged": case "awaiting": return "277, P1: pending adjudication at " + c.payer + (c.ackOn ? " since " + fmt.date(c.ackOn) : "") + ". No remittance yet.";
      case "paid": return "277, F1: finalized and paid" + (c.fin && c.fin.last_remit ? " on " + fmt.date(c.fin.last_remit) : "") + ". See the ledger.";
      case "partial": return "277, F2: finalized, one line denied" + code + ". The rest paid.";
      case "denied": return "277, F2: finalized and denied" + code + ".";
      case "recoup": return "277, F3R: an earlier payment was taken back on a later remittance.";
      case "refiled": return "277CA, A1: corrected claim (frequency 7) received and forwarded.";
      case "appealed": return "277, P3: appeal under review; the payer has the records.";
      case "negotiating": case "idr_due": case "idr_sent": case "idr_decided": return "277, F1: finalized at the payer's rate. The dispute runs outside the 277 (open negotiation or IDR).";
      case "secondary": return "277, P1: pending at the secondary payer.";
      case "statement": return "No payer status; the remaining balance is with the patient.";
      case "closed": return "Closed; nothing to check.";
    }
    return "Not filed yet; a 276 would return nothing.";
  }
  function track(c, api) {
    var C = api.components, ST = api.state, esc = api.esc, fmt = api.fmt, L = api.label;
    var ongoing = isOngoing(api, c); var t = ST.totals(c);
    var h = C.banner(api.data.illustrative);
    var aging = c.filedOn ? C.kv([["Filed", fmt.date(c.filedOn)], ["Aging since filed", fmt.days(ST.daysBetween(c.filedOn, ST.TODAY))], ["Since DOS", fmt.days(ST.daysBetween(c.dos, ST.TODAY))], ["Last remit", c.fin && c.fin.last_remit ? fmt.date(c.fin.last_remit) : "none yet"]]) : C.kv([["Filed", "not yet"], ["Since DOS", fmt.days(ST.daysBetween(c.dos, ST.TODAY))], ["Next", "finish Prepare and Scrub, then " + L("file")]]);
    var fck = ST.filingClock(c), ack = ST.appealClock(c), nck = ST.negotiationClock(c);
    var clocks = [["Filing limit", (c.filedOn ? esc("filed " + fmt.date(c.filedOn) + "; ") : "") + C.clock(fck) + ' <span class="sub">' + (ST.get().settings.filingLimit || 90) + ' days from DOS</span>', true]];
    if (ack) clocks.push(["Appeal", C.clock(ack) + ' <span class="sub">180 days from the last remit</span>', true]);
    if (nck) clocks.push(["Open negotiation", C.clock(nck) + ' <span class="sub">ends ' + esc(fmt.date(nck.endsOn)) + '; IDR window to ' + esc(fmt.date(nck.idrDeadline)) + ' (' + nck.idrLeft + ' days)</span>', true]);
    if (c.payerClass === "government") clocks.push(["IDR", '<span class="sub">no IDR path for ' + esc(c.instype) + '</span>', true]);
    var left = C.card("Aging", aging) + C.card("Clocks", C.kv(clocks));
    var dis = function (text, why, cls) { return '<button type="button" class="btn ' + (cls || "") + '" disabled title="' + esc(why) + '">' + esc(text) + '</button>'; };
    var canSecondary = ["paid", "idr_decided"].indexOf(c.status) >= 0, canStatement = ["paid", "idr_decided", "secondary"].indexOf(c.status) >= 0;
    var acts = '<div class="inline">' +
      (ongoing ? C.btn("Check claim status (276/277)", "cl-status", null, "sm") : dis("Check claim status (276/277)", "Not filed yet", "sm")) +
      C.btn("Request records", "cl-records", null, "sm") +
      (canSecondary ? C.btn("Bill secondary", "cl-secondary", null, "sm") : dis("Bill secondary", c.status === "secondary" ? "Secondary already billed on " + fmt.date(c.secondaryBilled) : "Available once the primary has paid (or IDR decided)", "sm")) +
      (canStatement ? C.btn("Send patient statement", "cl-statement", null, "sm") : dis("Send patient statement", c.status === "statement" ? "Statement sent " + fmt.date(c.statementOn) : "Available once the payers have paid", "sm")) +
      (c.status === "closed" ? C.btn("Reopen", "cl-reopen", null, "sm") : C.btn("Close claim", "cl-close", null, "sm danger")) + '</div>' +
      '<p class="sub" style="margin-top:8px">' + esc(ST.nextAction(c).label ? "Next: " + ST.nextAction(c).label : "Closed: " + (c.closedReason || "")) + (c.closedOn ? " (" + fmt.date(c.closedOn) + ")" : "") + '</p>';
    left += C.card("Actions", acts);
    var right = C.card("Totals", C.kv([["Billed", fmt.money(t.billed)], ["Collected", fmt.money(t.collected)], ["Recoupment", t.recoupment ? fmt.money(t.recoupment) : "none"], ["Write-off", t.writeoff ? fmt.money(t.writeoff) : "none"], [L("balance"), '<b>' + esc(fmt.money(t.balance)) + '</b>', true]]) + (ongoing ? '<p class="sub"><a href="#claim/' + c.seq + '/ledger">Open the ledger</a></p>' : ''));
    if (c.idr) right += C.card("IDR", C.kv([["Sent", fmt.date(c.idr.sentOn)], ["Our offer", fmt.money(c.idr.offer)], ["Payer offer", fmt.money(c.idr.payerOffer)], ["Award", c.idr.award != null ? fmt.money(c.idr.award) : "pending"]]) + '<p class="sub"><a href="#claim/' + c.seq + '/idr">Open IDR</a></p>');
    return h + '<div class="row"><div>' + left + '</div><div class="side">' + right + '</div></div>';
  }

  // ----------------------------------------------------------------------------------- notes (legacy Billing_Notes): the first-read surface
  // Machine-written rows legacy kept in Billing_Notes (clearinghouse responses, remits). Read from claim.history, never written to the store.
  var SYS_KINDS = { filed: "Clearinghouse", acknowledged: "Clearinghouse", rejected: "Clearinghouse", remit: "Remittance", posted: "Remittance", denied: "Remittance" };
  function sysText(e) {
    if (e.kind === "acknowledged") return "Clearinghouse accepted the claim (999 and 277CA clean)";
    if (e.kind === "filed") return "Claim sent (837). " + e.text;
    return e.text;
  }
  function systemNotes(c) {
    var stored = c.notes || [];
    return (c.history || []).map(function (e, i) {
      if (!SYS_KINDS[e.kind]) return null;
      var text = sysText(e);
      var dup = stored.some(function (n) { return !n.deleted && (n.note === text || (n.source === "system" && n.date === e.date && n.note === e.text)); });
      if (dup) return null;
      return { id: "h" + i, date: e.date, createdAt: e.date + " 00:00:00", type: SYS_KINDS[e.kind], note: text, privateNote: "", correspondenceDate: null, attachment: "", who: "system", source: "system", followUp: null, deleted: false, virtual: true };
    }).filter(Boolean);
  }
  function visibleNotes(c, api) {
    var ST = api.state, f = noteFilters(c.seq), priv = ST.canSeePrivate();
    var rows = ST.notesFor(c, { includeDeleted: priv && f.showDel });
    if (f.showSys) rows = rows.concat(systemNotes(c));
    if (f.type) rows = rows.filter(function (n) { return n.type === f.type; });
    var q = (f.q || "").trim().toLowerCase();
    if (q) rows = rows.filter(function (n) { return [n.note, n.privateNote, n.type, n.attachment, ST.user(n.who || n.source).name].join(" ").toLowerCase().indexOf(q) >= 0; });
    return rows.sort(function (a, b) { var ka = (a.date || "") + " " + (a.createdAt || ""), kb = (b.date || "") + " " + (b.createdAt || ""); return ka < kb ? 1 : ka > kb ? -1 : 0; });
  }
  function noteRow(n, c, api) {
    var C = api.components, ST = api.state, esc = api.esc, fmt = api.fmt;
    var author = ST.user(n.who || n.source).name;
    var created = (n.createdAt || "").slice(0, 10);
    var h = '<li class="note' + (n.deleted ? ' deleted greyed' : '') + (n.source === "system" ? ' sys' : '') + '" data-id="' + esc(n.id) + '">';
    h += '<div class="note-head">' + C.pill(n.type, n.source === "system" ? "filed" : "") +
      (n.source === "system" ? '<span class="marker sys" title="Written by the system, not a person">System</span>' : n.source === "legacy" ? '<span class="marker" title="Carried over from legacy Billing_Notes">Legacy</span>' : '') +
      '<b>' + esc(fmt.date(n.date)) + '</b>' + (created && created !== n.date ? '<span class="sub" title="The biller set the note date; this is when the row was created">entered ' + esc(fmt.date(created) + (n.createdAt.length > 10 ? " " + n.createdAt.slice(11, 16) : "")) + '</span>' : '') +
      '<span class="who">' + esc(author) + '</span></div>';
    if (n.note) h += '<div class="note-text">' + esc(n.note) + '</div>';
    if (n.mentions && n.mentions.length) h += '<div class="note-line">' + n.mentions.map(function (id) { return '<span class="chip at">@' + esc(ST.user(id).name) + '</span>'; }).join("") + '</div>';
    if (n.correspondenceDate) h += '<div class="note-line">about a letter or EOB dated ' + esc(fmt.date(n.correspondenceDate)) + '</div>';
    if (n.attachment) h += '<div class="note-line"><span class="chip" data-act="cl-note-open" data-file="' + esc(n.attachment) + '" title="Open the attachment">&#128206; ' + esc(n.attachment) + '</span></div>';
    if (n.followUp) {
      var left = ST.daysBetween(ST.TODAY, n.followUp);
      h += '<div class="note-line">Follow up on ' + esc(fmt.date(n.followUp)) + (n.followUpDone ? ' <span class="sub">done' + (n.followUpDoneBy ? ' by ' + esc(ST.user(n.followUpDoneBy).name) : '') + '</span>' :
        ' ' + C.clock({ left: left, cls: left < 0 ? "over" : left <= 3 ? "late" : "ok" }) + (n.deleted ? '' : ' ' + C.btn("Done", "cl-note-fu", { id: n.id }, "sm"))) + '</div>';
    }
    if (n.privateNote) h += '<div class="note-private"><span class="ttl">Private note (supervisors and admins)</span>' + esc(n.privateNote) + '</div>';
    if (n.privateHidden) h += '<div class="note-lock">&#128274; A private note exists; your view cannot read it</div>';
    if (n.deleted) h += '<div class="note-line">Deleted by ' + esc(ST.user(n.deletedBy).name) + ' on ' + esc(fmt.date(n.deletedOn)) + ', kept in the record' + (n.deletedWhy ? ': ' + esc(n.deletedWhy) : '') + '</div>';
    if (!n.deleted && !n.virtual && ST.canSeePrivate()) h += '<div class="note-line">' + C.btn("Delete", "cl-note-del", { id: n.id }, "sm ghost") + '</div>';
    return h + '</li>';
  }
  function notesListHtml(c, api) {
    var ST = api.state, esc = api.esc, f = noteFilters(c.seq);
    var rows = visibleNotes(c, api);
    var total = ST.notesFor(c, { includeDeleted: ST.canSeePrivate() && f.showDel }).length + (f.showSys ? systemNotes(c).length : 0);
    var filtered = f.type || (f.q || "").trim();
    return (filtered ? '<p class="sub" style="margin:0 0 4px">Showing ' + rows.length + ' of ' + total + '</p>' : '') +
      '<ul class="notes">' + (rows.length ? rows.map(function (n) { return noteRow(n, c, api); }).join("") : '<li class="note"><span class="sub">' + (total ? 'No note matches the filters.' : 'No notes yet. The first note on a claim is usually the eligibility check or the filing.') + '</span></li>') + '</ul>';
  }
  function notesPanel(c, api) {
    var C = api.components, ST = api.state, esc = api.esc, fmt = api.fmt;
    var seq = c.seq, f = noteFilters(seq), form = noteForm(seq, api), priv = ST.canSeePrivate(), types = ST.noteTypes();
    var count = ST.notesFor(c).length, open = ST.openFollowUps(c).length;
    var filters = '<div class="note-filters">' +
      '<select id="cl-nf-type" title="Note type"><option value="">All types</option>' + types.map(function (t) { return '<option' + (f.type === t.type ? ' selected' : '') + '>' + esc(t.type) + '</option>'; }).join("") + '</select>' +
      '<input type="text" id="cl-nf-q" placeholder="Search notes" value="' + esc(f.q || "") + '">' +
      '<label class="chk" title="Machine-written rows: clearinghouse responses, remittances"><input type="checkbox" id="cl-nf-sys"' + (f.showSys ? ' checked' : '') + '> Show system notes</label>' +
      (priv ? '<label class="chk" title="Deleted notes stay in the record, greyed"><input type="checkbox" id="cl-nf-del"' + (f.showDel ? ' checked' : '') + '> Show deleted</label>' : '') +
      '</div>';
    var list = '<div id="cl-notes-list">' + notesListHtml(c, api) + '</div>';
    var formHtml = '<div class="note-form"><h3>Add note</h3><div class="form">' +
      '<label>Type<select id="cl-note-type">' + types.map(function (t) { return '<option value="' + esc(t.type) + '"' + (form.type === t.type ? ' selected' : '') + '>' + esc(t.type + (t.notify ? " (notifies the " + t.notify + ")" : "")) + '</option>'; }).join("") + '</select></label>' +
      '<label>Note date<input type="date" id="cl-note-date" value="' + esc(form.date) + '" title="Editable; the creation time is stamped beside it"></label>' +
      '<label class="full">Note<textarea id="cl-note" placeholder="Type a note. Use @ to mention a teammate; they get it in their inbox.">' + esc(UI.noteText[seq] || "") + '</textarea></label>' +
      '<div class="mentions full" id="cl-mentions"></div>' +
      (priv ? '<label class="full">Private note (supervisors and admins only)<textarea id="cl-note-private" placeholder="Not shown to billers or read-only views">' + esc(form.priv || "") + '</textarea></label>' : '') +
      '<label title="The date of the letter or EOB this note records">Correspondence date<input type="date" id="cl-note-corr" value="' + esc(form.corr || "") + '"></label>' +
      '<label>Follow up on<input type="date" id="cl-note-follow" value="' + esc(form.follow || "") + '"></label>' +
      '<label class="full" title="The file name only; nothing is uploaded in this demo">Attachment' + (form.file ? '<span class="inline"><span class="chip" data-act="cl-note-open" data-file="' + esc(form.file) + '">&#128206; ' + esc(form.file) + '</span>' + C.btn("Remove", "cl-note-file-clear", null, "sm ghost") + '</span>' : '<input type="file" id="cl-note-file">') + '</label>' +
      '</div><div class="inline" style="margin-top:8px">' + C.btn("Add note", "cl-note-add", null, "sm primary") + '<span class="sub">as ' + esc(ST.me().name) + '</span></div>' +
      '<p class="sub" style="margin:6px 0 0">Notes are kept, never edited; a correction is a new note.</p></div>';
    return '<div id="cl-notes-panel">' + C.panel("Notes", filters + list + formHtml, esc(count + (count === 1 ? " note" : " notes") + (open ? ", " + open + " follow-up open" : ""))) + '</div>';
  }
  function deleteNoteDialog(api, c, id) {
    var C = api.components, ST = api.state, esc = api.esc, fmt = api.fmt;
    var n = (c.notes || []).find(function (x) { return x.id === id; }); if (!n) return;
    C.dialog("Delete this note?", '<p class="sub">' + esc(n.type) + ' &middot; ' + esc(fmt.date(n.date)) + ' &middot; ' + esc(ST.user(n.who).name) + '</p><p>' + esc(n.note || n.privateNote || n.attachment) + '</p>' +
      '<div class="form"><label class="full">Reason<input type="text" id="cl-note-del-why" placeholder="Why the note comes off the list"></label></div>' +
      '<p class="sub">Legacy deleted the row and audited the delete. The module keeps the row, greyed, with who deleted it and why.</p>', [{ text: "Cancel", act: "dialog-close" }, { text: "Delete note", act: "cl-note-del-ok", cls: "danger" }]);
    var dlg = document.getElementById("dialog");
    dlg.onclick = function (ev) {
      var b = ev.target.closest("[data-act=cl-note-del-ok]"); if (!b) return;
      var why = dlg.querySelector("#cl-note-del-why").value.trim(); C.closeDialog();
      ST.T.deleteNote(c.seq, id, why); api.toast("Note deleted; the row stays in the record" + (why ? ": " + why : "") + ".", "warn");
    };
  }
  function attachmentDialog(api, file) {
    var C = api.components, esc = api.esc;
    C.dialog("Attachment", '<p><b>&#128206; ' + esc(file) + '</b></p><p class="sub">Document viewer is not part of this demo. In the module this opens the stored file (a clearinghouse response, an eligibility reply, the generated claim PDF).</p>', [{ text: "Close", act: "dialog-close" }]);
    document.getElementById("dialog").onclick = null;
  }

  // ----------------------------------------------------------------------------------- notes: @-mentions
  function mentionBox(wrap, api, c, ta) {
    var box = wrap.querySelector("#cl-mentions"); if (!box) return;
    var C = api.components, esc = api.esc, ST = api.state;
    var caret = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
    var m = ta.value.slice(0, caret).match(/(^|\s)@([A-Za-z]*)$/);
    var ids = (UI.mentions[c.seq] || []).filter(function (id) { return ta.value.indexOf("@" + ST.user(id).name) >= 0; });
    UI.mentions[c.seq] = ids;
    if (m) {
      var q = m[2].toLowerCase();
      var users = api.data.users.filter(function (u) { return u.id !== ST.me().id && (!q || u.name.toLowerCase().indexOf(q) === 0 || u.name.toLowerCase().split(" ").some(function (w) { return w.indexOf(q) === 0; })); });
      box.innerHTML = '<span class="sub">Mention:</span>' + (users.length ? users.map(function (u) { return C.btn(u.name, "cl-mention", { user: u.id }, "sm"); }).join("") : '<span class="sub">no one matches</span>');
    } else box.innerHTML = ids.length ? '<span class="sub">Will notify: ' + esc(ids.map(function (id) { return ST.user(id).name; }).join(", ")) + '</span>' : '';
  }
  function insertMention(wrap, api, c, uid) {
    var ta = wrap.querySelector("#cl-note"); if (!ta) return;
    var u = api.state.user(uid); var v = ta.value; var caret = ta.selectionStart != null ? ta.selectionStart : v.length;
    var before = v.slice(0, caret), after = v.slice(caret);
    var m = before.match(/@([A-Za-z]*)$/); if (m) before = before.slice(0, m.index);
    var head = before + "@" + u.name + " ";
    ta.value = head + after; UI.noteText[c.seq] = ta.value;
    var ids = arr(UI.mentions, c.seq); if (ids.indexOf(uid) < 0) ids.push(uid);
    ta.focus(); ta.setSelectionRange(head.length, head.length);
    mentionBox(wrap, api, c, ta);
  }

  // ----------------------------------------------------------------------------------- dialogs
  function pickDialog(api, title, intro, items, onPick) {
    var C = api.components, esc = api.esc;
    C.dialog(title, '<p class="sub">' + intro + '</p><ul class="menu-list">' + items.map(function (i) { return '<li data-act="cl-pick" data-id="' + esc(i.id) + '"' + (i.on ? ' class="on"' : '') + '>' + i.html + '</li>'; }).join("") + '</ul>', [{ text: "Cancel", act: "dialog-close" }]);
    var dlg = document.getElementById("dialog");
    dlg.onclick = function (ev) { var t = ev.target.closest("[data-act=cl-pick]"); if (!t) return; C.closeDialog(); onPick(t.getAttribute("data-id")); };
  }
  function assignDialog(api, c) {
    var C = api.components, ST = api.state, esc = api.esc;
    var billers = api.data.users.filter(function (u) { return u.role === "biller"; });
    pickDialog(api, "Assign " + esc(c.pat), "Pick the biller. The supervisor can also assign in bulk from Assignments.", billers.map(function (u) { return { id: u.id, on: u.id === c.assignee, html: C.avatar(u.id) + ' ' + esc(u.name) + ' <span class="sub">' + esc(u.team) + ' &middot; ' + ST.all().filter(function (x) { return x.assignee === u.id && ST.statusInfo(x).list === "new"; }).length + ' in New</span>' }; }), function (uid) {
      ST.T.assign(c.seq, uid); api.toast("Assigned to " + ST.user(uid).name, "ok");
    });
  }
  function entityDialog(api, c) {
    var ST = api.state, esc = api.esc, L = api.label;
    pickDialog(api, "Change the " + esc(L("box33")) + " entity", "The rule chose <b>" + esc(c.entity) + "</b> for " + esc(c.payer) + " (" + payerWords(c) + ", " + esc(c.track) + "). Picking another entity clears the confirmation; confirm again before filing.", (api.data.entities || []).map(function (e) { return { id: e.name, on: e.name === c.entity, html: '<b>' + esc(e.name) + '</b> <span class="sub">NPI ' + esc(e.npi) + ' &middot; ' + esc(e.city + ", " + e.st) + '</span>' }; }), function (name) {
      if (name === c.entity) { api.toast("Box 33 unchanged: " + name, "info"); return; }
      ST.T.setEntity(c.seq, name); api.toast("Box 33 entity changed to " + name + ". Confirm it before filing.", "warn");
    });
  }
  function closeDialog(api, c) {
    var C = api.components, ST = api.state, esc = api.esc, fmt = api.fmt; var t = ST.totals(c);
    var reasons = ["Paid in full after adjustments", "Contractual write-off, balance adjusted", "Patient balance paid", "Timely filing passed, written off", "Duplicate of another claim", "Other (see note)"];
    C.dialog("Close claim " + c.seq, '<div class="form"><label class="full">Reason<select id="cl-close-reason">' + reasons.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join("") + '</select></label><label>Write-off (optional)<input id="cl-close-wo" type="number" min="0" step="0.01" placeholder="0.00"></label><label>Open balance<input value="' + esc(fmt.money(t.balance)) + '" readonly></label></div><p class="sub">Closing keeps the ledger and history. A closed claim can be reopened.</p>', [{ text: "Cancel", act: "dialog-close" }, { text: "Close claim", act: "cl-close-ok", cls: "danger" }]);
    var dlg = document.getElementById("dialog");
    dlg.onclick = function (ev) {
      var b = ev.target.closest("[data-act=cl-close-ok]"); if (!b) return;
      var reason = dlg.querySelector("#cl-close-reason").value; var wo = Number(dlg.querySelector("#cl-close-wo").value || 0);
      C.closeDialog(); ST.T.close(c.seq, reason, wo > 0 ? wo : 0); api.toast("Closed: " + reason + (wo > 0 ? ", " + fmt.money(wo) + " written off" : ""), "ok");
    };
  }

  // ----------------------------------------------------------------------------------- events
  function onClick(ev, root, api, r, c) {
    var t = ev.target.closest("[data-act]"); if (!t) return;
    var act = t.getAttribute("data-act");
    if (act.indexOf("cl-") !== 0 && act !== "confirm") return; // the shell owns the rest (view, reset, dialog-close ...)
    doAct(act, t, root, api, r, c);
  }
  function doAct(act, t, root, api, r, c) {
    var ST = api.state, T = ST.T, L = api.label, fmt = api.fmt, seq = c.seq;
    var again = function () { render(root, api, r); };
    switch (act) {
      case "confirm": T.confirmBox33(seq); api.toast("Box 33 confirmed: " + ST.claim(seq).entity, "ok"); break;
      case "cl-assign": assignDialog(api, c); break;
      case "cl-entity": entityDialog(api, c); break;
      case "cl-go": api.go("#claim/" + seq + "/" + t.getAttribute("data-to")); break;
      case "cl-mention": insertMention(root.firstElementChild, api, c, t.getAttribute("data-user")); break;
      case "cl-note-add": {
        var text = (UI.noteText[seq] || "").trim(); var form = noteForm(seq, api);
        var ids = (UI.mentions[seq] || []).filter(function (id) { return text.indexOf("@" + ST.user(id).name) >= 0; });
        var note = { type: form.type, note: text, privateNote: ST.canSeePrivate() ? form.priv : "", date: form.date || ST.TODAY, correspondenceDate: form.corr || null, attachment: form.file || "", followUp: form.follow || null };
        if (!text && !note.privateNote && !note.attachment) { api.toast("A note needs text, a private note or an attachment.", "warn"); break; }
        clearNote(seq); var added = T.addNote(seq, note, ids);
        if (!added) { api.toast("A note needs text, a private note or an attachment.", "warn"); break; }
        var nt = ST.noteTypes().find(function (x) { return x.type === added.type; });
        api.toast("Note added (" + added.type + ")" + (ids.length ? "; " + ids.map(function (id) { return ST.user(id).name; }).join(", ") + " notified in " + L("inbox") : "") + (nt && nt.notify ? "; the " + nt.notify + " was notified" : "") + (added.followUp ? "; follow-up on " + fmt.date(added.followUp) : ""), "ok"); break;
      }
      case "cl-note-open": attachmentDialog(api, t.getAttribute("data-file")); break;
      case "cl-note-file-clear": noteForm(seq, api).file = ""; again(); break;
      case "cl-note-fu": { var fn = (c.notes || []).find(function (x) { return x.id === t.getAttribute("data-id"); }); T.followUpDone(seq, t.getAttribute("data-id")); api.toast("Follow-up done" + (fn && fn.followUp ? " (was due " + fmt.date(fn.followUp) + ")" : "") + ".", "ok"); break; }
      case "cl-note-del": if (!ST.canSeePrivate()) { api.toast("Only a supervisor or admin can delete a note.", "warn"); break; } deleteNoteDialog(api, c, t.getAttribute("data-id")); break;
      case "cl-elig": { var e = eligibility(c); api.toast("271 from " + c.payer + ": " + e.text + ". Coverage active on " + fmt.date(c.dos) + ". (illustrative)", "ok"); break; }
      case "cl-auth-save": {
        var inp = root.querySelector("#cl-auth"); var v = inp ? inp.value.trim() : "";
        if (!v) { api.toast("Enter the authorization number first.", "warn"); break; }
        UI.auth[seq] = v; api.toast("Authorization " + v + " kept for this session (the module writes it to the claim).", "ok"); again(); break;
      }
      case "cl-dx-add": {
        var di = root.querySelector("#cl-dx"); var code = di ? di.value.trim().toUpperCase() : "";
        if (!/^[A-Z]\d{2}(\.\d{1,4})?$/.test(code)) { api.toast("That is not an ICD-10 code (letter, two digits, optional decimal part).", "warn"); break; }
        if (c.dx.concat(UI.dx[seq] || []).indexOf(code) >= 0) { api.toast(code + " is already on the claim.", "info"); break; }
        arr(UI.dx, seq).push(code); api.toast("Diagnosis " + code + " added for this session.", "ok"); again(); break;
      }
      case "cl-sugg": { var i = Number(t.getAttribute("data-idx")); var acc = t.getAttribute("data-accept") === "1"; var s = c.suggestions[i]; T.confirmSuggestion(seq, i, acc); api.toast((acc ? "Accepted: line " + s.line + " is now " + s.cpt : "Declined the suggestion on line " + s.line), acc ? "ok" : "info"); break; }
      case "cl-attach": { var n = (UI.attach[seq] || []).length + 1; arr(UI.attach, seq).push("Additional document " + n); api.toast("Attached: Additional document " + n + " (the file picker is not part of the demo).", "ok"); again(); break; }
      case "cl-prepare": T.prepare(seq); api.toast("Marked prepared. Next: the scrub.", "ok"); api.go("#claim/" + seq + "/scrub"); break;
      case "cl-fix": {
        var idx = Number(t.getAttribute("data-idx")); var title = c.checks[idx][0];
        if (idx === 5) { T.confirmBox33(seq); api.toast("Box 33 confirmed: " + ST.claim(seq).entity, "ok"); }
        else { T.fixCheck(seq, idx, FIXES[title] || "Fixed by " + ST.me().name); api.toast("Fixed " + title + ": " + (FIXES[title] || ""), "ok"); }
        break;
      }
      case "cl-scrub": {
        var ok = T.scrub(seq); var cc = ST.claim(seq);
        if (ok) { api.toast("Ready to file: all " + cc.of + " checks green.", "ok"); api.go("#claim/" + seq + "/file"); }
        else api.toast("Still open: " + cc.checks.filter(function (x) { return x[1] !== "ok"; }).map(function (x) { return x[0]; }).join(", "), "warn");
        break;
      }
      case "cl-file": {
        var how = UI.how[seq] || "837"; var res = T.file(seq, how);
        if (res.ok) { UI.fileWhy[seq] = ""; api.toast("Filed (" + (how === "paper" ? "CMS-1500" : "837") + ") in batch " + ST.claim(seq).batch + ". Waiting for the acknowledgement.", "ok"); }
        else { UI.fileWhy[seq] = res.why; api.toast("Cannot file: " + res.why + " Go to Scrub.", "warn"); again(); }
        break;
      }
      case "cl-ack-ok": T.acknowledge(seq, true); api.toast("Accepted by the payer (999 and 277CA clean). The claim moved to " + L("ongoing") + ".", "ok"); break;
      case "cl-ack-bad": T.acknowledge(seq, false, REJECT_REASON); api.toast("Rejected by the clearinghouse: " + REJECT_REASON + ". Back in " + L("new") + " to fix.", "bad"); break;
      case "cl-status": api.toast(status277(c, api), "info"); break;
      case "cl-records": T.addNote(seq, "Records requested from " + c.hosp + ": operative note and " + c.track + " monitoring report for " + c.payer + "'s review.", []); api.toast("Records request noted on the claim.", "ok"); break;
      case "cl-secondary": T.billSecondary(seq); api.toast("Secondary payer billed for " + fmt.money(ST.totals(ST.claim(seq)).balance) + " (illustrative).", "ok"); break;
      case "cl-statement": { var bal = ST.totals(c).balance; T.issueStatement(seq); api.toast("Patient statement sent for " + fmt.money(bal) + " (illustrative).", "ok"); break; }
      case "cl-close": closeDialog(api, c); break;
      case "cl-reopen": T.reopen(seq); api.toast("Reopened; back to awaiting remittance.", "ok"); break;
    }
  }
  function onChange(ev, root, api, r, c) {
    var el = ev.target; var ST = api.state;
    if (el.matches("input[data-line]")) {
      var idx = Number(el.getAttribute("data-line")), field = el.getAttribute("data-field"); var l = c.lines[idx]; if (!l) return;
      var patch = {}; var v = el.value.trim();
      if (field === "units") { v = Number(v); if (!(v >= 1)) { api.toast("Units must be 1 or more.", "warn"); el.value = l.units; return; } }
      else v = v.toUpperCase();
      if (String(l[field]) === String(v)) return;
      patch[field] = v; ST.T.setLine(c.seq, idx, patch); api.toast("Line " + (idx + 1) + " " + field + " set to " + v + ".", "ok");
    } else if (el.name === "cl-how") { UI.how[c.seq] = el.value; UI.fileWhy[c.seq] = ""; render(root, api, r); }
    else if (el.id === "cl-note-type") noteForm(c.seq, api).type = el.value;
    else if (el.id === "cl-note-date") noteForm(c.seq, api).date = el.value || ST.TODAY;
    else if (el.id === "cl-note-corr") noteForm(c.seq, api).corr = el.value;
    else if (el.id === "cl-note-follow") noteForm(c.seq, api).follow = el.value;
    else if (el.id === "cl-note-private") noteForm(c.seq, api).priv = el.value;
    else if (el.id === "cl-note-file") { var fl = el.files && el.files[0]; noteForm(c.seq, api).file = fl ? fl.name : ""; if (fl) api.toast("Attached: " + fl.name + " (the name only; nothing is uploaded in this demo).", "ok"); render(root, api, r); }
    else if (el.id === "cl-nf-type") { noteFilters(c.seq).type = el.value; render(root, api, r); }
    else if (el.id === "cl-nf-sys") { noteFilters(c.seq).showSys = el.checked; render(root, api, r); }
    else if (el.id === "cl-nf-del") { noteFilters(c.seq).showDel = el.checked; render(root, api, r); }
    else if (el.id === "cl-npi") { UI.npi[c.seq] = el.value; api.toast("Rendering NPI choice kept for this session: " + el.options[el.selectedIndex].text, "ok"); }
  }

  window.SCENES.claim = { title: "Claim", render: render };
})();
