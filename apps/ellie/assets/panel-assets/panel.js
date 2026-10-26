/* Ellie panel — Phase E (spec 002, E-06), contract-reconciled
 * 2026-10-25 to the Ellie Worker's served API (the bundle was first
 * written against the spec's contract, which the service never
 * implemented; the served contract below is the real one):
 *   GET  /api/widget-config?siteKey=        -> { enabled, turnstileSiteKey, ... }
 *   POST /api/chat/sessions                 { siteKey, turnstileToken }
 *        -> { sessionId, sessionToken, disclosure, outline }
 *   POST /api/chat/sessions/:id/messages    { text }   (x-ellie-session-token)
 *        -> { reply, modelConfigured, outline }
 *   POST /api/chat/sessions/:id/uploads     multipart, field "file" (session token)
 *   POST /api/chat/sessions/:id/finalize    (session token) -> { analysisId, status }
 *   GET  /api/chat/sessions/:id/analysis    (session token) -> { analysis }
 *        (404 analysis_not_ready until finalize; each read advances
 *         one generation step while the analysis is generating)
 *   POST /api/chat/sessions/:id/escalate    (session token) -> { ok, ticketId }
 * Anonymous session creation is gated server-side by Turnstile: the
 * widget renders here (Managed), its token goes in the creation call.
 * SG-2: the disclosure comes from the service's session creation and
 * is rendered BEFORE any user message. SG-3: no confidence percentage
 * is ever rendered. E-10: "Talk to a human" is always visible and
 * carries no response-time promise. */
(function () {
  var params = new URLSearchParams(location.search);
  var siteKey = params.get('siteKey') || '';
  var sessionId = null;
  var sessionToken = null;
  var finalized = false;
  var els = {
    messages: document.getElementById('messages'),
    starters: document.getElementById('starters'),
    status: document.getElementById('status'),
    input: document.getElementById('input'),
    file: document.getElementById('file'),
    plan: document.getElementById('plan'),
    planSections: document.getElementById('plan-sections'),
    outline: document.getElementById('outline'),
    turnstile: document.getElementById('turnstile'),
    composer: document.getElementById('composer'),
  };
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function addMessage(role, content) {
    var div = document.createElement('div');
    div.className = 'ep-msg ' + (role === 'user' ? 'ep-msg-user' : 'ep-msg-ellie');
    div.innerHTML = '<span class="ep-msg-label">' + (role === 'user' ? 'You' : 'Ellie — AI analyst') + '</span>' + esc(content);
    els.messages.appendChild(div);
    els.messages.scrollTop = els.messages.scrollHeight;
  }
  function setStatus(t) { els.status.textContent = t || ''; }
  function setSectionStates(states) {
    if (!states) return;
    els.outline.querySelectorAll('li').forEach(function (li) {
      var s = states[li.getAttribute('data-section')];
      if (s) li.querySelector('.ep-state').textContent = s;
    });
  }
  function setIntakeProgress(outline) {
    if (!outline || !outline.intake) return;
    var done = outline.intake.filter(function (f) { return f.answered; }).length;
    var title = els.outline.parentElement && els.outline.parentElement.querySelector('.ep-outline-title');
    if (title) title.textContent = 'Your plan — ' + done + ' of ' + outline.intake.length + ' questions answered';
  }
  async function call(path, init) {
    init = init || {};
    init.headers = Object.assign({}, init.headers || {});
    if (sessionToken) init.headers['x-ellie-session-token'] = sessionToken;
    var r = await fetch(path, init);
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(data.error || ('Request failed (' + r.status + ')')); e.data = data; throw e; }
    return data;
  }
  function sectionText(content) {
    if (content == null) return '';
    if (typeof content === 'string') return content;
    var parts = [];
    if (content.body) parts.push(content.body);
    if (content.range && content.range.low != null) {
      parts.push('Range: ' + content.range.low + ' – ' + content.range.high + (content.range.unit ? ' ' + content.range.unit : '') + (content.range.currency ? ' (' + content.range.currency + ')' : '') + '.');
    }
    if (content.assumptions && content.assumptions.length) parts.push('Assumptions: ' + content.assumptions.join(' '));
    if (content.unknowns && content.unknowns.length) parts.push('Still open: ' + content.unknowns.join(' '));
    if (content.documentFacts) parts.push('From your documents: ' + content.documentFacts);
    return parts.join('\n\n');
  }
  function renderPlan(analysis) {
    var sections = analysis.sections || [];
    if (!sections.length) return;
    els.plan.hidden = false;
    var states = {};
    sections.forEach(function (s) { states[s.section] = s.status === 'approved' ? 'Approved' : 'Draft'; });
    setSectionStates(states);
    els.planSections.innerHTML = sections.map(function (s) {
      return '<details><summary><strong>' + esc(s.section) + '</strong> ' +
        '<span class="ep-tag">' + (s.status === 'approved' ? 'Approved' : 'Draft — AI-drafted') + '</span> v' + s.version + '</summary>' +
        '<p>' + esc(sectionText(s.content)).replace(/\n/g, '<br>') + '</p></details>';
    }).join('');
  }
  async function refreshPlan() {
    if (!sessionId) return null;
    try {
      var data = await call('/api/chat/sessions/' + sessionId + '/analysis');
      if (data.analysis) renderPlan(data.analysis);
      return data.analysis;
    } catch (e) { return null; /* not finalized yet */ }
  }
  async function finalizeAndRender() {
    if (finalized || !sessionId) return;
    finalized = true;
    setStatus('Drafting your plan — each section is written one at a time…');
    try {
      await call('/api/chat/sessions/' + sessionId + '/finalize', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
    } catch (e) { setStatus(e.message); return; }
    // Each analysis read advances one generation step; poll until the
    // draft is complete (or the service reports it blocked).
    for (var i = 0; i < 40; i++) {
      var a = await refreshPlan();
      if (a && a.status === 'complete') { setStatus('Your plan is drafted below — every section stays a draft until a named engineer approves it.'); return; }
      if (a && a.status === 'blocked_model_not_configured') { setStatus('Plan drafting is paused on our side right now. Your answers are saved in this conversation.'); return; }
      await new Promise(function (res) { setTimeout(res, 2500); });
    }
    setStatus('Your plan is still drafting — it will appear here when ready.');
  }
  async function createSession(turnstileToken) {
    var data = await call('/api/chat/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteKey: siteKey, turnstileToken: turnstileToken }),
    });
    sessionId = data.sessionId;
    sessionToken = data.sessionToken;
    // SG-2: disclosure FIRST — from session creation, before anything else.
    if (data.disclosure) addMessage('assistant', data.disclosure);
    if (data.outline) setIntakeProgress(data.outline);
    if (els.turnstile) els.turnstile.hidden = true;
    els.input.disabled = false;
    setStatus('');
  }
  async function start() {
    els.input.disabled = true;
    try {
      var cfg = await call('/api/widget-config?siteKey=' + encodeURIComponent(siteKey));
      if (!cfg.enabled) { setStatus('Ellie is not enabled for this site.'); return; }
      if (!cfg.turnstileSiteKey) { setStatus('Ellie is away right now. You can still reach a person any time with “Talk to a human” above.'); return; }
      var tries = 0;
      (function renderTurnstile() {
        if (window.turnstile && els.turnstile) {
          window.turnstile.render(els.turnstile, {
            sitekey: cfg.turnstileSiteKey,
            callback: function (token) {
              createSession(token).catch(function () {
                setStatus('Ellie is away right now. You can still reach a person any time with “Talk to a human” above.');
              });
            },
            'error-callback': function () { setStatus('The human check could not load — a person is still reachable any time with “Talk to a human” above.'); },
          });
        } else if (tries++ < 40) {
          setTimeout(renderTurnstile, 250);
        } else {
          setStatus('Ellie is away right now. You can still reach a person any time with “Talk to a human” above.');
        }
      })();
    } catch (e) {
      setStatus('Ellie is away right now. You can still reach a person any time with “Talk to a human” above.');
    }
  }
  document.querySelectorAll('[data-starter]').forEach(function (b) {
    b.addEventListener('click', function () { els.input.value = b.getAttribute('data-starter'); els.input.focus(); });
  });
  els.composer.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var text = els.input.value.trim();
    if (!text || !sessionId) return;
    els.input.value = '';
    els.starters.hidden = true;
    addMessage('user', text);
    try {
      var data = await call('/api/chat/sessions/' + sessionId + '/messages', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text }),
      });
      if (data.reply) addMessage('assistant', data.reply);
      if (data.outline) {
        setIntakeProgress(data.outline);
        var allAnswered = data.outline.intake && data.outline.intake.every(function (f) { return f.answered; });
        if (allAnswered) finalizeAndRender();
      }
    } catch (e) { setStatus(e.message); }
  });
  els.file.addEventListener('change', async function () {
    var f = els.file.files[0]; els.file.value = '';
    if (!f || !sessionId) return;
    if (f.size > 2 * 1024 * 1024) { setStatus('That file is over the 2 MB upload limit and was not sent.'); return; }
    var fd = new FormData(); fd.append('file', f);
    try {
      await call('/api/chat/sessions/' + sessionId + '/uploads', { method: 'POST', body: fd });
      setStatus('Uploaded ' + f.name + ' — Ellie will use its contents in the analysis.');
    } catch (e) { setStatus(e.message); }
  });
  document.getElementById('talk-human').addEventListener('click', async function (ev) {
    ev.preventDefault();
    if (!sessionId) { setStatus('Start a conversation first, or use the site contact page — a person will take it from there.'); return; }
    try {
      await call('/api/chat/sessions/' + sessionId + '/escalate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      setStatus('Done — a support case was filed with this conversation attached. A person on the ElectroHire team will take it from there.');
    } catch (e) { setStatus(e.message); }
  });
  start();
})();
