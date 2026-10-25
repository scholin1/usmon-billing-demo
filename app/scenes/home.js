/* Scene: home. The welcome page, after legacy USMON's: a greeting, "You are currently logged into
   <client - role>", Switch Views (a user holds several roles, possibly for several clients), the boxed
   counters for the active view with Open buttons, the module's areas the role can reach, the legacy
   areas (legacy stays about six months after the module ships), and the privacy notice.
   Routes: #home and #home/pick/<wanted hash> (the shell sends every route here while no view is chosen;
   after the pick we continue to the wanted hash). Edits only this file. */
(function () {
  "use strict";
  window.SCENES = window.SCENES || {};

  var STYLE = '<style>' +
    '.home-head { display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin-bottom: 10px; } .home-head .spacer { flex: 1; }' +
    '.home-head .logged { font-size: 13px; } .home-head .logged b { font-weight: 650; }' +
    '.home-pick { background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn); padding: 6px 10px; margin: 0 0 10px; font-weight: 600; border-radius: var(--radius); }' +
    '.home-row { display: flex; gap: 16px; align-items: flex-start; } .home-row > * { flex: 1; min-width: 0; } .home-row .side { flex: 0 0 380px; }' +
    '@media (max-width: 1000px) { .home-row { flex-direction: column; } .home-row .side { flex: 1; width: 100%; } }' +
    '.home-switch select { width: 100%; font: inherit; padding: 6px 8px; border: 1px solid var(--line2); background: var(--paper); color: var(--ink); border-radius: var(--radius); }' +
    '.home-switch .acts { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0 4px; }' +
    '.home-roles { list-style: none; margin: 8px 0 0; padding: 0; } .home-roles li { padding: 6px 0; border-top: 1px solid var(--line); font-size: 12.5px; } .home-roles li.on { font-weight: 600; } .home-roles li .sub { display: block; font-weight: 400; }' +
    '.home-tiles .tile { display: flex; flex-direction: column; gap: 2px; } .home-tiles .tile .btn { align-self: flex-start; margin-top: 6px; } .home-tiles .tile.greyed .n { color: var(--muted); }' +
    '.home-go { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }' +
    '.home-go .btn { text-align: left; display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; min-height: 58px; } .home-go .btn b { font-size: 14px; } .home-go .btn .sub { white-space: normal; }' +
    '.home-privacy p { margin: 4px 0; } .home-privacy b { font-weight: 650; }' +
    '</style>';

  // the areas of the module, in the order of the top nav; "area" is the key roles[].can uses
  var AREAS = [
    { area: "worklist", href: "#worklist/new", label: function () { return "Worklists"; }, desc: "New Insurance Billing to prepare and file; Ongoing to collect, appeal and close" },
    { area: "notes", href: "#notes", label: function () { return "Notes"; }, desc: "Every note on every claim, follow-ups, export" },
    { area: "payments", href: "#payments", label: function (L) { return L("payments"); }, desc: "The posting queue, proposed 835 rows to confirm, the claim ledger" },
    { area: "denials", href: "#denials", label: function (L) { return L("denials"); }, desc: "Denied, short-paid and recouped claims with the next move in plain words" },
    { area: "idr", href: "#idr", label: function (L) { return L("idr"); }, desc: "Negotiation clocks, the send-to-IDR alert, the packet and the decision" },
    { area: "assign", href: "#assign", label: function (L) { return L("assign"); }, desc: "Queues per biller and team, bulk reassign, assignment history" },
    { area: "inbox", href: "#inbox", label: function (L) { return L("inbox"); }, desc: "Mentions and notes addressed to you, with a click to the claim" },
    { area: "reports", href: "#reports", label: function (L) { return L("reports"); }, desc: "Workload by biller, aging, collections, denial rate" },
    { area: "settings", href: "#settings/rules", label: function (L) { return L("settings"); }, desc: "Billing rules by picture, Box 33 roster, clearinghouses, users and roles, add-ons" }
  ];
  var AREA_WORDS = { worklist: "worklists", claim: "claims", payments: "payments", denials: "denials", idr: "out-of-network and IDR", assign: "assignments", inbox: "the inbox", reports: "reports", settings: "settings" };

  function greeting() {
    var h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  }
  function words(list) {
    var w = list.map(function (a) { return AREA_WORDS[a] || a; });
    if (w.length <= 1) return w.join("");
    return w.slice(0, -1).join(", ") + " and " + w[w.length - 1];
  }
  function key(v) { return v.client + "|" + v.role; }
  function sameView(a, b) { return !!a && !!b && Number(a.client) === Number(b.client) && a.role === b.role; }

  function render(root, api, r) {
    var C = api.components, ST = api.state, esc = api.esc, L = api.label, D = api.data;
    var me = ST.me(), ctx = ST.context(), views = ST.myViews();
    var wanted = r.parts[1] === "pick" && r.parts[2] && r.parts[2] !== "home" ? r.parts[2] : null;
    var myDefault = (ST.get().defaults || {})[me.id] || null;
    var html = STYLE;

    // ------------------------------------------------------------------ header: greeting and the logged-into line
    html += '<div class="home-head"><div><h1>' + esc(greeting()) + ', ' + esc(me.name) + '</h1>' +
      '<div class="logged">' + (ctx ? 'You are currently logged into <b>' + esc(ST.viewLabel(ctx)) + '</b> <span class="sub">(' + esc(ST.client(ctx.client).name) + ', ' + esc(ST.client(ctx.client).id) + ')</span>' : 'You are not in a view yet. <b>Choose a view to begin.</b>') + '</div></div>' +
      '<span class="spacer"></span><span class="sub">Demo clock: ' + esc(api.fmt.date(ST.TODAY)) + '</span></div>';
    if (wanted) html += '<div class="home-pick">Pick a view to open #' + esc(wanted) + '</div>';

    // ------------------------------------------------------------------ Switch Views
    var sw = '<div class="home-switch">' +
      '<label class="sub" for="home-view">Your views, as "client - role". Pick one; the counters, the nav and what you can open follow it.</label>' +
      '<select id="home-view">' + (ctx ? '' : '<option value="" selected>Choose a view</option>') +
      views.map(function (v) { return '<option value="' + esc(key(v)) + '"' + (sameView(v, ctx) ? ' selected' : '') + '>' + esc(ST.viewLabel(v)) + (sameView(v, myDefault) ? ' (default)' : '') + '</option>'; }).join("") + '</select>' +
      '<div class="acts">' + (ctx ? C.btn("Make this my default view", "home-default", null, "sm") : '<button type="button" class="btn sm" disabled title="Choose a view first">Make this my default view</button>') +
      '<a href="#home" data-act="home-signin" title="Demo control: the real module signs you in once, with the roles legacy gave you">Sign in as a different user</a> <span class="sub">(demo control)</span></div>' +
      '<div class="sub">' + (myDefault ? 'Your default view: ' + esc(ST.viewLabel(myDefault)) + '. It opens when you sign in.' : 'No default view yet; the first view in the list opens when you sign in.') + '</div>';
    var seenRoles = {};
    sw += '<ul class="home-roles">' + views.filter(function (v) { if (seenRoles[v.role]) return false; seenRoles[v.role] = 1; return true; }).map(function (v) {
      var role = ST.role(v.role);
      var clients = views.filter(function (x) { return x.role === v.role; }).map(function (x) { return ST.client(x.client).short; });
      return '<li' + (ctx && ctx.role === v.role ? ' class="on"' : '') + '>' + esc(role.label) + ' <span class="sub">for ' + esc(clients.join(" and ")) + '</span>' +
        '<span class="sub">Can reach ' + esc(words(role.can)) + '. Same role as legacy ' + esc(role.legacy || role.label) + '; your legacy roles are kept.</span></li>';
    }).join("") + '</ul></div>';

    // ------------------------------------------------------------------ counters for the active view (legacy's boxed counters)
    var main = '';
    if (ctx) {
      var all = ST.all();
      var proposed = 0; all.forEach(function (c) { (c.ledger || []).forEach(function (row) { if (row.status === "Proposed, confirm") proposed++; }); });
      var tiles = [
        { n: ST.list("new").length, l: L("new"), href: "#worklist/new", area: "worklist", cls: "warn" },
        { n: ST.list("ongoing").length, l: L("ongoing"), href: "#worklist/ongoing", area: "worklist" },
        { n: proposed, l: "Proposed postings awaiting confirmation", href: "#payments", area: "payments", cls: "ok" },
        { n: all.filter(function (c) { return c.status === "denied" || c.status === "partial" || c.status === "recoup"; }).length, l: "Denials to work", href: "#denials", area: "denials", cls: "bad" },
        { n: all.filter(function (c) { return c.status === "idr_due"; }).length, l: "Send to IDR", href: "#idr", area: "idr", cls: "idr" },
        { n: all.reduce(function (a, c) { return a + ST.openFollowUps(c).filter(function (n) { return n.followUp <= ST.TODAY; }).length; }, 0), l: "Follow-ups due", href: "#notes/followups", area: "notes", cls: "warn" },
        { n: ST.unreadCount(), l: "Unread messages", href: "#inbox", area: "inbox" }
      ];
      var tileHtml = '<div class="tiles home-tiles">' + tiles.map(function (t) {
        var ok = ST.can(t.area);
        return '<div class="tile' + (ok ? (t.cls ? ' ' + t.cls : '') + '" data-href="' + esc(t.href) + '"' : ' greyed" title="Not in this view"') + '><div class="n">' + esc(t.n) + '</div><div class="l">' + esc(t.l) + '</div>' +
          (ok ? C.btn("Open", "home-go", { href: t.href }, "sm") : '<button type="button" class="btn sm" disabled title="Not in this view">Open</button>') + '</div>';
      }).join("") + '</div>';
      main += C.panel("Your work in " + esc(ST.client(ctx.client).short), tileHtml, "counted live for this client, " + esc(ST.role(ctx.role).label));

      // ------------------------------------------------------------------ Go to: the module's areas this role can reach
      var reach = AREAS.filter(function (a) { return ST.can(a.area); });
      var hidden = AREAS.filter(function (a) { return !ST.can(a.area); });
      main += C.panel("Go to", '<div class="home-go">' + reach.map(function (a) {
        return '<button type="button" class="btn" data-act="home-go" data-href="' + esc(a.href) + '"><b>' + esc(a.label(L)) + '</b><span class="sub">' + esc(a.desc) + '</span></button>';
      }).join("") + '</div>' + (hidden.length ? '<p class="sub">Not in this view: ' + esc(hidden.map(function (a) { return a.label(L); }).join(", ")) + '. Switch to a view whose role includes them.</p>' : ''),
        reach.length + " of " + AREAS.length + " areas in this view");
    } else {
      main += C.panel("Choose a view to begin", '<p>The counters and the areas you can open depend on the view: the client whose claims you work and the role you hold for it. Pick one under Switch Views. A contracted biller may hold a role for more than one client; that is between the client and its biller, and the module keeps it.</p>');
    }

    // ------------------------------------------------------------------ USMON Legacy
    main += C.panel("USMON Legacy", '<p class="sub" style="margin:0 0 8px">Legacy USMON stays in use for about six months after the module ships. You move between the two with the same roles; these open legacy in a new tab.</p>' +
      '<div class="home-go">' + (D.legacyAreas || []).map(function (a) {
        return '<button type="button" class="btn" data-act="home-legacy" data-key="' + esc(a.key) + '"><b>' + esc(a.label) + '</b><span class="sub">' + esc(a.note) + '</span></button>';
      }).join("") + '</div>', "not part of this demo");

    html += '<div class="home-row"><div class="main">' + main + '</div><div class="side">' + C.panel("Switch Views", sw, views.length + (views.length === 1 ? " view" : " views")) + '</div></div>';

    // ------------------------------------------------------------------ privacy notice, after legacy's
    html += '<div class="card home-privacy"><h3>Privacy</h3>' +
      '<p><b>Role-based access control limits what you see to what your role allows. By signing in you take responsibility for patients\' privacy.</b></p>' +
      '<p><b>Login tracking and timed logout are on. Log out before leaving the screen unattended.</b></p></div>';

    root.innerHTML = html;

    // ------------------------------------------------------------------ events
    var sel = root.querySelector("#home-view");
    if (sel) sel.addEventListener("change", function (ev) {
      var val = ev.target.value; if (!val) return;
      var p = val.split("|");
      ST.T.setContext(p[0], p[1]);
      api.toast("Now viewing " + ST.viewLabel(ST.context()) + ".", "info");
      if (wanted) api.go("#" + wanted);
    });
    root.onclick = function (ev) {
      var t = ev.target.closest("[data-act]"); if (!t) return;
      var act = t.getAttribute("data-act");
      if (act === "home-go") { ev.stopPropagation(); api.go(t.getAttribute("data-href")); }
      else if (act === "home-default") {
        var c = ST.context(); if (!c) return;
        ST.T.setDefaultView(c.client, c.role);
        api.toast(ST.viewLabel(c) + " is now your default view.", "ok");
      }
      else if (act === "home-signin") { ev.preventDefault(); signInDialog(api); }
      else if (act === "home-legacy") { legacyDialog(api, t.getAttribute("data-key")); }
    };
  }

  function signInDialog(api) {
    var C = api.components, ST = api.state, esc = api.esc, D = api.data;
    var cur = ST.get().currentUser;
    C.dialog("Sign in as a different user", '<p class="sub">Demo control. The real module signs you in once with the roles legacy gave you; this lets a viewer see the page as each person on the team.</p><ul class="menu-list">' +
      (D.users || []).map(function (u) { return '<li data-act="home-user" data-user="' + esc(u.id) + '"' + (u.id === cur ? ' class="on"' : '') + '>' + C.avatar(u.id) + ' ' + esc(u.name) + ' <span class="sub">' + esc((u.views || []).map(function (v) { return ST.viewLabel(v); }).join("; ")) + '</span></li>'; }).join("") +
      '</ul>', [{ text: "Cancel", act: "dialog-close" }]);
    document.getElementById("dialog").onclick = function (ev) {
      var t = ev.target.closest("[data-act=home-user]"); if (!t) return;
      ST.T.setUser(t.getAttribute("data-user"));
      C.closeDialog();
      var ctx = ST.context();
      api.toast("Now working as " + ST.me().name + (ctx ? ", viewing " + ST.viewLabel(ctx) : "") + ".", "info");
    };
  }

  function legacyDialog(api, k) {
    var C = api.components, esc = api.esc, D = api.data;
    var a = (D.legacyAreas || []).find(function (x) { return x.key === k; }) || { label: "Legacy", note: "" };
    C.dialog("USMON Legacy: " + esc(a.label), '<p><b>This opens legacy USMON in a new tab. Not part of this demo.</b></p>' +
      '<p class="sub">' + esc(a.note) + '</p>' +
      '<p>Legacy stays in use for about six months after the module ships. You move between legacy and the module with the same roles, and the Switch Views habit carries over.</p>',
      [{ text: "Close", act: "dialog-close", cls: "primary" }]);
    document.getElementById("dialog").onclick = null;
  }

  window.SCENES.home = { title: "Home", render: render };
})();
