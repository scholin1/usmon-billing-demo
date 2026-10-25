/* The store for the end-to-end billing demo. Owns the claim life cycle. Scenes read through getters
   and change state only through the named transitions below. Persists to localStorage; reset()
   wipes. Vanilla JS, no dependencies. Owner: the Insurance Billing seat (ask before editing). */
(function () {
  "use strict";
  window.SCENES = window.SCENES || {};
  var KEY = "usmon-billing-demo-v2";
  var D = window.DEMO_DATA;
  var TODAY = D.today; // ISO; the demo's clock is fixed so every walk-through looks the same

  var FILING_LIMIT = D.limit || 90;      // days from DOS (illustrative; per payer in the module)
  var NEGOTIATION_DAYS = 30;              // out-of-network open negotiation window
  var IDR_WINDOW_DAYS = 4;                // business days after negotiation ends to start IDR
  var APPEAL_DAYS = 180;

  function iso(d) { return d.toISOString().slice(0, 10); }
  function addDays(isoDate, n) { var d = new Date(isoDate + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  function daysBetween(a, b) { return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function round2(x) { return Math.round(x * 100) / 100; }

  // ----------------------------------------------------------------------------------- the status vocabulary
  // status -> {label, cls, list}; the module's statuses. "list" is the worklist the claim sits in.
  var STATUS = {
    pending:      { label: "In legacy, not yet pulled", cls: "new",     list: "pending" },
    new:          { label: "New",                        cls: "new",     list: "new" },
    assigned:     { label: "Assigned",                   cls: "prep",    list: "new" },
    prepared:     { label: "Prepared",                   cls: "prep",    list: "new" },
    scrubbed:     { label: "Ready to file",              cls: "ready",   list: "new" },
    filed:        { label: "Filed, awaiting acknowledgement", cls: "filed", list: "ongoing" },
    rejected:     { label: "Rejected by clearinghouse",  cls: "denied",  list: "new" },
    acknowledged: { label: "Accepted by payer",          cls: "filed",   list: "ongoing" },
    awaiting:     { label: "Awaiting remittance",        cls: "await",   list: "ongoing" },
    paid:         { label: "Paid",                       cls: "paid",    list: "ongoing" },
    partial:      { label: "Partial, one line denied",   cls: "partial", list: "ongoing" },
    denied:       { label: "Denied",                     cls: "denied",  list: "ongoing" },
    recoup:       { label: "Recoupment taken",           cls: "recoup",  list: "ongoing" },
    refiled:      { label: "Refiled",                    cls: "filed",   list: "ongoing" },
    appealed:     { label: "Appeal sent",                cls: "appeal",  list: "ongoing" },
    negotiating:  { label: "Open negotiation",           cls: "idr",     list: "ongoing" },
    idr_due:      { label: "Send to IDR",                cls: "idr",     list: "ongoing" },
    idr_sent:     { label: "At IDR",                     cls: "idr",     list: "ongoing" },
    idr_decided:  { label: "IDR decided",                cls: "paid",    list: "ongoing" },
    secondary:    { label: "Secondary billed",           cls: "filed",   list: "ongoing" },
    statement:    { label: "Patient statement sent",     cls: "await",   list: "ongoing" },
    closed:       { label: "Closed",                     cls: "closed",  list: "ongoing" }
  };

  // ----------------------------------------------------------------------------------- initial state
  function initial() {
    var claims = {};
    D.claims.forEach(function (c0) {
      var c = clone(c0);
      c.history = [];
      c.notes = (c.notes || []).map(function (n) { return n.id ? n : { id: "n" + Math.random().toString(36).slice(2, 8), date: n.date, createdAt: n.date + " 00:00:00", type: n.type || "General Billing Notes", note: n.note, privateNote: "", correspondenceDate: null, attachment: "", who: n.who || "legacy", source: "legacy", followUp: null, deleted: false }; });
      c.clocks = {};
      if (c.list === "pending") c.status = "pending";
      else if (c.list === "new") c.status = c.assignee ? (c.ok === c.of ? "scrubbed" : c.ok >= c.of - 1 ? "prepared" : "assigned") : "new";
      else {
        // Ongoing: derive the status from the illustrative remittance state the generator gave
        var map = { paid: "paid", partial: "partial", denied: "denied", await: "awaiting", recoup: "recoup" };
        c.status = c.fin && c.fin.status === "Paid, closed" ? "closed" : (map[c.fin ? c.fin.cls : "await"] || "awaiting");
        c.filedOn = c.filed;
        c.ackOn = c.filed ? addDays(c.filed, 1) : null;
        if (c.status === "closed") c.closedReason = "Paid in full after adjustments";
        c.history.push(ev(c.filed || TODAY, "filed", "Filed (837) through Sample Clearinghouse A", "system"));
        if (c.ackOn) c.history.push(ev(c.ackOn, "acknowledged", "Accepted by the payer (999 and 277CA clean)", "system"));
        if (c.fin && c.fin.last_remit) c.history.push(ev(c.fin.last_remit, "remit", "835 received: " + c.fin.status, "system"));
        if (c.status === "denied" && c.payerClass === "oon" && c.fin.code === "CO-45") c.status = "partial";
      }
      c.history.unshift(ev(c.dos, "case", "Case signed off in legacy (" + c.caseType + ", " + c.procedure + ")", "legacy"));
      claims[c.seq] = c;
    });
    // seed a few out-of-network claims into the negotiation and IDR states so phase B has something to show
    var seeded = 0;
    Object.keys(claims).map(Number).sort().forEach(function (seq) {
      var c = claims[seq];
      if (c.payerClass !== "oon" || c.list !== "ongoing") return;
      if (c.status === "partial" && seeded === 0) { setNegotiation(c, addDays(TODAY, -34)); c.status = "idr_due"; seeded++; }
      else if (c.status === "partial" && seeded === 1) { setNegotiation(c, addDays(TODAY, -12)); seeded++; }
      else if (c.status === "denied" && seeded === 2) { setNegotiation(c, addDays(TODAY, -60)); c.status = "idr_sent"; c.idr = { vendor: "usmon", sentOn: addDays(TODAY, -25), offer: round2(c.billed * 0.62), payerOffer: round2(c.billed * 0.31) }; c.history.push(ev(c.idr.sentOn, "idr", "Packet sent to USMON Arbitration", "u5")); seeded++; }
    });
    var inbox = [
      { id: "m1", date: TODAY, from: "u1", to: "u2", text: "Five new cases came over from legacy this morning. Take the two Aetna ones, Lee has the rest.", claim: null, read: false },
      { id: "m2", date: addDays(TODAY, -1), from: "u5", to: "u4", text: "Recoupment on this one looks wrong; the 835 took back the whole 95940 line. Can you check the first remit?", claim: firstWith(claims, "recoup"), read: false },
      { id: "m3", date: addDays(TODAY, -2), from: "system", to: "u5", text: "Negotiation clock ended without agreement. The IDR window is open for 4 business days.", claim: firstWith(claims, "idr_due"), read: true }
    ];
    return { v: 1, claims: claims, inbox: inbox, currentUser: "u2", context: null, defaults: {}, view: "familiar", addons: { remit: true, codingAssist: true }, settings: { filingLimit: FILING_LIMIT }, log: [] };
  }
  function firstWith(claims, status) { var k = Object.keys(claims).find(function (s) { return claims[s].status === status; }); return k ? Number(k) : null; }
  function setNegotiation(c, noticeDate) {
    c.negotiation = { noticeDate: noticeDate, endsOn: addDays(noticeDate, NEGOTIATION_DAYS), idrDeadline: addDays(noticeDate, NEGOTIATION_DAYS + IDR_WINDOW_DAYS + 2), offer: round2(c.billed * 0.65), payerOffer: round2((c.fin && c.fin.collected) || c.billed * 0.3) };
    c.status = "negotiating";
    c.history.push(ev(noticeDate, "negotiation", "Open negotiation started with the payer (out-of-network)", "u5"));
  }
  function ev(date, kind, text, who) { return { date: date, kind: kind, text: text, who: who }; }

  // ----------------------------------------------------------------------------------- persistence
  var S;
  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) { var s = JSON.parse(raw); if (s && s.v === 1 && s.claims) return s; } } catch (e) { /* ignore */ }
    return initial();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } fire(); }
  var listeners = [];
  function fire() { listeners.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); }

  S = load();

  // ----------------------------------------------------------------------------------- getters
  function claim(seq) { return S.claims[seq] || null; }
  function allClients() { return Object.keys(S.claims).map(function (k) { return S.claims[k]; }); }
  function all() { var cid = S.context ? S.context.client : null; return allClients().filter(function (c) { return cid == null || c.client == null || c.client === cid; }); }
  function context() { return S.context; }
  function client(id) { return (D.clients || []).find(function (x) { return x.id === id; }) || { id: id, name: "Client " + id, short: "Client " + id }; }
  function role(key) { return (D.roles || {})[key] || { label: key, can: [] }; }
  function can(area) { if (!S.context) return true; var r = role(S.context.role); return r.can.indexOf(area) >= 0; }
  function myViews() { var u = (D.users || []).find(function (x) { return x.id === S.currentUser; }); return (u && u.views) || []; }
  function viewLabel(v) { return client(v.client).short + " - " + role(v.role).label; }
  function list(name) { return all().filter(function (c) { return STATUS[c.status].list === name; }); }
  function statusInfo(c) { return STATUS[c.status]; }
  function user(id) { return (D.users || []).find(function (u) { return u.id === id; }) || { id: id, name: id === "system" ? "System" : id === "legacy" ? "Legacy" : "Unknown", initials: "?" }; }
  function me() { return user(S.currentUser); }
  function filingClock(c) { var left = (S.settings.filingLimit || FILING_LIMIT) - daysBetween(c.dos, TODAY); return { left: left, cls: left < 0 ? "over" : left <= 14 ? "late" : "ok" }; }
  function negotiationClock(c) { if (!c.negotiation) return null; var left = daysBetween(TODAY, c.negotiation.endsOn); return { left: left, cls: left < 0 ? "over" : left <= 5 ? "late" : "ok", endsOn: c.negotiation.endsOn, idrDeadline: c.negotiation.idrDeadline, idrLeft: daysBetween(TODAY, c.negotiation.idrDeadline) }; }
  function appealClock(c) { if (!c.fin || !c.fin.last_remit) return null; var left = APPEAL_DAYS - daysBetween(c.fin.last_remit, TODAY); return { left: left, cls: left < 0 ? "over" : left <= 30 ? "late" : "ok" }; }
  function postedRows(c) { return (c.ledger || []).filter(function (r) { return r.status === "Posted"; }); }
  function totals(c) {
    var posted = postedRows(c);
    var collected = round2(posted.filter(function (r) { return r.paid > 0; }).reduce(function (a, r) { return a + r.paid; }, 0));
    var recoup = round2(posted.filter(function (r) { return r.paid < 0; }).reduce(function (a, r) { return a + r.paid; }, 0));
    var writeoff = c.writeoff || 0;
    return { billed: c.billed, collected: collected, recoupment: recoup, writeoff: writeoff, balance: round2(c.billed - collected - recoup - writeoff) };
  }
  function nextAction(c) {
    switch (c.status) {
      case "pending": return { label: "Pull from legacy", act: "arrive" };
      case "new": return { label: "Assign", act: "assign" };
      case "assigned": return { label: "Prepare", act: "prepare" };
      case "prepared": return { label: "Scrub", act: "scrub" };
      case "scrubbed": return { label: "File", act: "file" };
      case "rejected": return { label: "Fix and refile", act: "prepare" };
      case "filed": return { label: "Check acknowledgement", act: "track" };
      case "acknowledged": case "awaiting": return { label: "Track", act: "track" };
      case "partial": return { label: c.payerClass === "oon" ? "Negotiate or work denial" : "Work denial", act: "denial" };
      case "denied": return { label: "Work denial", act: "denial" };
      case "recoup": return { label: "Work denial", act: "denial" };
      case "negotiating": return { label: "Negotiation open", act: "idr" };
      case "idr_due": return { label: "Send to IDR", act: "idr" };
      case "idr_sent": return { label: "Await decision", act: "idr" };
      case "paid": case "idr_decided": return { label: c.secondaryBilled ? "Patient statement" : "Bill secondary or statement", act: "track" };
      case "appealed": case "refiled": return { label: "Await response", act: "track" };
      case "secondary": return { label: "Await secondary", act: "track" };
      case "statement": return { label: "Close when paid", act: "track" };
      case "closed": return { label: "", act: "" };
    }
    return { label: "", act: "" };
  }
  // ----------------------------------------------------------------------------------- notes (legacy Billing_Notes shape)
  function canSeePrivate() { var ctx = S.context; return !ctx || ctx.role === "supervisor" || ctx.role === "admin"; }
  function noteTypes() { return D.noteTypes || []; }
  function notesFor(c, opts) {
    opts = opts || {};
    var out = (c.notes || []).filter(function (n) { return opts.includeDeleted || !n.deleted; });
    if (!canSeePrivate()) out = out.map(function (n) { return n.privateNote ? Object.assign({}, n, { privateNote: "", privateHidden: true }) : n; });
    if (opts.type) out = out.filter(function (n) { return n.type === opts.type; });
    return out.slice().sort(function (a, b) { var ka = (a.date || "") + " " + (a.createdAt || ""), kb = (b.date || "") + " " + (b.createdAt || ""); return ka < kb ? 1 : ka > kb ? -1 : 0; });
  }
  function lastNote(c) { var ns = notesFor(c); return ns.length ? ns[0] : null; }
  function openFollowUps(c) { return notesFor(c).filter(function (n) { return n.followUp && !n.followUpDone; }).sort(function (a, b) { return a.followUp < b.followUp ? -1 : 1; }); }
  function nextFollowUp(c) { var f = openFollowUps(c); return f.length ? f[0] : null; }
  function allNotes(opts) {
    var out = [];
    all().forEach(function (c) { notesFor(c, opts).forEach(function (n) { out.push({ note: n, claim: c }); }); });
    return out.sort(function (a, b) { var ka = a.note.date + " " + (a.note.createdAt || ""), kb = b.note.date + " " + (b.note.createdAt || ""); return ka < kb ? 1 : ka > kb ? -1 : 0; });
  }
  function noteSeq() { S.noteSeq = (S.noteSeq || 1000) + 1; return "n" + S.noteSeq; }
  function unreadCount() { return S.inbox.filter(function (m) { return !m.read && m.to === S.currentUser; }).length; }

  // ----------------------------------------------------------------------------------- transitions
  function log(c, kind, text) { c.history.push(ev(TODAY, kind, text, S.currentUser)); S.log.push({ date: TODAY, seq: c.seq, kind: kind, text: text, who: S.currentUser }); }
  function set(c, status) { c.status = status; }

  var T = {
    arrive: function (n) {
      var pulled = [];
      list("pending").slice(0, n || 5).forEach(function (c) { set(c, "new"); c.arrivedOn = TODAY; c.isNew = true; log(c, "arrived", "Pulled from legacy into New Insurance Billing"); pulled.push(c.seq); });
      save(); return pulled;
    },
    clearNewBadges: function () { all().forEach(function (c) { c.isNew = false; }); save(); },
    assign: function (seq, userId) { var c = claim(seq); c.assignee = userId; if (c.status === "new") set(c, "assigned"); log(c, "assigned", "Assigned to " + user(userId).name); save(); },
    bulkAssign: function (seqs, userId) { seqs.forEach(function (s) { var c = claim(s); c.assignee = userId; if (c.status === "new") set(c, "assigned"); c.history.push(ev(TODAY, "assigned", "Assigned to " + user(userId).name + " (bulk)", S.currentUser)); }); save(); },
    confirmBox33: function (seq) { var c = claim(seq); c.confirmed = true; c.checks[5] = ["Box 33 entity", "ok", "Confirmed by " + me().name]; recount(c); log(c, "box33", "Box 33 entity confirmed: " + c.entity); save(); },
    setEntity: function (seq, entityName) { var c = claim(seq); c.entity = entityName; c.confirmed = false; c.checks[5] = ["Box 33 entity", "warn", "Changed by hand; confirm before filing"]; recount(c); log(c, "box33", "Box 33 entity changed to " + entityName); save(); },
    confirmSuggestion: function (seq, idx, accept) {
      var c = claim(seq); var s = c.suggestions[idx]; if (!s) return;
      s.decided = accept ? "accepted" : "declined";
      if (accept) { var l = c.lines[s.line - 1]; if (l) { l.cpt = s.cpt; l.changed = true; } }
      log(c, "coding", (accept ? "Accepted" : "Declined") + " Coding Assist suggestion: " + s.cpt + " on line " + s.line); save();
    },
    setLine: function (seq, idx, patch) { var c = claim(seq); var l = c.lines[idx]; if (!l) return; Object.keys(patch).forEach(function (k) { l[k] = patch[k]; }); l.changed = true; log(c, "line", "Service line " + (idx + 1) + " edited"); save(); },
    fixCheck: function (seq, idx, detail) { var c = claim(seq); if (!c.checks[idx]) return; c.checks[idx][1] = "ok"; c.checks[idx][2] = detail || "Fixed by " + me().name; recount(c); log(c, "fix", "Fixed: " + c.checks[idx][0]); save(); },
    prepare: function (seq) { var c = claim(seq); if (c.status === "assigned" || c.status === "new" || c.status === "rejected") { set(c, "prepared"); log(c, "prepared", "Claim prepared (eligibility, codes, lines reviewed)"); save(); } },
    scrub: function (seq) { var c = claim(seq); recount(c); if (c.ok === c.of) { set(c, "scrubbed"); log(c, "scrubbed", "All checks green; ready to file"); save(); return true; } save(); return false; },
    file: function (seq, how) {
      var c = claim(seq); recount(c);
      if (!c.confirmed) return { ok: false, why: "Box 33 is not confirmed." };
      if (c.ok !== c.of) return { ok: false, why: (c.of - c.ok) + " check(s) still open." };
      set(c, "filed"); c.filedOn = TODAY; c.filedHow = how || "837"; c.batch = "B-" + TODAY.replace(/-/g, "").slice(2) + "-" + (1 + (seq % 7));
      log(c, "filed", "Filed (" + c.filedHow + ") in batch " + c.batch + " through " + (how === "paper" ? "print" : "Sample Clearinghouse A")); save();
      return { ok: true };
    },
    acknowledge: function (seq, accepted, reason) {
      var c = claim(seq);
      if (accepted) { set(c, "acknowledged"); c.ackOn = TODAY; log(c, "acknowledged", "Accepted by the payer (999 and 277CA clean)"); setTimeout(function () { var cc = claim(seq); if (cc.status === "acknowledged") { set(cc, "awaiting"); save(); } }, 0); }
      else { set(c, "rejected"); c.rejectReason = reason || "277CA: subscriber id does not match the payer's record"; c.checks[0][1] = "warn"; c.checks[0][2] = "Rejected: " + c.rejectReason; recount(c); log(c, "rejected", "Rejected by the clearinghouse: " + c.rejectReason); }
      save();
    },
    postProposed: function (seq, rowId) { var c = claim(seq); var r = (c.ledger || []).find(function (x) { return x.id === rowId; }); if (!r) return; r.status = "Posted"; r.confirmedBy = me().name; log(c, "posted", "Confirmed proposed 835 row on line " + r.line + ": " + fmtMoney(r.paid)); settle(c); save(); },
    addPayment: function (seq, row) {
      var c = claim(seq); c.ledger = c.ledger || [];
      var r = { id: c.ledger.length + 1, date: row.date || TODAY, line: row.line, allowed: row.allowed || row.paid, paid: Number(row.paid), adj: row.adj || "", remark: row.remark || "", source: row.source || "Manual, by " + me().name, payer: row.payer || c.payer, check: row.check || "", status: "Posted", confirmedBy: me().name };
      c.ledger.push(r); log(c, "payment", (r.paid < 0 ? "Recoupment recorded " : "Payment added ") + fmtMoney(r.paid) + " on line " + r.line); settle(c); save(); return r;
    },
    deny: function (seq, carc) { var c = claim(seq); c.fin = c.fin || {}; c.fin.code = carc; c.fin.status = "Denied " + carc; c.fin.last_remit = TODAY; c.fin.cls = "denied"; set(c, "denied"); log(c, "denied", "Denied " + carc + ": " + (D.carc[carc] ? D.carc[carc].meaning : "")); save(); },
    refile: function (seq) { var c = claim(seq); set(c, "refiled"); c.refiledOn = TODAY; log(c, "refiled", "Corrected claim refiled (frequency code 7)"); save(); },
    appeal: function (seq, letter) { var c = claim(seq); set(c, "appealed"); c.appeal = { sentOn: TODAY, letter: letter || "" }; log(c, "appealed", "Appeal sent with supporting records"); save(); },
    startNegotiation: function (seq, noticeDate) { var c = claim(seq); setNegotiation(c, noticeDate || TODAY); c.history[c.history.length - 1].who = S.currentUser; save(); },
    endNegotiation: function (seq, agreed, amount) { var c = claim(seq); if (agreed) { set(c, "paid"); c.negotiation.agreed = amount; log(c, "negotiation", "Payer agreed to " + fmtMoney(amount) + "; awaiting the corrected remittance"); } else { set(c, "idr_due"); log(c, "negotiation", "Negotiation ended without agreement; IDR window open"); } save(); },
    sendToIdr: function (seq, vendorId, offer) { var c = claim(seq); set(c, "idr_sent"); c.idr = { vendor: vendorId, sentOn: TODAY, offer: offer || round2(c.billed * 0.62), payerOffer: c.negotiation ? c.negotiation.payerOffer : 0 }; var v = (D.idrVendors || []).find(function (x) { return x.id === vendorId; }); log(c, "idr", "Packet sent to " + (v ? v.name : vendorId)); save(); },
    idrDecision: function (seq, award) { var c = claim(seq); set(c, "idr_decided"); c.idr = c.idr || {}; c.idr.award = award; c.idr.decidedOn = TODAY; log(c, "idr", "IDR decision: " + fmtMoney(award) + " awarded; payer has 30 days to pay"); save(); },
    billSecondary: function (seq) { var c = claim(seq); set(c, "secondary"); c.secondaryBilled = TODAY; log(c, "secondary", "Secondary payer billed for the remaining balance"); save(); },
    issueStatement: function (seq) { var c = claim(seq); set(c, "statement"); c.statementOn = TODAY; log(c, "statement", "Patient statement sent for " + fmtMoney(totals(c).balance)); save(); },
    close: function (seq, reason, writeoff) { var c = claim(seq); set(c, "closed"); c.closedReason = reason || "Closed by biller"; c.closedOn = TODAY; if (writeoff) c.writeoff = round2(writeoff); log(c, "closed", "Closed: " + c.closedReason); save(); },
    reopen: function (seq) { var c = claim(seq); set(c, "awaiting"); c.closedReason = null; c.writeoff = 0; log(c, "reopened", "Reopened"); save(); },
    addNote: function (seq, textOrNote, mentions) {
      var c = claim(seq); var o = typeof textOrNote === "string" ? { note: textOrNote } : (textOrNote || {});
      var text = (o.note || "").trim(), priv = (o.privateNote || "").trim();
      if (!text && !priv && !o.attachment) return null;  // the module's CHECK: a note needs a body, a private body or an attachment
      var n = { id: noteSeq(), date: o.date || TODAY, createdAt: TODAY + " " + new Date().toTimeString().slice(0, 8), type: o.type || "General Billing Notes", note: text, privateNote: priv,
                correspondenceDate: o.correspondenceDate || null, attachment: o.attachment || "", who: o.who || S.currentUser, source: o.source || "user", followUp: o.followUp || null, followUpDone: false, deleted: false, mentions: (mentions || []).slice() };
      c.notes.unshift(n); log(c, "note", (o.source === "system" ? "System note: " : "Note (" + n.type + "): ") + (text || priv || "attachment " + n.attachment).slice(0, 80));
      (mentions || []).forEach(function (uid) { S.inbox.unshift({ id: "m" + (S.inbox.length + 1) + "-" + Date.now(), date: TODAY, from: S.currentUser, to: uid, text: text || priv, claim: seq, read: false }); });
      var nt = noteTypes().find(function (t) { return t.type === n.type; });
      if (nt && nt.notify && o.source !== "system") {
        (D.users || []).filter(function (u) { return u.role === nt.notify && u.id !== S.currentUser; }).forEach(function (u) { S.inbox.unshift({ id: "m" + (S.inbox.length + 1) + "-" + Date.now(), date: TODAY, from: S.currentUser, to: u.id, text: "A " + n.type + " note was filed: " + (text || priv).slice(0, 120), claim: seq, read: false, notified: true }); });
      }
      save(); return n;
    },
    deleteNote: function (seq, id, why) { var c = claim(seq); var n = c.notes.find(function (x) { return x.id === id; }); if (!n) return; n.deleted = true; n.deletedBy = S.currentUser; n.deletedOn = TODAY; n.deletedWhy = why || ""; log(c, "note", "Note deleted (kept in the record): " + n.type); save(); },
    followUpDone: function (seq, id) { var c = claim(seq); var n = c.notes.find(function (x) { return x.id === id; }); if (!n) return; n.followUpDone = true; n.followUpDoneBy = S.currentUser; log(c, "note", "Follow-up done: " + (n.note || n.type).slice(0, 60)); save(); },
    markRead: function (id) { var m = S.inbox.find(function (x) { return x.id === id; }); if (m) { m.read = true; save(); } },
    setUser: function (uid) { S.currentUser = uid; var vs = myViews(); if (S.context && !vs.some(function (v) { return v.client === S.context.client && v.role === S.context.role; })) S.context = S.defaults[uid] || vs[0] || null; save(); },
    setContext: function (clientId, roleKey) { S.context = { client: Number(clientId), role: roleKey }; save(); },
    clearContext: function () { S.context = null; save(); },
    setDefaultView: function (clientId, roleKey) { S.defaults[S.currentUser] = { client: Number(clientId), role: roleKey }; save(); },
    setView: function (v) { S.view = v; save(); },
    setAddon: function (name, on) { S.addons[name] = !!on; save(); },
    setSetting: function (k, v) { S.settings[k] = v; save(); },
    reset: function () { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } S = initial(); save(); }
  };

  function recount(c) { c.ok = c.checks.filter(function (x) { return x[1] === "ok"; }).length; c.of = c.checks.length; }
  function settle(c) {
    var t = totals(c);
    if (c.status === "awaiting" || c.status === "acknowledged" || c.status === "filed") { if (t.balance <= 0.005) set(c, "paid"); else if (t.collected > 0) set(c, "partial"); }
    var proposed = (c.ledger || []).some(function (r) { return r.status === "Proposed, confirm"; });
    if (!proposed && c.status === "partial" && t.balance <= 0.005) set(c, "paid");
    if (c.fin) { c.fin.collected = t.collected; c.fin.recoupment = t.recoupment; c.fin.balance = t.balance; }
  }
  function fmtMoney(x) { x = Number(x || 0); var neg = x < 0; var s = Math.abs(x).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); return "$" + (neg ? "-" : "") + s; }

  window.STORE = {
    TODAY: TODAY, STATUS: STATUS, constants: { FILING_LIMIT: FILING_LIMIT, NEGOTIATION_DAYS: NEGOTIATION_DAYS, IDR_WINDOW_DAYS: IDR_WINDOW_DAYS, APPEAL_DAYS: APPEAL_DAYS },
    get: function () { return S; }, claim: claim, all: all, allClients: allClients, list: list, context: context, client: client, role: role, can: can, myViews: myViews, viewLabel: viewLabel, statusInfo: statusInfo, user: user, me: me,
    notesFor: notesFor, lastNote: lastNote, openFollowUps: openFollowUps, nextFollowUp: nextFollowUp, allNotes: allNotes, noteTypes: noteTypes, canSeePrivate: canSeePrivate,
    filingClock: filingClock, negotiationClock: negotiationClock, appealClock: appealClock, totals: totals, postedRows: postedRows, nextAction: nextAction, unreadCount: unreadCount,
    addDays: addDays, daysBetween: daysBetween, fmtMoney: fmtMoney,
    subscribe: function (f) { listeners.push(f); }, T: T
  };
})();
