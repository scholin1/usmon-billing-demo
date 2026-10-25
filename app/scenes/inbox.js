/* Scene: notes and inbox. Messages for the current user (unread first), a Sent tab, system alerts
   derived live from the store, and a compose card. Messages ride on claim notes: a note with
   @Name on a claim lands in that person's inbox with the claim attached (state.js addNote). */
(function () {
  "use strict";
  // Scene UI state. "local" holds messages sent WITHOUT a claim: the store has no slot for those
  // yet (see the report), so they live here for the session and show under Sent.
  var UI = { tab: "inbox", compose: { to: "", text: "", claim: "" }, local: [] };

  function render(root, api) {
    var C = api.components, ST = api.state, esc = api.esc, L = api.label, fmt = api.fmt;
    var S = ST.get(), me = ST.me();
    var mine = S.inbox.filter(function (m) { return m.to === me.id; });
    var unread = mine.filter(function (m) { return !m.read; });
    var sent = S.inbox.filter(function (m) { return m.from === me.id; });

    var html = '<style>' +
      '#ib .inbox ul { list-style: none; margin: 0; padding: 0; }' +
      '#ib .inbox li .when { color: var(--muted); font-size: 12px; white-space: nowrap; min-width: 86px; }' +
      '#ib .inbox li .body { flex: 1; min-width: 0; }' +
      '#ib .inbox li .who { margin-right: 6px; }' +
      '#ib .inbox li .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--brand-2); margin-right: 6px; vertical-align: middle; }' +
      '#ib .inbox li.local { cursor: default; }' +
      '#ib ul.alerts { list-style: none; margin: 0; padding: 0; }' +
      '#ib ul.alerts li { display: flex; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--line); }' +
      '#ib ul.alerts li:last-child { border-bottom: 0; }' +
      '#ib ul.alerts .n { min-width: 34px; text-align: right; font-weight: 650; font-variant-numeric: tabular-nums; }' +
      '#ib ul.alerts li.quiet .n { color: var(--muted); font-weight: 400; }' +
      '#ib ul.alerts li.bad .n { color: var(--bad); } #ib ul.alerts li.idr .n { color: var(--idr); } #ib ul.alerts li.warn .n { color: var(--warn); }' +
      '#ib .compose label { display: block; font-size: 12px; color: var(--muted); margin: 8px 0 3px; }' +
      '#ib .compose select, #ib .compose textarea { width: 100%; box-sizing: border-box; }' +
      '</style>';

    html += '<div id="ib" class="row">';

    // ---------------------------------------------------------------------------- main column
    html += '<div>';
    html += C.panel("System alerts", alertsHtml(api), '<span class="sub">derived live from the claims</span>');

    html += C.tabs([
      { key: "inbox", href: "#inbox", label: L("inbox"), count: unread.length },
      { key: "sent", href: "#inbox/sent", label: "Sent", count: sent.length + UI.local.length }
    ], UI.tab);

    if (UI.tab === "inbox") {
      var ordered = mine.slice().sort(function (a, b) { if (a.read !== b.read) return a.read ? 1 : -1; return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
      var body = '<p class="sub">Mentions: a note with @Name on a claim lands here as a message to that person, with the claim attached. Click a message to mark it read and open the claim.</p>';
      body += '<div class="inbox"><ul>' + (ordered.length ? ordered.map(function (m) { return msgLi(api, m, "from"); }).join("") : '<li class="local"><span class="sub">No messages for ' + esc(me.name) + '. Mention someone in a claim note, or compose one here.</span></li>') + '</ul></div>';
      html += C.panel(L("inbox") + " for " + esc(me.name), body, unread.length ? C.btn("Mark all read (" + unread.length + ")", "ib-markall", null, "sm") : '<span class="sub">all read</span>');
    } else {
      var sentOrdered = sent.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
      var sbody = '<p class="sub">Messages you sent as claim notes with a mention. Each one also sits in the claim\'s notes.</p>';
      sbody += '<div class="inbox"><ul>' + (sentOrdered.length ? sentOrdered.map(function (m) { return msgLi(api, m, "to"); }).join("") : '<li class="local"><span class="sub">Nothing sent yet.</span></li>') + '</ul></div>';
      if (UI.local.length) {
        sbody += '<h3 style="font-size:13px;margin:14px 0 4px">Sent without a claim <span class="sub">(this session only; the store has no slot for a message without a claim yet)</span></h3>';
        sbody += '<div class="inbox"><ul>' + UI.local.slice().reverse().map(function (m) { return msgLi(api, m, "to", true); }).join("") + '</ul></div>';
      }
      html += C.panel("Sent by " + esc(me.name), sbody);
    }
    html += '</div>';

    // ---------------------------------------------------------------------------- side column: compose
    var others = api.data.users.filter(function (u) { return u.id !== me.id; });
    var claims = ST.all().filter(function (c) { return c.status !== "pending"; }).sort(function (a, b) { return a.pat < b.pat ? -1 : a.pat > b.pat ? 1 : a.seq - b.seq; });
    var compose = '<div class="compose">' +
      '<label for="ib-to">To</label><select id="ib-to"><option value="">Pick a person</option>' + others.map(function (u) { return '<option value="' + u.id + '"' + (UI.compose.to === u.id ? ' selected' : '') + '>' + esc(u.name) + ' (' + esc(u.role) + ', ' + esc(u.team) + ')</option>'; }).join("") + '</select>' +
      '<label for="ib-claim">About a claim <span class="sub">(optional)</span></label><select id="ib-claim"><option value="">No claim</option>' + claims.map(function (c) { return '<option value="' + c.seq + '"' + (String(UI.compose.claim) === String(c.seq) ? ' selected' : '') + '>' + esc(c.pat) + ' · DOS ' + fmt.date(c.dos) + ' · ' + esc(c.payer) + ' · ' + esc(ST.statusInfo(c).label) + '</option>'; }).join("") + '</select>' +
      '<label for="ib-text">Message</label><textarea id="ib-text" placeholder="Type the message. With a claim chosen it is saved as a note on that claim with an @mention.">' + esc(UI.compose.text) + '</textarea>' +
      '<div class="toolbar">' + C.btn("Send", "ib-send", null, "primary") + ' ' + C.btn("Clear", "ib-clear", null, "sm") + '<span class="spacer"></span><span class="sub">from ' + esc(me.name) + '</span></div>' +
      '</div>';
    html += '<div class="side">' + C.panel("New message", compose) + '</div>';
    html += '</div>';
    root.innerHTML = html;

    // ---------------------------------------------------------------------------- events
    var to = root.querySelector("#ib-to"), cl = root.querySelector("#ib-claim"), tx = root.querySelector("#ib-text");
    to.addEventListener("change", function () { UI.compose.to = to.value; });
    cl.addEventListener("change", function () { UI.compose.claim = cl.value; });
    tx.addEventListener("input", function () { UI.compose.text = tx.value; });

    // onclick (not addEventListener): root is the shell's persistent #scene, so a listener added per render would stack.
    root.onclick = function (ev) {
      if (!ev.target.closest("#ib")) return;
      var li = ev.target.closest("li[data-msg]");
      var t = ev.target.closest("[data-act]");
      if (li && !t) {
        var id = li.getAttribute("data-msg"), seq = li.getAttribute("data-claim");
        var m = ST.get().inbox.find(function (x) { return x.id === id; });
        if (m && m.to === me.id && !m.read) { ST.T.markRead(id); }
        if (ev.target.closest("a")) return; // the claim link navigates on its own
        if (seq) api.go("#claim/" + seq); else if (m && m.to === me.id) api.toast("Marked read. This message has no claim attached.", "info");
        return;
      }
      if (!t) return;
      var act = t.getAttribute("data-act");
      if (act === "ib-markall") {
        var ids = ST.get().inbox.filter(function (x) { return x.to === me.id && !x.read; }).map(function (x) { return x.id; });
        ids.forEach(function (id) { ST.T.markRead(id); });
        api.toast(ids.length + (ids.length === 1 ? " message" : " messages") + " marked read.", "ok");
      } else if (act === "ib-clear") {
        UI.compose = { to: "", text: "", claim: "" }; render(root, api);
      } else if (act === "ib-send") {
        var uid = UI.compose.to, text = UI.compose.text.trim(), seqv = UI.compose.claim;
        if (!uid) { api.toast("Pick who the message is for.", "warn"); to.focus(); return; }
        if (!text) { api.toast("Type the message first.", "warn"); tx.focus(); return; }
        var u = ST.user(uid);
        if (seqv) {
          UI.compose = { to: "", text: "", claim: "" };
          ST.T.addNote(Number(seqv), "@" + u.name + " " + text, [uid]);
          api.toast("Sent to " + u.name + " as a note on " + ST.claim(Number(seqv)).pat + ".", "ok");
          api.go("#inbox/sent");
        } else {
          UI.local.push({ id: "local-" + Date.now(), date: ST.TODAY, from: me.id, to: uid, text: text, claim: null, read: true });
          UI.compose = { to: "", text: "", claim: "" };
          api.toast("Messages without a claim are not in the store yet; kept under Sent for this session only.", "warn");
          if (location.hash === "#inbox/sent") render(root, api); else api.go("#inbox/sent");
        }
      }
    };
  }

  function msgLi(api, m, dir, local) {
    var C = api.components, ST = api.state, esc = api.esc, fmt = api.fmt;
    var who = ST.user(dir === "from" ? m.from : m.to);
    var c = m.claim ? ST.claim(m.claim) : null;
    var unread = dir === "from" && !m.read;
    return '<li class="' + (unread ? 'unread' : '') + (local ? ' local' : '') + '" data-msg="' + esc(m.id) + '"' + (c ? ' data-claim="' + c.seq + '"' : '') + ' title="' + (c ? 'Open the claim' : (unread ? 'Mark read' : '')) + '">' +
      C.avatar(who.id) +
      '<div class="body"><div>' + (unread ? '<span class="dot"></span>' : '') + '<span class="who">' + (dir === "to" ? 'To ' : '') + '<b>' + esc(who.name) + '</b></span><span class="sub">' + esc(who.role || "") + '</span></div>' +
      '<div>' + esc(m.text) + '</div>' +
      (c ? '<div class="sub">On claim <a class="pat" href="#claim/' + c.seq + '"><b>' + esc(c.pat) + '</b></a> · ' + esc(c.payer) + ' · ' + C.statusPill(c) + '</div>' : (local ? '<div class="sub">No claim attached (not in the store)</div>' : '')) +
      '</div><span class="when">' + fmt.date(m.date) + '</span></li>';
  }

  function alertsHtml(api) {
    var ST = api.state, esc = api.esc, L = api.label;
    var all = ST.all();
    var newList = ST.list("new");
    var clock = newList.filter(function (c) { return c.status !== "rejected" && ST.filingClock(c).cls !== "ok"; });
    var idrDue = all.filter(function (c) { return c.status === "idr_due"; });
    var proposed = 0, proposedClaims = 0;
    all.forEach(function (c) { var n = (c.ledger || []).filter(function (r) { return r.status === "Proposed, confirm"; }).length; if (n) { proposed += n; proposedClaims++; } });
    var rejected = all.filter(function (c) { return c.status === "rejected"; });
    var rows = [
      { n: clock.length, cls: "bad", text: "claims in " + L("new") + " with a filing clock under 14 days" + (clock.length ? ": " + clock.slice(0, 3).map(function (c) { return c.pat + " (" + ST.filingClock(c).left + " days)"; }).join(", ") + (clock.length > 3 ? ", ..." : "") : ""), href: "#worklist/new", link: "Open the New worklist" },
      { n: idrDue.length, cls: "idr", text: "out-of-network claims whose negotiation ended without agreement: send to IDR within the window" + (idrDue.length ? ": " + idrDue.map(function (c) { return c.pat; }).join(", ") : ""), href: "#idr", link: "Open " + L("idr") },
      { n: proposed, cls: "warn", text: "835 rows arrived proposed and wait for a biller to confirm" + (proposedClaims ? " (on " + proposedClaims + (proposedClaims === 1 ? " claim)" : " claims)") : ""), href: "#payments", link: "Open " + L("payments") },
      { n: rejected.length, cls: "bad", text: "claims rejected by the clearinghouse, fix and refile" + (rejected.length ? ": " + rejected.map(function (c) { return c.pat; }).join(", ") : ""), href: "#worklist/new", link: "Open the New worklist" }
    ];
    return '<ul class="alerts">' + rows.map(function (r) { return '<li class="' + (r.n ? r.cls : "quiet") + '"><span class="n">' + r.n + '</span><span style="flex:1">' + esc(r.text) + (r.n ? '' : ' <span class="sub">(none right now)</span>') + '</span><a href="' + r.href + '">' + esc(r.link) + '</a></li>'; }).join("") + '</ul>';
  }

  window.SCENES.inbox = { title: "Inbox", render: function (root, api, r) { UI.tab = r && r.parts && r.parts[1] === "sent" ? "sent" : "inbox"; render(root, api); } };
})();
