/**
 * The embeddable web chat widget.
 *
 * Served as plain JavaScript from /api/webchat/widget.js and pasted into a
 * customer's site with one script tag. Constraints that shaped it:
 *
 *  - It runs on someone else's page, so it must not depend on a framework,
 *    must not touch globals beyond one namespaced key, and must scope every
 *    style. All styling lives inside a shadow root so the host page's CSS
 *    cannot break the widget and the widget cannot break the host page.
 *  - All visitor text is written with textContent, never innerHTML, so a
 *    message can never inject markup into the host page.
 *  - The API origin is read from the script tag's own src, so the same file
 *    works in development and production with nothing to configure.
 *  - Polling backs off when the tab is hidden; an idle tab should not keep
 *    hitting the API.
 */

export const WIDGET_SOURCE = String.raw`(function () {
  'use strict';
  if (window.__aiChatWidgetLoaded) return;
  window.__aiChatWidgetLoaded = true;

  var script = document.currentScript || (function () {
    var all = document.getElementsByTagName('script');
    for (var i = all.length - 1; i >= 0; i--) {
      if (all[i].src && all[i].src.indexOf('/api/webchat/widget.js') !== -1) return all[i];
    }
    return null;
  })();
  if (!script) return;

  var siteKey = script.getAttribute('data-site-key');
  if (!siteKey) { console.warn('[chat] missing data-site-key'); return; }

  var apiBase = script.src.replace(/\/api\/webchat\/widget\.js.*$/, '');
  var base = apiBase + '/api/webchat/' + encodeURIComponent(siteKey);
  var storeKey = 'aichat_token_' + siteKey;

  var accent = script.getAttribute('data-accent') || '#4f46e5';
  var title = script.getAttribute('data-title') || '';
  var greeting = script.getAttribute('data-greeting') || 'Hi! How can we help?';

  var token = null;
  try { token = localStorage.getItem(storeKey); } catch (e) { /* private mode */ }

  var lastId = 0;
  var open = false;
  var polling = null;
  var seen = {};

  // --- shell -------------------------------------------------------------
  var host = document.createElement('div');
  host.style.cssText = 'position:fixed;bottom:0;right:0;z-index:2147483000;';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  document.body.appendChild(host);

  var style = document.createElement('style');
  style.textContent = [
    ':host,*{box-sizing:border-box}',
    '.launcher{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;',
    'border:0;cursor:pointer;background:' + accent + ';color:#fff;font-size:24px;line-height:1;',
    'box-shadow:0 6px 24px rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center}',
    '.panel{position:fixed;bottom:88px;right:20px;width:360px;max-width:calc(100vw - 32px);',
    'height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:14px;display:none;',
    'flex-direction:column;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.25);',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
    '.panel.open{display:flex}',
    '.head{background:' + accent + ';color:#fff;padding:14px 16px;font-size:15px;font-weight:600;',
    'display:flex;align-items:center;justify-content:space-between}',
    '.close{background:none;border:0;color:#fff;font-size:20px;cursor:pointer;padding:0 4px;line-height:1}',
    '.log{flex:1;overflow-y:auto;padding:14px;background:#f7f7f9;display:flex;flex-direction:column;gap:8px}',
    '.msg{max-width:82%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;',
    'white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}',
    '.msg.you{align-self:flex-end;background:' + accent + ';color:#fff;border-bottom-right-radius:4px}',
    '.msg.agent{align-self:flex-start;background:#fff;color:#111;border:1px solid #e6e6ea;border-bottom-left-radius:4px}',
    '.note{align-self:center;font-size:12px;color:#8a8a95;padding:4px}',
    '.bar{display:flex;gap:8px;padding:10px;border-top:1px solid #e6e6ea;background:#fff}',
    '.bar input{flex:1;border:1px solid #dcdce3;border-radius:9px;padding:10px 12px;font-size:14px;outline:none;min-width:0}',
    '.bar input:focus{border-color:' + accent + '}',
    '.bar button{border:0;border-radius:9px;background:' + accent + ';color:#fff;padding:0 15px;',
    'font-size:14px;font-weight:600;cursor:pointer}',
    '.bar button:disabled{opacity:.5;cursor:default}',
    '@media (max-width:420px){.panel{right:8px;left:8px;width:auto;bottom:80px}}'
  ].join('');
  root.appendChild(style);

  var launcher = document.createElement('button');
  launcher.className = 'launcher';
  launcher.setAttribute('aria-label', 'Open chat');
  launcher.textContent = '\u{1F4AC}';
  root.appendChild(launcher);

  var panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat');
  root.appendChild(panel);

  var head = document.createElement('div');
  head.className = 'head';
  var headText = document.createElement('span');
  headText.textContent = title || 'Chat with us';
  var closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.setAttribute('aria-label', 'Close chat');
  closeBtn.textContent = '×';
  head.appendChild(headText);
  head.appendChild(closeBtn);
  panel.appendChild(head);

  var log = document.createElement('div');
  log.className = 'log';
  log.setAttribute('aria-live', 'polite');
  panel.appendChild(log);

  var bar = document.createElement('form');
  bar.className = 'bar';
  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type a message…';
  input.setAttribute('aria-label', 'Message');
  input.maxLength = 2000;
  var send = document.createElement('button');
  send.type = 'submit';
  send.textContent = 'Send';
  bar.appendChild(input);
  bar.appendChild(send);
  panel.appendChild(bar);

  // --- rendering ---------------------------------------------------------
  function addMessage(from, text) {
    var el = document.createElement('div');
    el.className = 'msg ' + (from === 'you' ? 'you' : 'agent');
    el.textContent = text;              // never innerHTML
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  function addNote(text) {
    var el = document.createElement('div');
    el.className = 'note';
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  // --- transport ---------------------------------------------------------
  function post(path, body) {
    return fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        return { status: r.status, body: j };
      });
    });
  }

  function startSession() {
    return post('/session', { token: token }).then(function (r) {
      if (r.status !== 200) return false;
      token = r.body.token;
      try { localStorage.setItem(storeKey, token); } catch (e) { /* ignore */ }
      if (!title && r.body.business_name) headText.textContent = r.body.business_name;
      return true;
    }).catch(function () { return false; });
  }

  function poll() {
    if (!token) return Promise.resolve();
    return fetch(base + '/messages?since=' + lastId + '&token=' + encodeURIComponent(token))
      .then(function (r) {
        if (r.status === 401) {
          // Session aged out. Start a new one rather than showing an error.
          token = null;
          try { localStorage.removeItem(storeKey); } catch (e) { /* ignore */ }
          return startSession();
        }
        if (!r.ok) return null;
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.messages) return;
        for (var i = 0; i < data.messages.length; i++) {
          var m = data.messages[i];
          if (m.id > lastId) lastId = m.id;
          if (seen[m.id]) continue;
          seen[m.id] = true;
          addMessage(m.from, m.text || '');
        }
      })
      .catch(function () { /* transient; the next tick retries */ });
  }

  function startPolling() {
    if (polling) return;
    var tick = function () {
      if (document.hidden && !open) return;   // idle tabs stay quiet
      poll();
    };
    polling = setInterval(tick, 3000);
    tick();
  }

  function stopPolling() {
    if (polling) { clearInterval(polling); polling = null; }
  }

  // --- interaction -------------------------------------------------------
  function openPanel() {
    open = true;
    panel.classList.add('open');
    launcher.setAttribute('aria-label', 'Close chat');
    input.focus();

    if (!token) {
      startSession().then(function (ok) {
        if (!ok) { addNote('Chat is unavailable right now.'); return; }
        if (!log.childNodes.length) addMessage('agent', greeting);
        startPolling();
      });
    } else {
      if (!log.childNodes.length) addMessage('agent', greeting);
      startPolling();
    }
  }

  function closePanel() {
    open = false;
    panel.classList.remove('open');
    launcher.setAttribute('aria-label', 'Open chat');
  }

  launcher.addEventListener('click', function () { open ? closePanel() : openPanel(); });
  closeBtn.addEventListener('click', closePanel);

  bar.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;

    input.value = '';
    send.disabled = true;
    addMessage('you', text);

    // A client id makes a retried submit idempotent server-side.
    var clientId = String(Date.now()) + '_' + Math.random().toString(36).slice(2, 8);

    post('/message', { token: token, text: text, client_message_id: clientId })
      .then(function (r) {
        if (r.status === 401) {
          return startSession().then(function () {
            return post('/message', { token: token, text: text, client_message_id: clientId });
          });
        }
        if (r.status === 429) addNote('Please slow down a moment.');
        else if (r.status >= 400) addNote("That didn't send. Please try again.");
        return r;
      })
      .catch(function () { addNote("That didn't send. Please try again."); })
      .then(function () {
        send.disabled = false;
        input.focus();
        setTimeout(poll, 900);
      });
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && open) poll();
  });

  window.addEventListener('beforeunload', stopPolling);
})();
`;
