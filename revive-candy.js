// ==UserScript==
// @name         Torn - Mini-profile Candy Button
// @namespace    torn-candy-button
// @version      1.0.0
// @description  Adds a candy button to the Torn mini-profile that sends an item with a preset message
// @match        https://www.torn.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Settings ----------
  const ITEM_ID = 310;
  const AMOUNT = 1;
  const MESSAGE = 'I am sincerely sorry about your overdose. Thank you for being such a wonderful patient. Here is a little treat for your flight to Switzerland. :)';
  const CONFIRM_BEFORE_SENDING = false; // set to true to get a confirm() popup before each send
  const LOW_QTY = 50;        // candy turns yellow below this quantity
  const CRITICAL_QTY = 10;   // candy turns red below this quantity (or when none left)
  const COLOR_LOW = '#f2c200';
  const COLOR_CRITICAL = '#e03c2c';
  const STOCK_CACHE_MS = 30000; // how long the inventory count is reused before refetching
  // ------------------------------

  const BTN_ATTR = 'data-candy-btn';

  // Torn's CSRF token ("rfcv"): stored in the rfc_v cookie (Torn's own getRFC() reads the same one)
  function getRFC() {
    try {
      if (typeof window.getRFC === 'function') {
        const v = window.getRFC();
        if (v) return v;
      }
    } catch (e) { /* fall through */ }
    const m = document.cookie.match(/(?:^|;\s*)rfc_v=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function toast(text, ok) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText =
      'position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:2147483647;' +
      'padding:10px 16px;border-radius:6px;font:13px Arial,sans-serif;color:#fff;max-width:80vw;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.5);background:' + (ok ? '#4a8f2a' : '#b23a2a');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  async function sendCandy(userId, btn) {
    const rfcv = getRFC();
    if (!rfcv) {
      toast('Candy: could not find the rfcv token (rfc_v cookie).', false);
      return;
    }
    if (CONFIRM_BEFORE_SENDING && !confirm('Send candy to user ' + userId + '?')) return;

    const body = new URLSearchParams({
      step: 'sendItemAction',
      confirm: '1',
      itemID: String(ITEM_ID),
      userID: String(userId),
      tag: MESSAGE,
      amount: String(AMOUNT),
    });

    btn.style.opacity = '0.5';
    btn.style.pointerEvents = 'none';
    try {
      const res = await fetch('https://www.torn.com/item.php?rfcv=' + encodeURIComponent(rfcv), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: body.toString(),
      });
      const raw = await res.text();
      let msg = raw;
      try {
        const j = JSON.parse(raw);
        msg = j.text || j.msg || j.message || raw;
      } catch (e) { /* not JSON */ }
      msg = String(msg).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

      let ok = res.ok;
      try { const j = JSON.parse(raw); if (typeof j.success === 'boolean') ok = ok && j.success; } catch (e) {}
      toast(msg || (ok ? 'Candy sent!' : 'Request failed (' + res.status + ')'), ok);

      if (ok) {
        if (stockQty !== null) stockQty = Math.max(0, stockQty - AMOUNT);
        refreshAllButtons();
        setTimeout(() => getStock(true).then(refreshAllButtons), 1000); // confirm with real inventory
      }
    } catch (err) {
      toast('Candy: network error - ' + err.message, false);
    } finally {
      btn.style.opacity = '';
      btn.style.pointerEvents = '';
    }
  }

  // ---------- Inventory / color indicator ----------
  let stockQty = null;       // null = unknown
  let stockTime = 0;
  let stockPromise = null;

  async function fetchStock() {
    const rfcv = getRFC();
    if (!rfcv) return null;
    let start = 0, total = Infinity, seen = 0, found = 0, loops = 0;
    while (seen < total && loops++ < 10) {
      const body = new URLSearchParams({
        step: 'getCategoryList',
        itemName: 'Candy',
        start: String(start),
        test: 'true',
        prevtotal: '0',
      });
      const res = await fetch('https://www.torn.com/item.php?rfcv=' + encodeURIComponent(rfcv), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: body.toString(),
      });
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.list || []);
      for (const it of items) {
        if (Number(it.itemID ?? it.ID) === ITEM_ID) found += Number(it.Qty ?? it.qty ?? 0);
      }
      if (!items.length) break;
      seen += items.length;
      start += items.length;
      total = Array.isArray(data) ? items.length : Number(data.total ?? items.length);
    }
    return found; // 0 when the item isn't in the list
  }

  function getStock(force) {
    if (!force && stockQty !== null && Date.now() - stockTime < STOCK_CACHE_MS) {
      return Promise.resolve(stockQty);
    }
    if (stockPromise) return stockPromise;
    stockPromise = fetchStock()
      .then((q) => { if (q !== null) { stockQty = q; stockTime = Date.now(); } return stockQty; })
      .catch(() => stockQty)
      .finally(() => { stockPromise = null; });
    return stockPromise;
  }

  function applyStockColor(btn) {
    let color = '';
    if (stockQty !== null) {
      if (stockQty < CRITICAL_QTY) color = COLOR_CRITICAL;
      else if (stockQty < LOW_QTY) color = COLOR_LOW;
    }
    btn.querySelectorAll('path').forEach((p) => {
      if (color) p.style.setProperty('fill', color, 'important');
      else p.style.removeProperty('fill');
    });
    btn.title = 'Send candy' + (stockQty !== null ? ' (' + stockQty + ' left)' : '');
  }

  function refreshAllButtons() {
    document.querySelectorAll('[' + BTN_ATTR + ']').forEach(applyStockColor);
  }
  // -------------------------------------------------

  function getUserId(list) {
    // Button ids look like "mini-button0-profile-4308195"
    const withId = list.querySelector('[id^="mini-button"]');
    if (withId) {
      const m = withId.id.match(/profile-(\d+)$/);
      if (m) return m[1];
    }
    const a = list.querySelector('a[href*="XID="], a[href*="ID="]');
    if (a) {
      const m = a.getAttribute('href').match(/[?&](?:XID|ID|userID)=(\d+)/);
      if (m) return m[1];
    }
    return null;
  }

  function addButton(list) {
    if (list.querySelector('[' + BTN_ATTR + ']')) return;
    const template = list.querySelector('.profile-button:not([' + BTN_ATTR + '])');
    if (!template) return;
    const userId = getUserId(list);
    if (!userId) return;

    // Clone an active button so we inherit its exact look
    const sourceBtn = Array.from(list.querySelectorAll('.profile-button.active')).pop() || template;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = sourceBtn.className
      .replace(/profile-button-\w+/g, '')
      .replace(/\bdisabled\b/g, '')
      .replace(/withoutLink/g, '') + ' profile-button-candy withoutLink active';
    btn.setAttribute(BTN_ATTR, '1');
    btn.setAttribute('aria-label', 'Send candy');
    btn.title = 'Send candy';
    btn.style.touchAction = 'manipulation';
    btn.style.padding = '0';
    btn.style.margin = '0';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.id = 'mini-button-candy-profile-' + userId;

    const srcSvg = sourceBtn.querySelector('svg');
    const svgClass = srcSvg ? srcSvg.getAttribute('class') : '';
    btn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 46 46" class="' + svgClass + '">' +
      // wrapped candy: body + two wrapper twists + highlight stripe
      '<path d="M15.5 23a7.5 6.2 0 1 0 15 0a7.5 6.2 0 1 0 -15 0Z"/>' +
      '<path d="M16 23L8 15.5V30.5Z"/>' +
      '<path d="M30 23L38 15.5V30.5Z"/>' +
      '</svg>';

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      sendCandy(userId, btn);
    });

    list.appendChild(btn);
    applyStockColor(btn);                 // uses cached count if we have one
    getStock().then(refreshAllButtons);   // otherwise fetch it and recolor
  }

  function scan() {
    document
      .querySelectorAll('[class*="profile-mini-_wrapper"] .buttons-list, .mini-profile-wrapper .buttons-list')
      .forEach(addButton);
  }

  let timer = null;
  const observer = new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; scan(); }, 50);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scan();
})();