/* Scene: denials. The denial worklist by category in plain words, with the next move for each, and
   the per-claim denial panel (window.CLAIM_VIEWS.denial) that scenes/claim.js renders for
   #claim/<seq>/denial. The next move is one of five, by the Remit director's spec: Correct and
   resubmit, Appeal on the record, Appeal from the chart, Nothing to argue, Chase the payer. */
(function () {
  "use strict";
  window.CLAIM_VIEWS = window.CLAIM_VIEWS || {};
  var UI = { cat: "All", sort: { key: "remit", dir: "desc" }, drafts: {}, attach: {} };
  var DENIAL_STATUSES = { denied: 1, partial: 1, recoup: 1 };
  var POSITIONAL_MODS = { "26": 1, "TC": 1, "LT": 1, "RT": 1 };

  // on-screen dates are mm-dd-yyyy in the denial panel (the director's convention)
  function dateDash(iso) { if (!iso) return ""; var p = iso.slice(0, 10).split("-"); return p[1] + "-" + p[2] + "-" + p[0]; }
  function classWords(c) { return c.payerClass === "oon" ? "out-of-network" : c.payerClass === "government" ? "government" : c.payerClass === "inn" ? "in-network" : "other"; }
  function isDenial(c) { return !!DENIAL_STATUSES[c.status] && !!(c.fin && c.fin.code); }
  function deniedRows(c) { return (c.ledger || []).filter(function (r) { return Number(r.paid) <= 0; }); }
  // T.deny does not stamp fin.last_remit, so a simulated denial falls back to the history event's date
  function deniedOn(c, ST) { if (c.fin && c.fin.last_remit) return c.fin.last_remit; var evs = (c.history || []).filter(function (e) { return e.kind === "denied"; }); return evs.length ? evs[evs.length - 1].date : ST.TODAY; }
  function appealClockOf(c, ST) { var k = ST.appealClock(c); if (k) return k; var left = ST.constants.APPEAL_DAYS - ST.daysBetween(deniedOn(c, ST), ST.TODAY); return { left: left, cls: left < 0 ? "over" : left <= 30 ? "late" : "ok" }; }

  // The five moves. Each: label, one-sentence action, kind (resubmit, record, chart, nothing, chase).
  var MOVES = {
    resubmit: { label: "Correct and resubmit", action: "Correct the claim and resubmit it." },
    record: { label: "Appeal on the record", action: "Appeal this on the record as it stands; no clinical chart is needed." },
    chart: { label: "Appeal from the chart", action: "Appeal this from the chart; the argument turns on what the record documents." },
    nothing: { label: "Nothing to argue", action: "Nothing to send. This is the correct outcome, not a claim that went wrong." },
    chase: { label: "Chase the payer", action: "Chase the payer for a claim status; nothing has come back yet." }
  };

  // code -> move, with the reason in plain words and the "rate gap" sentence for CO-45
  function nextMove(c, ST) {
    if (!isDenial(c)) {
      if (c.status === "awaiting" || c.status === "acknowledged" || c.status === "filed" || c.status === "refiled" || c.status === "appealed") return { key: "chase", why: "Nothing has come back from the payer on this claim yet." };
      return null;
    }
    var code = c.fin.code, t = ST.totals(c);
    switch (code) {
      case "CO-16": return { key: "resubmit", why: "The payer is missing an item it needs; add it and send the claim again." };
      case "CO-4": {
        var positional = (c.lines || []).some(function (l) { return String(l.mods || "").split(/[ ,]+/).some(function (m) { return POSITIONAL_MODS[m]; }); });
        return positional ? { key: "resubmit", why: "The modifier on the lines is positional (26, TC, LT or RT); correct it and send the claim again." } : { key: "record", why: "The modifier was right for the service; appeal with the claim as filed." };
      }
      case "CO-109": return { key: "resubmit", why: "Bill the payer that actually covered this patient on the date of service." };
      case "CO-97": return { key: "record", why: "The services were distinct; the record of the claim shows it." };
      case "CO-29": return { key: "record", why: "Our clearinghouse acceptance report proves the first filing was on time." };
      case "CO-50": return { key: "chart", why: "The operative note and the monitoring report carry the medical necessity." };
      case "CO-197": return { key: "record", why: "The authorization number on file answers the payer." };
      case "CO-45": {
        var writeDown = c.billed ? (c.billed - t.collected) / c.billed : 0;
        if (c.payerClass !== "oon" && writeDown < 0.75) return { key: "nothing", why: "A contractual write-down of " + Math.round(writeDown * 100) + " percent on a " + classWords(c) + " claim; adjust the balance and close." };
        return { key: "record", why: rateGap(c, ST) + (c.payerClass === "oon" ? " Out-of-network: the open negotiation and IDR path is also open." : " The write-down is over 75 percent; check the rate that was applied.") };
      }
    }
    return { key: "record", why: "Appeal with the claim as filed." };
  }
  function rateGap(c, ST) {
    var t = ST.totals(c), fmt = ST.fmtMoney;
    var allowed = (c.ledger || []).reduce(function (a, r) { return a + (Number(r.allowed) || 0); }, 0);
    if (allowed > t.collected + 0.005) return "The payer allowed " + fmt(allowed - t.collected) + " more than it paid.";
    return fmt(t.balance) + " of " + fmt(c.billed) + " billed is unpaid.";
  }
  function moveFor(c, ST) { var m = nextMove(c, ST); return m ? MOVES[m.key] : null; }

  // ----------------------------------------------------------------------------------- the worklist scene
  function render(root, api) {
    var C = api.components, ST = api.state, esc = api.esc, L = api.label, fmt = api.fmt, D = api.data;
    var all = ST.all().filter(isDenial);
    var cats = {}; Object.keys(D.denialCategory).forEach(function (k) { cats[D.denialCategory[k]] = 0; });
    all.forEach(function (c) { var cat = D.denialCategory[c.fin.code] || "Other"; cats[cat] = (cats[cat] || 0) + 1; });
    var rows = UI.cat === "All" ? all : all.filter(function (c) { return (D.denialCategory[c.fin.code] || "Other") === UI.cat; });
    var awaiting = ST.all().filter(function (c) { return c.status === "awaiting" || c.status === "acknowledged"; });

    var tiles = [
      { n: all.filter(function (c) { return c.status === "denied"; }).length, l: "Open denials (denied in full)", cls: "bad" },
      { n: all.filter(function (c) { return c.status === "partial"; }).length, l: "Short pays", cls: "warn" },
      { n: all.filter(function (c) { return c.status === "recoup"; }).length, l: "Recoupments", cls: "bad" },
      { n: all.filter(function (c) { return appealClockOf(c, ST).cls !== "ok"; }).length, l: "Appeal clock under 30 days", cls: "warn" },
      { n: fmt.money(all.reduce(function (a, c) { return a + ST.totals(c).balance; }, 0)), l: "Denied dollars (open balance, illustrative)" }
    ];

    var cols = [
      { key: "pat", label: L("patient"), render: function (c) { return C.patLink(c, esc(c.hosp) + " · DOS " + fmt.date(c.dos) + " · " + esc(c.track)); } },
      { key: "payer", label: L("payer"), render: function (c) { return esc(c.payer) + '<br><span class="sub">' + classWords(c) + '</span>'; } },
      { key: "remit", label: "Denied on", sort: function (c) { return deniedOn(c, ST); }, render: function (c) { return fmt.date(deniedOn(c, ST)) + '<br><span class="sub">' + esc(ST.statusInfo(c).label) + '</span>'; } },
      { key: "code", label: "Code", sort: function (c) { return c.fin.code; }, render: function (c) { return '<span class="mono"><b>' + esc(c.fin.code) + '</b></span><br><span class="sub">' + esc(D.denialCategory[c.fin.code] || "Other") + '</span>'; } },
      { key: "meaning", label: "What the payer is saying", render: function (c) { var k = D.carc[c.fin.code]; return '<span class="sub">' + esc(k ? k.meaning : "No plain-words meaning on file for this code.") + '</span>'; } },
      { key: "balance", label: L("balance"), cls: "num", sort: function (c) { return ST.totals(c).balance; }, render: function (c) { return '<b>' + fmt.money(ST.totals(c).balance) + '</b>'; } },
      { key: "appeal", label: "Appeal clock", cls: "num", sort: function (c) { return appealClockOf(c, ST).left; }, render: function (c) { return C.clock(appealClockOf(c, ST)); } },
      { key: "assignee", label: L("biller"), sort: function (c) { return c.assignee ? ST.user(c.assignee).name : ""; }, render: function (c) { return c.assignee ? C.avatar(c.assignee) : '<span class="sub">unassigned</span>'; } },
      { key: "next", label: L("next"), sort: function (c) { var m = moveFor(c, ST); return m ? m.label : ""; }, render: function (c) { var m = moveFor(c, ST); return C.btn(m ? m.label : L("work"), "open-denial", { seq: c.seq }, "sm" + (m && m.key !== "nothing" ? " primary" : "")); } }
    ];

    var html = '<h1>' + esc(L("denials")) + '</h1>';
    html += C.tiles(tiles);
    html += '<div class="toolbar">' + ["All"].concat(Object.keys(cats)).map(function (cat) { var n = cat === "All" ? all.length : cats[cat]; return C.btn(cat + " (" + n + ")", "cat", { cat: cat }, "sm" + (UI.cat === cat ? " primary" : "")); }).join(" ") +
      '<span class="spacer"></span><span class="sub">' + rows.length + " of " + all.length + ' denials</span> ' +
      (awaiting.length ? C.btn("Simulate a new denial", "simulate-denial", null, "sm") : '<button type="button" class="btn sm" disabled title="No Ongoing claim is awaiting remittance, so there is nothing a payer could deny">Simulate a new denial</button>') + '<span class="sub">demo control: a payer denies one claim that is awaiting remittance' + (awaiting.length ? "" : "; none are awaiting right now") + '</span></div>';
    html += C.grid({ id: "dn-grid", columns: cols, rows: rows, sort: UI.sort, empty: UI.cat === "All" ? "No open denials. Click Simulate a new denial to see one arrive." : "Nothing in this category right now." });
    html += C.banner(api.data.illustrative);

    var el = document.createElement("div");
    el.innerHTML = html;
    root.innerHTML = ""; root.appendChild(el);

    el.querySelectorAll("th[data-sort]").forEach(function (th) { th.addEventListener("click", function () { var k = th.getAttribute("data-sort"); UI.sort = { key: k, dir: UI.sort.key === k && UI.sort.dir === "asc" ? "desc" : "asc" }; render(root, api); }); });
    el.addEventListener("click", function (ev) {
      var t = ev.target.closest("[data-act]"); if (!t) return;
      var act = t.getAttribute("data-act"), seq = Number(t.getAttribute("data-seq"));
      if (act === "cat") { UI.cat = t.getAttribute("data-cat"); render(root, api); }
      else if (act === "open-denial") { api.go("#claim/" + seq + "/denial"); }
      else if (act === "simulate-denial") { if (!awaiting.length) { api.toast("No claim is awaiting remittance; nothing to deny.", "warn"); return; } simulateDialog(api, awaiting); }
    });
  }

  function simulateDialog(api, awaiting) {
    var C = api.components, ST = api.state, esc = api.esc, D = api.data;
    var codes = Object.keys(D.carc);
    var body = '<p class="sub">Demo control. Picks an Ongoing claim that is awaiting remittance and records a denial with the code you choose, as if the 835 had just arrived.</p>' +
      '<div class="form"><label>Claim<select id="sim-seq">' + awaiting.map(function (c) { return '<option value="' + c.seq + '">' + esc(c.pat) + " · " + esc(c.payer) + " · " + ST.fmtMoney(c.billed) + '</option>'; }).join("") + '</select></label>' +
      '<label>Denial code<select id="sim-code">' + codes.map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + " · " + esc(D.denialCategory[k] || "") + '</option>'; }).join("") + '</select></label>' +
      '<div class="full sub" id="sim-meaning">' + esc(D.carc[codes[0]].meaning) + '</div></div>';
    C.dialog("Simulate a new denial", body, [{ text: "Cancel", act: "dialog-close" }, { text: "Deny this claim", act: "sim-go", cls: "primary" }]);
    var dlg = document.getElementById("dialog");
    dlg.onchange = function (ev) { if (ev.target.id === "sim-code") { var m = dlg.querySelector("#sim-meaning"); if (m) m.textContent = D.carc[ev.target.value] ? D.carc[ev.target.value].meaning : ""; } };
    dlg.onclick = function (ev) {
      var t = ev.target.closest("[data-act=sim-go]"); if (!t) return;
      var seq = Number(dlg.querySelector("#sim-seq").value), code = dlg.querySelector("#sim-code").value;
      ST.T.deny(seq, code); C.closeDialog();
      api.toast("Denied " + code + ": " + ST.claim(seq).pat + ". It is now in " + api.label("denials") + ".", "warn");
    };
  }

  // ----------------------------------------------------------------------------------- the per-claim denial panel
  function denialView(container, api, c, r) {
    var C = api.components, ST = api.state, esc = api.esc, fmt = api.fmt, D = api.data, T = ST.T;
    var seq = c.seq, t = ST.totals(c), me = ST.me();
    var move = nextMove(c, ST);
    var html = '';

    if (!isDenial(c)) {
      var mv = move ? MOVES[move.key] : null;
      html = C.panel("No denial on this claim", '<p>Status: ' + C.statusPill(c) + (c.closedReason ? ' <span class="sub">' + esc(c.closedReason) + '</span>' : '') + '</p>' +
        (mv ? C.card(mv.label, '<p>' + esc(mv.action) + '</p><p class="sub">' + esc(move.why) + '</p>' + C.btn("Note a status check", "chase", { seq: seq }, "sm")) : '') +
        '<p><a href="#claim/' + seq + '">Back to the claim</a> · <a href="#denials">' + esc(api.label("denials")) + '</a></p>');
      mount(container, html, function (act) { if (act === "chase") { T.addNote(seq, "Called the payer for a claim status; nothing has come back yet. " + me.name); api.toast("Status check noted on the claim.", "info"); } });
      return;
    }

    var code = c.fin.code, k = D.carc[code] || { meaning: "No plain-words meaning on file for this code.", fix: "" }, cat = D.denialCategory[code] || "Other";
    var rows = deniedRows(c), remarks = rows.map(function (x) { return x.remark; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    var ak = appealClockOf(c, ST), denied = deniedOn(c, ST);
    var inFull = c.status === "denied" && t.collected <= 0.005;

    // Why was this claim denied?
    var why = C.kv([
      ["Code", '<span class="mono"><b>' + esc(code) + '</b></span> ' + C.pill(cat, "denied"), true],
      ["What happened", inFull ? "Denied in full on " + dateDash(denied) + "; nothing was allowed." : c.status === "recoup" ? "A recoupment was taken on " + dateDash(denied) + "; the payer took back " + fmt.money(Math.abs(t.recoupment)) + "." : "Short paid on " + dateDash(denied) + "; " + fmt.money(t.collected) + " of " + fmt.money(c.billed) + " was paid."],
      ["What the payer is saying", k.meaning],
      ["What to do", k.fix || "Review with the supervisor."],
      ["Remark code", remarks.length ? remarks.join(", ") : "none on the remittance"],
      ["Payer", c.payer + " (" + classWords(c) + ")"],
      ["Balance", fmt.money(t.balance) + (c.payerClass === "oon" && code === "CO-45" ? " · " + rateGap(c, ST) : "")],
      ["Appeal clock", C.clock(ak) + ' <span class="sub">180 days from the remittance of ' + dateDash(denied) + '</span>', true]
    ]);
    var linesHtml = rows.length ? '<table class="grid"><thead><tr><th>Line</th><th>Date</th><th class="num">Allowed</th><th class="num">Paid</th><th>Adjustment</th><th>Remark</th><th>Source</th></tr></thead><tbody>' +
      rows.map(function (x) { return '<tr><td class="mono">' + esc(x.line) + '</td><td>' + dateDash(x.date) + '</td><td class="num">' + fmt.money(x.allowed) + '</td><td class="num">' + (Number(x.paid) < 0 ? '<span class="pill recoup">' + fmt.money(x.paid) + '</span>' : fmt.money(x.paid)) + '</td><td class="sub">' + esc(x.adj) + '</td><td class="mono">' + esc(x.remark) + '</td><td class="sub">' + esc(x.source) + '</td></tr>'; }).join("") + '</tbody></table>'
      : '<p class="sub">The remittance did not itemize denied lines.</p>';
    html += C.panel("Why was this claim denied?", why + '<h2>Denied lines</h2>' + linesHtml);

    // What to do next
    var mvInfo = MOVES[move.key];
    var next = '<div class="card"><h3>' + esc(mvInfo.label) + ' ' + C.pill("next move", "ready") + '</h3><p>' + esc(mvInfo.action) + '</p><p class="sub">' + esc(move.why) + '</p></div>';
    var cards = [];
    var primary = move.key;

    // Correct and resubmit
    var change = code === "CO-16" ? "Add the missing item (modifier, rendering NPI or diagnosis pointer) on the lines below." : code === "CO-4" ? "Correct the modifier on each service line (26 for the professional read, TC for the technical part)." : code === "CO-97" ? "Add the unbundling modifier (59 or an X modifier) to the distinct service." : code === "CO-109" ? "Change the payer to the one that covered the patient on " + dateDash(c.dos) + " and verify eligibility." : "Correct the item the payer named and resubmit.";
    cards.push(C.card("Correct and resubmit", '<p>' + esc(change) + '</p>' + C.kv([["On the corrected claim", "Frequency code 7 (replacement), original claim reference kept, lines re-pointed"], ["Lines", (c.lines || []).map(function (l) { return l.cpt + (l.mods ? " " + l.mods : ""); }).join(", ")], ["Goes to", c.payer + " through the clearinghouse"]]) +
      '<p>' + C.btn("Refile corrected claim", "refile", { seq: seq }, primary === "resubmit" ? "primary" : "") + '</p>'));

    // Appeal (on the record or from the chart)
    var draft = UI.drafts[seq] != null ? UI.drafts[seq] : letterTemplate(c, k, me, fmt, move.key === "chart", denied);
    var attach = UI.attach[seq] || (UI.attach[seq] = {});
    var items = [["claim", "Claim as filed (837 or CMS-1500 image)"], ["remit", "The 835 or denial letter"], ["note", "Operative note"], ["report", "Monitoring report"]];
    if (code === "CO-29") items.push(["accept", "Clearinghouse acceptance report (timely filing proof)"]);
    if (code === "CO-197") items.push(["auth", "Authorization " + (c.authNo || "number")]);
    cards.push(C.card(move.key === "chart" ? "Appeal from the chart" : "Appeal on the record",
      '<p class="sub">The letter is drafted from the claim; edit it before you send it.</p><textarea id="dn-letter" rows="11">' + esc(draft) + '</textarea>' +
      '<h3>Attachments</h3>' + items.map(function (it) { return '<label class="chk" style="display:flex"><input type="checkbox" data-attach="' + it[0] + '"' + (attach[it[0]] ? ' checked' : '') + '> ' + esc(it[1]) + '</label>'; }).join("") +
      '<p>' + C.btn("Send appeal", "appeal", { seq: seq }, primary === "record" || primary === "chart" ? "primary" : "") + ' ' + (ak.left < 0 ? '<span class="sub">The appeal clock has run out; the payer may refuse a late appeal.</span>' : '') + '</p>'));

    // Adjust (CO-45, not out-of-network)
    if (code === "CO-45" && c.payerClass !== "oon") {
      cards.push(C.card("Nothing to argue: contractual adjustment", '<p>' + esc(MOVES.nothing.action) + '</p>' + C.kv([["Write off", fmt.money(t.balance)], ["Reason", "Contractual adjustment (" + code + ")"], ["Then", "Closed; the patient owes nothing on this line"]]) +
        '<p>' + C.btn("Write off contractual amount and close", "adjust", { seq: seq }, primary === "nothing" ? "primary" : "danger") + '</p>'));
    }
    // Out-of-network: the negotiation and IDR path
    if (c.payerClass === "oon") {
      var nk = ST.negotiationClock(c);
      cards.push(C.card("Out-of-network: open negotiation and IDR", '<p>Under the No Surprises Act, an out-of-network claim gets a 30-day open negotiation with the payer after its payment or denial, then a 4-business-day window to start Independent Dispute Resolution.</p>' +
        (nk ? '<p>Negotiation is open: ' + C.clock(nk) + ' <span class="sub">ends ' + dateDash(nk.endsOn) + '</span></p><p><a href="#claim/' + seq + '/idr">Open the IDR view</a></p>' : '<p>' + C.btn("Start open negotiation", "negotiate", { seq: seq }, code === "CO-45" ? "primary" : "") + ' <span class="sub">starts the 30-day clock today, ' + dateDash(ST.TODAY) + '</span></p>')));
    }
    html += C.panel("What to do next", next + '<div class="row">' + cards.join("") + '</div>');
    html += C.banner(api.data.illustrative);

    var root = mount(container, html, function (act, el) {
      if (act === "refile") { T.refile(seq); api.toast("Corrected claim refiled (frequency code 7). Status: Refiled.", "ok"); }
      else if (act === "appeal") { var ta = el.querySelector("#dn-letter"); var letter = ta ? ta.value : draft; var missing = items.filter(function (it) { return !attach[it[0]]; }); T.appeal(seq, letter); delete UI.drafts[seq]; api.toast("Appeal sent to " + c.payer + (missing.length ? " with " + (items.length - missing.length) + " of " + items.length + " attachments checked" : " with every attachment") + ".", "ok"); }
      else if (act === "adjust") { T.close(seq, "Contractual adjustment", t.balance); api.toast("Wrote off " + fmt.money(t.balance) + " as a contractual adjustment and closed the claim.", "ok"); }
      else if (act === "negotiate") { T.startNegotiation(seq, ST.TODAY); api.toast("Open negotiation started; the 30-day clock runs from " + dateDash(ST.TODAY) + ".", "info"); api.go("#claim/" + seq + "/idr"); }
    });
    var ta = root.querySelector("#dn-letter"); if (ta) ta.addEventListener("input", function () { UI.drafts[seq] = ta.value; });
    root.addEventListener("change", function (ev) { var a = ev.target.closest("[data-attach]"); if (a) attach[a.getAttribute("data-attach")] = a.checked; });
  }

  function letterTemplate(c, k, me, fmt, fromChart, denied) {
    return "To: " + c.payer + ", Appeals\n" +
      "Re: Appeal of denial " + c.fin.code + ", member " + c.member + ", claim " + c.seq + "\n" +
      "Patient: " + c.pat + "    Date of service: " + dateDash(c.dos) + "    Billed: " + fmt.money(c.billed) + "\n\n" +
      "We are appealing the denial of the intraoperative neuromonitoring services above (" + c.procedure + " at " + c.hosp + "). " +
      "Your remittance of " + dateDash(denied) + " carries " + c.fin.code + ": " + (k.meaning || "") + "\n\n" +
      (fromChart ? "The enclosed operative note and monitoring report document the medical necessity of monitoring for this procedure and the diagnoses " + (c.dx || []).join(", ") + ". " : "The claim as filed supports payment. ") +
      (k.fix || "") + "\n\n" +
      "Please reprocess the claim and remit payment of the allowed amount.\n\n" +
      me.name + "\n" + (me.role === "supervisor" ? "Billing supervisor" : "Insurance biller") + ", XYZ Monitoring Insurance Billing";
  }

  // renders html into a fresh element inside the container and wires one click handler to it
  function mount(container, html, onAct) {
    var el = document.createElement("div");
    el.innerHTML = html;
    container.innerHTML = ""; container.appendChild(el);
    el.addEventListener("click", function (ev) { var t = ev.target.closest("[data-act]"); if (!t || t.classList.contains("disabled")) return; onAct(t.getAttribute("data-act"), el, t); });
    return el;
  }

  window.CLAIM_VIEWS.denial = denialView;
  window.SCENES.denials = { title: "Denials", render: render };
})();
