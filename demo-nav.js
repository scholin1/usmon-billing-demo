/* USMON insurance-billing concept demo — shared nav ribbon + "Ask Me" help assistant.
   Drop-in: <script src="demo-nav.js"></script> before </body> on each page.
   Self-injecting, namespaced, no dependencies. Synthetic demo only. */
(function () {
  if (window.__usmonDemoNav) return;
  window.__usmonDemoNav = true;

  var PAGES = [
    { f: 'index.html', label: 'Start', home: true },
    { f: 'prototype-home-dashboard.html', label: 'Dashboard' },
    { f: 'prototype-ops-worklist.html', label: 'Worklist' },
    { f: 'prototype-guided-flow.html', label: 'Guided', group: 'Styles' },
    { f: 'prototype-familiar-modern.html', label: 'Familiar', group: 'Styles' },
    { f: 'prototype-v5-router.html', label: 'Cockpit', group: 'Styles' },
    { f: 'prototype-cms1500.html', label: 'CMS-1500', group: 'Form' },
    { f: 'prototype-payments.html', label: 'Payments', group: 'Money' },
    { f: 'prototype-post-payments.html', label: 'Post 835', group: 'Money' },
    { f: 'prototype-reports.html', label: 'Reports', group: 'Insights' },
    { f: 'prototype-clearinghouses.html', label: 'Clearinghouses', group: 'Admin' }
  ];
  var cur = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (cur === '') cur = 'index.html';

  var BLURB = {
    'index.html': 'the overview — a one-minute explanation of the approach, with a link into each concept.',
    'prototype-home-dashboard.html': 'the Home dashboard — where the day starts, with configurable count tiles and a switcher for billers who serve more than one client.',
    'prototype-ops-worklist.html': 'the Operational Worklist — the dense daily grid built to handle tens of thousands of claims: filter, sort by deadline, edit in place, and act on many at once.',
    'prototype-biller-review.html': 'the Biller Review view — confirm a mostly prefilled claim, with the AI-filled fields highlighted for a quick check.',
    'prototype-guided-flow.html': 'the Guided Flow — the same claim, one calm step at a time, so a new biller can complete it without training.',
    'prototype-familiar-modern.html': 'the Familiar-Modern view — today’s workflow and CMS-1500 layout, modernized onto one scrolling page.',
    'prototype-v5-router.html': 'the Smart Cockpit — everything on one page with a workflow rail down the side and AI review assist.',
    'prototype-cms1500.html': 'the CMS-1500 form — the billers’ main working screen: a prefilled, editable claim form where the reading physician’s Tech Report auto-fills the coding, plus “Coding Assist” that catches codes you might have missed.',
    'prototype-payments.html': 'Payments & Collections — where out-of-network dollars get recovered: post payments per CPT over time, work underpayments and refiles, then close the claim or send it to arbitration to collect more.',
    'prototype-post-payments.html': 'Post Payments — an incoming 835/ERA is auto-reconciled line-by-line against what the system expects; matched lines auto-post and only the discrepancies need your review.'
  };

  var KB = [
    { k: ['view', 'views', 'differ', 'style', 'switch', 'layout'], a: 'There’s no single “right” screen — the same claim and the same fields can be worked in whichever layout suits the biller: the dense Worklist grid, the step-by-step Guided flow, the Familiar layout, or the all-in-one Cockpit. Use the bar at the top to switch between them.' },
    { k: ['ai', 'highlight', 'confirm', 'purple', 'suggest'], a: 'AI does a first pass and fills in the likely answers — like the principal diagnosis from the reading report. Every AI-filled field is highlighted in purple with a “✦ AI” tag so you always know what to double-check. You Confirm or Override each one, and it’s logged. AI proposes; the biller decides.' },
    { k: ['coding assist', 'missed', 'coding', 'cpt', 'charge capture'], a: 'Coding Assist (on the CMS-1500 form) is a second-opinion AI scan of the Tech Report and the Cadwell IONM report — it flags CPT codes you might have missed, with a justification for each, so you can add them in one click. It’s USMON’s own take on comparable add-on coding tools.' },
    { k: ['835', 'era', 'reconcile', 'remit', 'post payment'], a: 'On the Post 835 screen, an incoming ERA (835) is auto-reconciled line-by-line against what the system expects. Lines that match auto-post; only discrepancies are flagged for a human to confirm — so posting is accurate, not a manual guess.' },
    { k: ['collect', 'refile', 'appeal', 'negotiat', 'balance', 'recover', 'payment'], a: 'On Payments & Collections you post payments per CPT over time, work underpayments through refile/appeal and Pro/Tech negotiation, and keep collecting until you close the claim or send it to arbitration.' },
    { k: ['idr', 'clock', 'deadline', 'nsa', 'timely', 'arbitr', 'underpaid'], a: 'Because ~99% of these claims are out-of-network, the real money is recovered through negotiation/IDR after an underpayment. Two clocks matter — the filing deadline and the IDR window — and the system surfaces them so a recoverable claim never slips past a missed deadline.' },
    { k: ['supervisor', 'biller', 'role', 'stats', 'efficiency', 'time', 'idle'], a: 'Billers get a clean, stats-free screen for verifying claim after claim. A Billing Supervisor gets an extra toggle (top of the screen) that reveals team stats and a per-biller time & efficiency view — including a flag when a claim has been sitting idle. Billers never see it.' },
    { k: ['real', 'data', 'hipaa', 'patient', 'phi', 'synthetic', 'fake'], a: 'Everything here is 100% synthetic — made-up patients, claims, and dollar amounts. No real patient data (no PHI) is used anywhere in these concepts.' },
    { k: ['prefill', 'preload', 'schedul', 'tech', 'reader', 'mcp', 'entry', 'type'], a: '~95% of each claim arrives already filled in — from schedulers, techs, and the reading physicians — pulled straight from USMON. So the biller mostly reviews and confirms rather than typing.' },
    { k: ['hospital', 'tech-fee', 'medicare', 'government', 'channel', 'invoice'], a: 'Each case routes to the channel that actually pays: a commercial out-of-network claim (the big one), a rare government in-network claim, or a hospital technical-fee invoice for government cases. The system routes each case to the right one.' },
    { k: ['bulk', 'many', 'volume', 'scale', 'thousand', 'grid'], a: 'The Worklist is built for real volume — tens of thousands of active claims. Filter to what matters, sort by deadline, edit inline, and act on many claims at once (bulk validate, export, or route).' }
  ];

  var SUGGEST = ['What am I looking at?', 'How do the AI fields work?', 'Biller vs Supervisor?', 'Is this real data?'];

  /* ---------- styles ---------- */
  var css =
    ':root{--dmnav-h:40px}' +
    'body{padding-top:var(--dmnav-h)!important}' +
    '.appbar{top:var(--dmnav-h)!important}' +
    '.tabstrip{top:calc(var(--dmnav-h) + 52px)!important}' +
    '#dmnav{position:fixed;top:0;left:0;right:0;height:var(--dmnav-h);z-index:99997;display:flex;align-items:center;gap:1px;background:#0b3a41;padding:0 10px;font:600 12.5px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.2);overflow-x:auto;overflow-y:hidden}' +
    '#dmnav::-webkit-scrollbar{height:0}' +
    '#dmnav .dm-brand{display:flex;align-items:center;gap:7px;font-weight:800;white-space:nowrap;padding-right:8px;color:#eafcff}' +
    '#dmnav .dm-dot{width:16px;height:16px;border-radius:4px;background:linear-gradient(135deg,#0b6e7a,#1aa3b2);display:grid;place-items:center;font-size:9px;color:#fff}' +
    '#dmnav a{color:#bfe0e6;text-decoration:none;padding:5px 10px;border-radius:7px;white-space:nowrap;transition:background .12s,color .12s}' +
    '#dmnav a:hover{background:rgba(255,255,255,.10);color:#fff}' +
    '#dmnav a.dm-home{color:#eafcff;font-weight:700}' +
    '#dmnav a.dm-active{background:#0b6e7a;color:#fff}' +
    '#dmnav .dm-sep{width:1px;height:20px;background:rgba(255,255,255,.16);margin:0 6px;flex:none}' +
    '#dmnav .dm-grp{font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:#5f97a0;font-weight:800;padding:0 4px 0 2px;white-space:nowrap}' +
    '#dmnav .dm-tag{margin-left:auto;padding-left:12px;color:#7fb8c0;white-space:nowrap;font-size:11px;font-weight:600}' +
    '@media(max-width:860px){#dmnav .dm-tag{display:none}}' +
    '#dm-ask-btn{position:fixed;right:20px;bottom:20px;z-index:99998;background:#6d4aff;color:#fff;border:none;border-radius:999px;padding:11px 17px;font:700 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 6px 22px rgba(109,74,255,.42);display:flex;align-items:center;gap:8px;cursor:pointer}' +
    '#dm-ask-btn:hover{background:#5a37e0}' +
    '#dm-ask{position:fixed;right:20px;bottom:74px;width:344px;max-width:calc(100vw - 40px);height:452px;max-height:calc(100vh - 130px);z-index:99999;background:#fff;border:1px solid #e2e7ee;border-radius:14px;box-shadow:0 18px 50px rgba(16,32,46,.30);display:none;flex-direction:column;overflow:hidden;font:400 13.5px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#16202e}' +
    '#dm-ask.open{display:flex}' +
    '#dm-ask .dm-h{background:linear-gradient(135deg,#6d4aff,#8b6bff);color:#fff;padding:13px 15px;display:flex;align-items:center;gap:10px}' +
    '#dm-ask .dm-h .sp{width:26px;height:26px;border-radius:7px;background:rgba(255,255,255,.22);display:grid;place-items:center;font-size:14px;flex:none}' +
    '#dm-ask .dm-h b{font-size:14px;display:block;line-height:1.1}' +
    '#dm-ask .dm-h em{font-size:11px;opacity:.9;font-style:normal}' +
    '#dm-ask .dm-h .x{margin-left:auto;background:none;border:none;color:#fff;font-size:20px;cursor:pointer;opacity:.85;line-height:1}' +
    '#dm-ask .dm-h .x:hover{opacity:1}' +
    '#dm-ask .dm-body{flex:1;overflow-y:auto;padding:14px;background:#f7f9fb;display:flex;flex-direction:column;gap:10px}' +
    '#dm-ask .dm-msg{max-width:86%;padding:9px 12px;border-radius:13px;font-size:13px;line-height:1.46}' +
    '#dm-ask .dm-msg.bot{background:#fff;border:1px solid #e6e9f0;align-self:flex-start;border-bottom-left-radius:4px}' +
    '#dm-ask .dm-msg.me{background:#6d4aff;color:#fff;align-self:flex-end;border-bottom-right-radius:4px}' +
    '#dm-ask .dm-sug{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}' +
    '#dm-ask .dm-sug button{background:#eef0fd;border:1px solid #d6d8f7;color:#3f37a6;border-radius:999px;padding:5px 11px;font:600 12px inherit;cursor:pointer}' +
    '#dm-ask .dm-sug button:hover{background:#e0e3fb}' +
    '#dm-ask .dm-foot{border-top:1px solid #e6e9f0;padding:9px;display:flex;gap:7px;background:#fff}' +
    '#dm-ask .dm-foot input{flex:1;border:1px solid #d2dae4;border-radius:9px;padding:9px 11px;font:400 13px inherit;outline:none}' +
    '#dm-ask .dm-foot input:focus{border-color:#6d4aff}' +
    '#dm-ask .dm-foot button{background:#6d4aff;color:#fff;border:none;border-radius:9px;padding:0 15px;font:700 13px inherit;cursor:pointer}' +
    '@media(prefers-reduced-motion:reduce){#dmnav a{transition:none}}';

  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  /* ---------- nav ribbon ---------- */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var nav = document.createElement('nav');
  nav.id = 'dmnav';
  nav.setAttribute('aria-label', 'Concept demo navigation');
  var h = '<span class="dm-brand"><span class="dm-dot">U</span>USMON&nbsp;Pro concepts</span>';
  var lastGroup = null;
  PAGES.forEach(function (p) {
    if (p.group && p.group !== lastGroup) {
      h += '<span class="dm-sep"></span><span class="dm-grp">' + esc(p.group) + '</span>';
      lastGroup = p.group;
    }
    var cls = (p.f === cur ? 'dm-active' : '') + (p.home ? ' dm-home' : '');
    var text = (p.home ? '🏠 ' : '') + esc(p.label);
    if (p.f === cur) {
      h += '<a class="' + cls + '" href="' + p.f + '" aria-current="page">' + text + '</a>';
    } else {
      h += '<a class="' + cls + '" href="' + p.f + '">' + text + '</a>';
    }
    if (p.home) h += '<span class="dm-sep"></span>';
  });
  h += '<span class="dm-tag">Synthetic demo · concepts, not final UI</span>';
  nav.innerHTML = h;
  document.body.insertBefore(nav, document.body.firstChild);

  /* ---------- Ask Me assistant ---------- */
  var btn = document.createElement('button');
  btn.id = 'dm-ask-btn';
  btn.type = 'button';
  btn.innerHTML = '✦ Ask&nbsp;me';
  btn.setAttribute('aria-label', 'Open help assistant');

  var panel = document.createElement('div');
  panel.id = 'dm-ask';
  panel.innerHTML =
    '<div class="dm-h"><span class="sp">✦</span><div><b>USMON Assistant</b><em>Demo help · AI-simulated</em></div><button class="x" id="dm-ask-x" aria-label="Close">×</button></div>' +
    '<div class="dm-body" id="dm-ask-body"></div>' +
    '<div class="dm-foot"><input id="dm-ask-in" placeholder="Ask about this screen…" autocomplete="off" aria-label="Ask a question"><button id="dm-ask-send" type="button">Send</button></div>';

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var body = panel.querySelector('#dm-ask-body');
  var input = panel.querySelector('#dm-ask-in');
  var greeted = false;

  function add(text, who) {
    var m = document.createElement('div');
    m.className = 'dm-msg ' + (who || 'bot');
    m.innerHTML = text;
    body.appendChild(m);
    body.scrollTop = body.scrollHeight;
    return m;
  }
  function suggestions() {
    var wrap = document.createElement('div');
    wrap.className = 'dm-sug';
    SUGGEST.forEach(function (q) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = q;
      b.addEventListener('click', function () { answer(q); });
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
    body.scrollTop = body.scrollHeight;
  }
  function reply(qRaw) {
    var q = (qRaw || '').toLowerCase();
    if (/(what|where|which|looking|this screen|this page|explain)/.test(q) && !/ai|view|role|data|idr|clock/.test(q)) {
      return 'You’re looking at ' + (BLURB[cur] || 'a concept screen in the USMON billing demo.');
    }
    for (var i = 0; i < KB.length; i++) {
      for (var j = 0; j < KB[i].k.length; j++) {
        if (q.indexOf(KB[i].k[j]) !== -1) return KB[i].a;
      }
    }
    return 'Good question. In the real product that would be handled in the workflow — for this concept demo, here are a few things I can explain:';
  }
  function answer(q) {
    add(esc(q), 'me');
    var a = reply(q);
    setTimeout(function () {
      add(a, 'bot');
      if (a.indexOf('here are a few things') !== -1) suggestions();
    }, 220);
  }
  function greet() {
    if (greeted) return;
    greeted = true;
    add('Hi! I’m a demo assistant for these USMON billing concepts — everything here is <b>synthetic</b>. Right now you’re on ' + (BLURB[cur] || 'a concept screen.') + ' Ask me anything, or tap a question:', 'bot');
    suggestions();
  }
  function open() { panel.classList.add('open'); greet(); setTimeout(function () { input.focus(); }, 60); }
  function close() { panel.classList.remove('open'); }

  btn.addEventListener('click', function () { panel.classList.contains('open') ? close() : open(); });
  panel.querySelector('#dm-ask-x').addEventListener('click', close);
  panel.querySelector('#dm-ask-send').addEventListener('click', function () {
    var v = input.value.trim(); if (!v) return; input.value = ''; answer(v);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { var v = input.value.trim(); if (!v) return; input.value = ''; answer(v); }
  });
})();
