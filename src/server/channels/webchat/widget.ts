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
 *  - All visitor and agent text is written with textContent, never innerHTML,
 *    so a message can never inject markup into the host page.
 *  - The API origin is read from the script tag's own src, so the same file
 *    works in development and production with nothing to configure.
 *  - Polling backs off when the tab is hidden and slows down when a
 *    conversation goes quiet; an idle tab should not keep hitting the API.
 *
 * Appearance is customisable from the embed tag alone (accent, title,
 * greeting, position, launcher label) because a business should not need us to
 * make it match their site.
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
  var seenKey = 'aichat_seen_' + siteKey;

  function attr(name, fallback) {
    var v = script.getAttribute(name);
    return v === null || v === '' ? fallback : v;
  }

  var accent = attr('data-accent', '#4f46e5');
  var title = attr('data-title', '');
  var subtitle = attr('data-subtitle', 'We typically reply in a few minutes');
  var greeting = attr('data-greeting', 'Hi! How can we help?');
  var launchLabel = attr('data-label', '');
  var side = attr('data-position', 'right') === 'left' ? 'left' : 'right';

  var token = null;
  var lastSeenId = 0;
  try {
    token = localStorage.getItem(storeKey);
    lastSeenId = parseInt(localStorage.getItem(seenKey) || '0', 10) || 0;
  } catch (e) { /* private mode */ }

  var lastId = 0;
  var open = false;
  var polling = null;
  var pollMs = 3000;
  var quietSince = Date.now();
  var seen = {};
  var unread = 0;
  var awaitingReply = false;

  // --- shell -------------------------------------------------------------
  var host = document.createElement('div');
  host.style.cssText = 'position:fixed;bottom:0;' + side + ':0;z-index:2147483000;';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  document.body.appendChild(host);

  var style = document.createElement('style');
  style.textContent = [
    ':host,*{box-sizing:border-box}',
    '@keyframes aic-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
    '@keyframes aic-pop{from{opacity:0;transform:scale(.9) translateY(8px)}to{opacity:1;transform:none}}',
    '@keyframes aic-blink{0%,80%,100%{opacity:.25}40%{opacity:1}}',

    '.launcher{position:fixed;bottom:20px;' + side + ':20px;min-width:56px;height:56px;',
    'border-radius:28px;border:0;cursor:pointer;background:' + accent + ';color:#fff;',
    'display:flex;align-items:center;gap:9px;padding:0 18px;font-size:15px;font-weight:600;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
    'box-shadow:0 6px 22px rgba(0,0,0,.24);transition:transform .15s ease,box-shadow .15s ease}',
    '.launcher:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(0,0,0,.28)}',
    '.launcher svg{width:24px;height:24px;flex:0 0 24px}',
    '.launcher.iconOnly{padding:0;justify-content:center;width:56px}',

    '.badge{position:absolute;top:-3px;' + side + ':-3px;min-width:21px;height:21px;border-radius:11px;',
    'background:#ef4444;color:#fff;font-size:11px;font-weight:700;display:none;',
    'align-items:center;justify-content:center;padding:0 6px;border:2px solid #fff}',
    '.badge.show{display:flex}',

    '.panel{position:fixed;bottom:88px;' + side + ':20px;width:372px;max-width:calc(100vw - 32px);',
    'height:560px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;display:none;',
    'flex-direction:column;overflow:hidden;box-shadow:0 16px 56px rgba(0,0,0,.26);',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
    '.panel.open{display:flex;animation:aic-pop .18s ease}',

    '.head{background:' + accent + ';color:#fff;padding:15px 16px;display:flex;',
    'align-items:center;gap:11px}',
    '.avatar{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.22);',
    'display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;flex:0 0 36px}',
    '.headText{flex:1;min-width:0}',
    '.headName{font-size:15px;font-weight:600;line-height:1.3;overflow:hidden;',
    'text-overflow:ellipsis;white-space:nowrap}',
    '.headSub{font-size:12px;opacity:.85;display:flex;align-items:center;gap:5px;margin-top:1px}',
    '.dot{width:7px;height:7px;border-radius:50%;background:#4ade80;flex:0 0 7px}',
    '.close{background:none;border:0;color:#fff;font-size:24px;cursor:pointer;padding:0 2px;',
    'line-height:1;opacity:.85}',
    '.close:hover{opacity:1}',

    '.log{flex:1;overflow-y:auto;padding:16px 14px;background:#f6f7f9;display:flex;',
    'flex-direction:column;gap:3px;-webkit-overflow-scrolling:touch}',
    '.row{display:flex;flex-direction:column;animation:aic-in .18s ease}',
    '.row.you{align-items:flex-end}',
    '.row.agent{align-items:flex-start}',
    '.row+.row{margin-top:9px}',
    '.msg{max-width:84%;padding:10px 13px;border-radius:16px;font-size:14px;line-height:1.5;',
    'white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}',
    '.row.you .msg{background:' + accent + ';color:#fff;border-bottom-right-radius:5px}',
    '.row.agent .msg{background:#fff;color:#16161a;border:1px solid #e7e7ec;',
    'border-bottom-left-radius:5px}',
    '.time{font-size:10.5px;color:#9a9aa5;margin:3px 4px 0}',

    '.typing{display:flex;gap:4px;padding:12px 14px;background:#fff;border:1px solid #e7e7ec;',
    'border-radius:16px;border-bottom-left-radius:5px;width:fit-content}',
    '.typing span{width:6px;height:6px;border-radius:50%;background:#b6b6c0;',
    'animation:aic-blink 1.3s infinite}',
    '.typing span:nth-child(2){animation-delay:.18s}',
    '.typing span:nth-child(3){animation-delay:.36s}',

    '.note{align-self:center;font-size:11.5px;color:#8a8a95;padding:6px 10px;text-align:center}',

    '.bar{display:flex;gap:8px;padding:11px;border-top:1px solid #e9e9ee;background:#fff;',
    'align-items:flex-end}',
    '.bar textarea{flex:1;border:1px solid #dcdce3;border-radius:11px;padding:10px 12px;',
    'font-size:14px;font-family:inherit;outline:none;min-width:0;resize:none;max-height:96px;',
    'line-height:1.45}',
    '.bar textarea:focus{border-color:' + accent + ';box-shadow:0 0 0 3px ' + accent + '22}',
    '.bar button{border:0;border-radius:11px;background:' + accent + ';color:#fff;',
    'width:40px;height:40px;flex:0 0 40px;cursor:pointer;display:flex;align-items:center;',
    'justify-content:center}',
    '.bar button:disabled{opacity:.45;cursor:default}',
    '.bar button svg{width:18px;height:18px}',

    '.credit{text-align:center;font-size:10.5px;color:#a5a5b0;padding:0 0 9px;background:#fff}',

    '@media (max-width:430px){.panel{' + side + ':8px;left:8px;right:8px;width:auto;bottom:82px;',
    'height:calc(100vh - 100px)}}',
    '@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}'
  ].join('');
  root.appendChild(style);

  function svgIcon(paths, extra) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', extra || '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (var i = 0; i < paths.length; i++) {
      var p = document.createElementNS(ns, 'path');
      p.setAttribute('d', paths[i]);
      svg.appendChild(p);
    }
    return svg;
  }

  var launcher = document.createElement('button');
  launcher.className = 'launcher' + (launchLabel ? '' : ' iconOnly');
  launcher.setAttribute('aria-label', 'Open chat');
  launcher.appendChild(svgIcon(['M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z']));
  if (launchLabel) {
    var lbl = document.createElement('span');
    lbl.textContent = launchLabel;
    launcher.appendChild(lbl);
  }
  var badge = document.createElement('span');
  badge.className = 'badge';
  launcher.appendChild(badge);
  root.appendChild(launcher);

  var panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat');
  root.appendChild(panel);

  var head = document.createElement('div');
  head.className = 'head';
  var avatar = document.createElement('div');
  avatar.className = 'avatar';
  var headText = document.createElement('div');
  headText.className = 'headText';
  var headName = document.createElement('div');
  headName.className = 'headName';
  headName.textContent = title || 'Chat with us';
  var headSub = document.createElement('div');
  headSub.className = 'headSub';
  var dot = document.createElement('span');
  dot.className = 'dot';
  var subText = document.createElement('span');
  subText.textContent = subtitle;
  headSub.appendChild(dot);
  headSub.appendChild(subText);
  headText.appendChild(headName);
  headText.appendChild(headSub);
  var closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.setAttribute('aria-label', 'Close chat');
  closeBtn.textContent = '×';
  head.appendChild(avatar);
  head.appendChild(headText);
  head.appendChild(closeBtn);
  panel.appendChild(head);

  var log = document.createElement('div');
  log.className = 'log';
  log.setAttribute('aria-live', 'polite');
  panel.appendChild(log);

  var bar = document.createElement('form');
  bar.className = 'bar';
  var input = document.createElement('textarea');
  input.rows = 1;
  input.placeholder = 'Type a message…';
  input.setAttribute('aria-label', 'Message');
  input.maxLength = 2000;
  var send = document.createElement('button');
  send.type = 'submit';
  send.setAttribute('aria-label', 'Send message');
  send.appendChild(svgIcon(['M22 2 11 13', 'M22 2l-7 20-4-9-9-4 20-7z']));
  bar.appendChild(input);
  bar.appendChild(send);
  panel.appendChild(bar);

  var credit = document.createElement('div');
  credit.className = 'credit';
  credit.textContent = 'Powered by AI';
  panel.appendChild(credit);

  // --- helpers -----------------------------------------------------------
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '\u{1F4AC}';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  function clockOf(iso) {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function atBottom() {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  }

  function scrollDown(force) {
    if (force || atBottom()) log.scrollTop = log.scrollHeight;
  }

  function addMessage(from, text, at) {
    var stick = atBottom();
    var row = document.createElement('div');
    row.className = 'row ' + (from === 'you' ? 'you' : 'agent');

    var bubble = document.createElement('div');
    bubble.className = 'msg';
    bubble.textContent = text;          // never innerHTML
    row.appendChild(bubble);

    if (at) {
      var time = document.createElement('div');
      time.className = 'time';
      time.textContent = clockOf(at);
      row.appendChild(time);
    }

    log.insertBefore(row, typingRow.parentNode === log ? typingRow : null);
    scrollDown(stick || from === 'you');
  }

  function addNote(text) {
    var el = document.createElement('div');
    el.className = 'note';
    el.textContent = text;
    log.appendChild(el);
    scrollDown(true);
  }

  var typingRow = document.createElement('div');
  typingRow.className = 'row agent';
  var typingBubble = document.createElement('div');
  typingBubble.className = 'typing';
  typingBubble.appendChild(document.createElement('span'));
  typingBubble.appendChild(document.createElement('span'));
  typingBubble.appendChild(document.createElement('span'));
  typingRow.appendChild(typingBubble);

  function showTyping(on) {
    if (on && typingRow.parentNode !== log) {
      log.appendChild(typingRow);
      scrollDown(true);
    } else if (!on && typingRow.parentNode === log) {
      log.removeChild(typingRow);
    }
  }

  function setUnread(n) {
    unread = n;
    if (n > 0) {
      badge.textContent = n > 9 ? '9+' : String(n);
      badge.classList.add('show');
    } else {
      badge.classList.remove('show');
    }
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
      if (!title && r.body.business_name) headName.textContent = r.body.business_name;
      avatar.textContent = initials(r.body.business_name || r.body.agent_name);
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
          return startSession().then(function () { return null; });
        }
        if (!r.ok) return null;
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.messages || !data.messages.length) return;

        var fresh = 0;
        for (var i = 0; i < data.messages.length; i++) {
          var m = data.messages[i];
          if (m.id > lastId) lastId = m.id;
          if (seen[m.id]) continue;
          seen[m.id] = true;

          if (m.from === 'agent') { showTyping(false); awaitingReply = false; fresh++; }
          addMessage(m.from, m.text || '', m.at);
        }

        if (fresh) {
          quietSince = Date.now();
          pollMs = 3000;                       // a live conversation polls briskly
          if (!open) setUnread(unread + fresh);
          else {
            lastSeenId = lastId;
            try { localStorage.setItem(seenKey, String(lastSeenId)); } catch (e) { /* ignore */ }
          }
        }
      })
      .catch(function () { /* transient; the next tick retries */ });
  }

  function schedule() {
    if (polling) clearTimeout(polling);
    // Quiet conversations ease off to 15s so an open tab is not a busy loop.
    var quietFor = Date.now() - quietSince;
    if (!awaitingReply && quietFor > 60000) pollMs = 15000;
    else if (!awaitingReply && quietFor > 20000) pollMs = 6000;

    polling = setTimeout(function () {
      if (!document.hidden || open) {
        poll().then(schedule);
      } else {
        schedule();
      }
    }, pollMs);
  }

  function stopPolling() {
    if (polling) { clearTimeout(polling); polling = null; }
  }

  // --- interaction -------------------------------------------------------
  function openPanel() {
    open = true;
    panel.classList.add('open');
    launcher.setAttribute('aria-label', 'Close chat');
    setUnread(0);
    input.focus();

    var begin = function () {
      if (!log.querySelector('.row')) addMessage('agent', greeting, new Date().toISOString());
      quietSince = Date.now();
      pollMs = 3000;
      poll().then(schedule);
    };

    if (!token) {
      startSession().then(function (ok) {
        if (!ok) { addNote('Chat is unavailable right now. Please try again later.'); return; }
        begin();
      });
    } else {
      if (!avatar.textContent) avatar.textContent = initials(headName.textContent);
      begin();
    }
  }

  function closePanel() {
    open = false;
    panel.classList.remove('open');
    launcher.setAttribute('aria-label', 'Open chat');
  }

  launcher.addEventListener('click', function () { open ? closePanel() : openPanel(); });
  closeBtn.addEventListener('click', closePanel);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open) closePanel();
  });

  // Enter sends, Shift+Enter makes a new line.
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      bar.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  });

  bar.addEventListener('submit', function (e) {
    if (e && e.preventDefault) e.preventDefault();
    var text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';
    send.disabled = true;
    addMessage('you', text, new Date().toISOString());
    showTyping(true);
    awaitingReply = true;
    quietSince = Date.now();
    pollMs = 1500;                              // expect a reply shortly

    var clientId = String(Date.now()) + '_' + Math.random().toString(36).slice(2, 8);

    post('/message', { token: token, text: text, client_message_id: clientId })
      .then(function (r) {
        if (r.status === 401) {
          return startSession().then(function () {
            return post('/message', { token: token, text: text, client_message_id: clientId });
          });
        }
        return r;
      })
      .then(function (r) {
        if (r && r.status === 429) {
          showTyping(false); awaitingReply = false;
          addNote('You are sending messages a little quickly. Please wait a moment.');
        } else if (r && r.status >= 400) {
          showTyping(false); awaitingReply = false;
          addNote("That didn't send. Please try again.");
        }
      })
      .catch(function () {
        showTyping(false); awaitingReply = false;
        addNote("That didn't send. Check your connection and try again.");
      })
      .then(function () {
        send.disabled = false;
        input.focus();
        schedule();
      });

    // The agent will not always answer; stop the dots rather than leave them
    // spinning forever if nothing arrives.
    setTimeout(function () {
      if (awaitingReply) { showTyping(false); awaitingReply = false; }
    }, 45000);
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && open) poll();
  });

  window.addEventListener('beforeunload', stopPolling);
})();
`;
