/* Ellie panel — Phase E (spec 002, E-06). Self-contained; talks only to
 * OUR Ellie service on this origin:
 *   GET  /api/widget-config?siteKey=        (enabled check)
 *   POST /api/chat/sessions                 { siteKey } -> session + disclosure
 *   GET  /api/chat/sessions/:id/messages
 *   POST /api/chat/sessions/:id/messages    { content }
 *   POST /api/chat/sessions/:id/upload      multipart file (service cap 2 MB)
 *   POST /api/chat/sessions/:id/finalize
 *   POST /api/chat/sessions/:id/escalate    ("Talk to a human" -> support case)
 *   GET  /api/analyses?sessionId=:id        (plan + six outputs)
 * SG-2: the disclosure message comes from the service's session creation
 * and is rendered BEFORE any user message. SG-3: no confidence percentage
 * is ever rendered. E-10: "Talk to a human" is always visible and carries
 * no response-time promise. */
(function () {
  var params = new URLSearchParams(location.search);
  var siteKey = params.get('siteKey') || '';
  var sessionId = null;
  var els = {
    messages: document.getElementById('messages'),
    starters: document.getElementById('starters'),
    status: document.getElementById('status'),
    input: document.getElementById('input'),
    file: document.getElementById('file'),
    plan: document.getElementById('plan'),
    planSections: document.getElementById('plan-sections'),
    outline: document.getElementById('outline'),
  };
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function addMessage(role, content) {
    var div = document.createElement('div');
    div.className = 'ep-msg ' + (role === 'user' ? 'ep-msg-user' : 'ep-msg-ellie');
    div.innerHTML = '<span class="ep-msg-label">' + (role === 'user' ? 'You' : 'Ellie — AI analyst') + '</span>' + esc(content);
    els.messages.appendChild(div);
    els.messages.scrollTop = els.messages.scrollHeight;
  }
  function setStatus(t) { els.status.textContent = t || ''; }
  function setOutline(states) {
    if (!states) return;
    els.outline.querySelectorAll('li').forEach(function (li) {
      var s = states[li.getAttribute('data-section')];
      if (s) li.querySelector('.ep-state').textContent = s;
    });
  }
  async function call(path, init) {
    var r = await fetch(path, init);
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(data.error || ('Request failed (' + r.status + ')'));
    return data;
  }
  async function refreshPlan() {
    if (!sessionId) return;
    try {
      var data = await call('/api/analyses?sessionId=' + encodeURIComponent(sessionId));
      var a = (data.analyses || [])[0];
      if (!a || !(a.outputs || []).length) return;
      els.plan.hidden = false;
      setOutline(Object.fromEntries(a.outputs.map(function (o) { return [o.section, o.status === 'approved' ? 'Approved' : 'Draft']; })));
      els.planSections.innerHTML = a.outputs.map(function (o) {
        return '<details><summary><strong>' + esc(o.section) + '</strong> ' +
          '<span class="ep-tag">' + (o.status === 'approved' ? 'Approved' : 'Draft — AI-drafted') + '</span> v' + o.version + '</summary>' +
          '<p>' + esc(o.content) + '</p></details>';
      }).join('');
    } catch (e) { /* plan not ready yet */ }
  }
  async function start() {
    try {
      var cfg = await call('/api/widget-config?siteKey=' + encodeURIComponent(siteKey));
      if (!cfg.enabled) { setStatus('Ellie is not enabled for this site.'); return; }
      var data = await call('/api/chat/sessions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteKey: siteKey }),
      });
      sessionId = data.session.id;
      // SG-2: disclosure FIRST — rendered from session creation, before starters are enabled.
      (data.messages || []).forEach(function (m) { addMessage(m.role, m.content); });
      if (data.session.outline) setOutline(data.session.outline);
    } catch (e) {
      setStatus('Ellie is away right now. You can still reach a person any time with “Talk to a human” above.');
    }
  }
  document.querySelectorAll('[data-starter]').forEach(function (b) {
    b.addEventListener('click', function () { els.input.value = b.getAttribute('data-starter'); els.input.focus(); });
  });
  document.getElementById('composer').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var text = els.input.value.trim();
    if (!text || !sessionId) return;
    els.input.value = '';
    els.starters.hidden = true;
    addMessage('user', text);
    try {
      var data = await call('/api/chat/sessions/' + sessionId + '/messages', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      (data.messages || (data.message ? [data.message] : [])).forEach(function (m) { addMessage(m.role, m.content); });
      if (data.outline) setOutline(data.outline);
      refreshPlan();
    } catch (e) { setStatus(e.message); }
  });
  els.file.addEventListener('change', async function () {
    var f = els.file.files[0]; els.file.value = '';
    if (!f || !sessionId) return;
    if (f.size > 2 * 1024 * 1024) { setStatus('That file is over the 2 MB upload limit and was not sent.'); return; }
    var fd = new FormData(); fd.append('file', f);
    try {
      await call('/api/chat/sessions/' + sessionId + '/upload', { method: 'POST', body: fd });
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
