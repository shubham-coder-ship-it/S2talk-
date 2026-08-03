/* ====================================================================
   S2 TALK — GAME ENHANCEMENT PATCHES  (enhancements.js)
   Purely additive — loads after app.js, does NOT modify any existing
   function directly. Safe to include or remove without side-effects.

   Features:
   1. Double-click canvas building → instant entry
   2. Smooth fast-travel camera animation (keys 1-9)
   3. Mobile touch D-pad wiring
   4. Car facing angle tracking (for rotation toward movement)
   5. Developer "Reset All Data" (triple-click HUD title or Settings)
   6. Auto-save on tab close / visibility change
   7. Prevent horizontal scrolling on mobile
   ==================================================================== */
(function () {
  'use strict';

  /* ==================================================================
     1. DOUBLE-CLICK ON CANVAS → enter building under cursor
     ================================================================== */
  function waitForCanvas() {
    var canvas = document.getElementById('world');
    if (!canvas) { setTimeout(waitForCanvas, 300); return; }

    canvas.addEventListener('dblclick', function (e) {
      var rect = canvas.getBoundingClientRect();
      var scaleX = (canvas.width || 900) / rect.width;
      var scaleY = (canvas.height || 600) / rect.height;
      var cx = (e.clientX - rect.left) * scaleX;
      var cy = (e.clientY - rect.top) * scaleY;

      var blds = (typeof buildings !== 'undefined') ? buildings : [];
      var hit = null;
      for (var i = 0; i < blds.length; i++) {
        var b = blds[i];
        if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
          hit = b;
          break;
        }
      }
      if (hit) {
        if (typeof visitBuilding === 'function') visitBuilding(hit);
        else if (typeof tryEnter === 'function') {
          if (typeof nearBuilding !== 'undefined') nearBuilding = hit;
          tryEnter();
        }
      }
    });

    /* Also support double-tap on mobile (touchend-based) */
    var lastTap = 0;
    canvas.addEventListener('touchend', function (e) {
      var now = Date.now();
      if (now - lastTap < 350) {
        // Treat as double-tap
        var touch = e.changedTouches[0];
        if (!touch) return;
        var rect = canvas.getBoundingClientRect();
        var scaleX = (canvas.width || 900) / rect.width;
        var scaleY = (canvas.height || 600) / rect.height;
        var cx = (touch.clientX - rect.left) * scaleX;
        var cy = (touch.clientY - rect.top) * scaleY;

        var blds = (typeof buildings !== 'undefined') ? buildings : [];
        for (var i = 0; i < blds.length; i++) {
          var b = blds[i];
          if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
            if (typeof visitBuilding === 'function') visitBuilding(b);
            break;
          }
        }
      }
      lastTap = now;
    });
  }
  waitForCanvas();

  /* ==================================================================
     2. SMOOTH FAST TRAVEL  (keys 1-9)
     Uses capture phase + stopImmediatePropagation to override the
     existing instant-teleport handler in app.js with a smooth lerp.
     ================================================================== */
  var ftAnim = null;

  function smoothFastTravel(tx, ty) {
    if (typeof player === 'undefined') return;
    if (ftAnim) { cancelAnimationFrame(ftAnim); ftAnim = null; }

    var sx = player.x, sy = player.y;
    var t0 = performance.now();
    var dur = 450; // milliseconds

    function step(now) {
      var t = Math.min(1, (now - t0) / dur);
      // ease-out cubic
      var ease = 1 - Math.pow(1 - t, 3);
      player.x = sx + (tx - sx) * ease;
      player.y = sy + (ty - sy) * ease;
      if (t < 1) ftAnim = requestAnimationFrame(step);
      else ftAnim = null;
    }
    ftAnim = requestAnimationFrame(step);
  }

  window.addEventListener('keydown', function (e) {
    if (!e.key) return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;

    var gameScreen = document.getElementById('game');
    if (!gameScreen || !gameScreen.classList.contains('active')) return;

    var n = parseInt(e.key);
    if (isNaN(n) || n < 1 || n > 9) return;

    var blds = (typeof buildings !== 'undefined') ? buildings : [];
    var b = blds[n - 1];
    if (!b) return;

    // Stop the old instant-teleport handler from running
    e.stopImmediatePropagation();

    var pw = (typeof player !== 'undefined' && player.w) ? player.w / 2 : 11;
    smoothFastTravel(b.x + b.w / 2 - pw, b.y + b.h + 20);
    if (typeof toast === 'function') toast('🚇 Fast travel → ' + b.name);
  }, true); // capture phase = fires first

  /* ==================================================================
     3. CAR FACING / ROTATION  — tracks player.angle (radians)
     ================================================================== */
  function patchCarFacing() {
    if (typeof player === 'undefined') return;
    if (player._facingPatched) return;
    player._facingPatched = true;
    player.angle = 0;

    var lastX = player.x, lastY = player.y;
    var LERP = 0.16;

    (function angleTick() {
      requestAnimationFrame(angleTick);
      var dx = player.x - lastX;
      var dy = player.y - lastY;
      if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
        var target = Math.atan2(dy, dx);
        var diff = target - player.angle;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        player.angle += diff * LERP;
      }
      lastX = player.x;
      lastY = player.y;
    })();
  }

  (function waitForPlayer() {
    if (typeof player !== 'undefined') patchCarFacing();
    else setTimeout(waitForPlayer, 400);
  })();

  /* ==================================================================
     4. MOBILE TOUCH D-PAD CONTROLS
     Wires the HTML touch buttons added in index.html to simulate
     keyboard keys (WASD) and action buttons (Enter, Car, Rain).
     ================================================================== */
  // ==========================================================================
  // TOUCH / KEYBOARD MOVEMENT CONTROLS — reusable, single source of truth.
  // startMove/stopMove/handleEnter are shared by every input method (pointer,
  // touch, keyboard) so there is exactly one place that mutates movement
  // state, instead of duplicated press/release logic per input type.
  // ==========================================================================
  var touchHeldKeys = {}; // which movement keys are currently held via touch/pointer

  function startMove(direction, btnEl) {
    if (typeof keys !== 'undefined') keys[direction] = true;
    touchHeldKeys[direction] = true;
    if (btnEl) btnEl.classList.add('pressed');
  }

  function stopMove(direction, btnEl) {
    if (typeof keys !== 'undefined') keys[direction] = false;
    touchHeldKeys[direction] = false;
    if (btnEl) btnEl.classList.remove('pressed');
  }

  function stopAllMoves(tc) {
    if (typeof keys === 'undefined') return;
    Object.keys(touchHeldKeys).forEach(function (k) {
      if (touchHeldKeys[k]) { keys[k] = false; touchHeldKeys[k] = false; }
    });
    if (tc) tc.querySelectorAll('.touch-btn.pressed').forEach(function (b) { b.classList.remove('pressed'); });
  }

  var _lastOneShotAt = 0;
  function debounceOneShot(fn, delayMs) {
    delayMs = delayMs || 350;
    return function () {
      var now = Date.now();
      if (now - _lastOneShotAt < delayMs) return; // swallow accidental double-tap
      _lastOneShotAt = now;
      fn();
    };
  }

  function handleEnter() {
    if (typeof tryEnter === 'function') tryEnter();
  }

  function fireKey(k) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    setTimeout(function () {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
    }, 80);
  }

  // Pointer Events alone already cover touch, mouse, and pen uniformly in
  // every current mobile/desktop browser. We still wire up touchstart/
  // touchend explicitly (as requested) for older/atypical WebViews that
  // lack Pointer Event support — but only one code path binds per device,
  // so presses never double-fire.
  var supportsPointerEvents = typeof window.PointerEvent === 'function';

  function bindPressRelease(el, onPress, onRelease) {
    if (supportsPointerEvents) {
      el.addEventListener('pointerdown', function (e) { e.preventDefault(); onPress(e); });
      el.addEventListener('pointerup', function (e) { onRelease(e); });
      el.addEventListener('pointercancel', function (e) { onRelease(e); });
      el.addEventListener('pointerleave', function (e) { onRelease(e); });
    } else {
      // Fallback for environments without Pointer Event support.
      el.addEventListener('touchstart', function (e) { e.preventDefault(); onPress(e); }, { passive: false });
      el.addEventListener('touchend', function (e) { e.preventDefault(); onRelease(e); }, { passive: false });
      el.addEventListener('touchcancel', function (e) { e.preventDefault(); onRelease(e); }, { passive: false });
      el.addEventListener('mousedown', onPress);
      el.addEventListener('mouseup', onRelease);
      el.addEventListener('mouseleave', onRelease);
    }
    // Long-press can trigger a context menu on some Android browsers,
    // which would otherwise leave the button stuck in the pressed state.
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); onRelease(e); });
  }

  function bindTouchControls() {
    var tc = document.getElementById('touch-controls');
    if (!tc) return;

    // Directional buttons
    tc.querySelectorAll('[data-key]').forEach(function (btn) {
      var direction = btn.dataset.key;
      bindPressRelease(
        btn,
        function () { startMove(direction, btn); },
        function () { stopMove(direction, btn); }
      );
    });

    // Enter button — fires the exact same handler as the keyboard Enter key.
    var enterBtn = document.getElementById('touch-enter-btn');
    if (enterBtn) {
      var debouncedEnter = debounceOneShot(handleEnter);
      bindPressRelease(
        enterBtn,
        function () { enterBtn.classList.add('pressed'); debouncedEnter(); },
        function () { enterBtn.classList.remove('pressed'); }
      );
    }

    // Car mode / rain toggles — one-shot actions, not held-movement, so a
    // simple synthesized keypress is enough.
    var carBtn = document.getElementById('touch-car-btn');
    if (carBtn) bindPressRelease(carBtn, debounceOneShot(function () { fireKey('c'); }), function () {});
    var rainBtn = document.getElementById('touch-rain-btn');
    if (rainBtn) bindPressRelease(rainBtn, debounceOneShot(function () { fireKey('r'); }), function () {});

    // Home — returns to the city overworld from whichever house/modal is open.
    var homeBtn = document.getElementById('touch-home-btn');
    if (homeBtn) bindPressRelease(homeBtn, debounceOneShot(function () { if (typeof closeModal === 'function') closeModal(); }), function () {});

    // Safety net: if a gesture gets interrupted by the OS/browser (app
    // backgrounded, system dialog, tab switch) without a release event
    // ever arriving, force-release every held movement key so the player
    // can't get stuck walking in one direction.
    window.addEventListener('blur', function () { stopAllMoves(tc); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') stopAllMoves(tc);
    });

    // Prevent the page from scrolling while dragging within the control
    // area — belt-and-suspenders alongside the CSS touch-action:none
    // already set on .touch-btn, for browsers that don't fully honor it.
    document.addEventListener('touchmove', function (e) {
      if (e.target && e.target.closest && e.target.closest('#touch-controls')) e.preventDefault();
    }, { passive: false });

    bindControllerDrag(tc);
    bindControllerMinimize(tc);
    bindControllerAutoFade(tc);
    applyControllerEnabledState(tc);
  }

  // ==========================================================================
  // DRAGGABLE POSITIONING — the joystick can be moved anywhere on screen;
  // position is stored as a fraction of the viewport (not raw pixels) so it
  // stays sensible across screen sizes/orientation changes, and is clamped
  // on every drag + on resize so it can never end up off-screen.
  // ==========================================================================
  var CONTROLLER_POS_KEY = 's2talk_controller_pos';

  function clampControllerPosition(tc, leftPx, topPx) {
    var rect = tc.getBoundingClientRect();
    var w = rect.width || 160, h = rect.height || 220;
    var margin = 8;
    var maxLeft = window.innerWidth - w - margin;
    var maxTop = window.innerHeight - h - margin;
    return {
      left: Math.max(margin, Math.min(leftPx, Math.max(margin, maxLeft))),
      top: Math.max(margin, Math.min(topPx, Math.max(margin, maxTop)))
    };
  }

  function saveControllerPosition(leftPx, topPx) {
    try {
      var frac = { xFrac: leftPx / window.innerWidth, yFrac: topPx / window.innerHeight };
      localStorage.setItem(CONTROLLER_POS_KEY, JSON.stringify(frac));
    } catch (e) { /* storage unavailable — position just won't persist */ }
  }

  function loadControllerPosition() {
    try {
      var raw = localStorage.getItem(CONTROLLER_POS_KEY);
      if (!raw) return null;
      var frac = JSON.parse(raw);
      if (typeof frac.xFrac !== 'number' || typeof frac.yFrac !== 'number') return null;
      return { left: frac.xFrac * window.innerWidth, top: frac.yFrac * window.innerHeight };
    } catch (e) { return null; }
  }

  function applyControllerPosition(tc, leftPx, topPx) {
    var clamped = clampControllerPosition(tc, leftPx, topPx);
    tc.style.left = clamped.left + 'px';
    tc.style.top = clamped.top + 'px';
    tc.style.bottom = 'auto';
    tc.style.right = 'auto';
  }

  function bindControllerDrag(tc) {
    var handle = document.getElementById('touch-controls-handle');
    if (!handle) return;

    // Restore a saved position, if any; otherwise the CSS default
    // (bottom-left, safe-area aware) applies.
    var saved = loadControllerPosition();
    if (saved) applyControllerPosition(tc, saved.left, saved.top);

    var dragging = false, startX = 0, startY = 0, originLeft = 0, originTop = 0;

    function onDragStart(e) {
      dragging = true;
      tc.classList.add('dragging');
      var rect = tc.getBoundingClientRect();
      originLeft = rect.left; originTop = rect.top;
      var point = e.touches ? e.touches[0] : e;
      startX = point.clientX; startY = point.clientY;
      markControllerActive(tc);
      e.preventDefault();
    }
    function onDragMove(e) {
      if (!dragging) return;
      var point = e.touches ? e.touches[0] : e;
      var dx = point.clientX - startX, dy = point.clientY - startY;
      applyControllerPosition(tc, originLeft + dx, originTop + dy);
      e.preventDefault();
    }
    function onDragEnd() {
      if (!dragging) return;
      dragging = false;
      tc.classList.remove('dragging');
      var rect = tc.getBoundingClientRect();
      saveControllerPosition(rect.left, rect.top);
      markControllerActive(tc);
    }

    if (typeof window.PointerEvent === 'function') {
      handle.addEventListener('pointerdown', onDragStart);
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragEnd);
      window.addEventListener('pointercancel', onDragEnd);
    } else {
      handle.addEventListener('touchstart', onDragStart, { passive: false });
      window.addEventListener('touchmove', onDragMove, { passive: false });
      window.addEventListener('touchend', onDragEnd);
      window.addEventListener('touchcancel', onDragEnd);
      handle.addEventListener('mousedown', onDragStart);
      window.addEventListener('mousemove', onDragMove);
      window.addEventListener('mouseup', onDragEnd);
    }

    // Re-clamp on resize/orientation change so a saved position from a
    // wider screen can't leave the controller partly off-screen.
    window.addEventListener('resize', function () {
      var rect = tc.getBoundingClientRect();
      if (tc.style.left && tc.style.left !== 'auto') applyControllerPosition(tc, rect.left, rect.top);
    });
  }

  // ==========================================================================
  // MINIMIZE / MAXIMIZE — collapses the D-pad down to just the drag handle
  // bar, freeing up screen space. State persists across sessions.
  // ==========================================================================
  var CONTROLLER_MIN_KEY = 's2talk_controller_minimized';

  function bindControllerMinimize(tc) {
    var toggleBtn = document.getElementById('touch-controls-toggle');
    if (!toggleBtn) return;

    function setMinimized(min) {
      tc.classList.toggle('minimized', min);
      toggleBtn.textContent = min ? '+' : '–';
      toggleBtn.setAttribute('aria-label', min ? 'Maximize controls' : 'Minimize controls');
      try { localStorage.setItem(CONTROLLER_MIN_KEY, min ? '1' : '0'); } catch (e) {}
      updateControllerFootprint();
    }

    setMinimized(localStorage.getItem(CONTROLLER_MIN_KEY) === '1');

    toggleBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setMinimized(!tc.classList.contains('minimized'));
      markControllerActive(tc);
    });
  }

  // ==========================================================================
  // AUTO-FADE — fades to 80% opacity after 3s of no interaction with the
  // controls, and instantly restores full visibility on any touch.
  // ==========================================================================
  var controllerIdleTimer = null;

  function markControllerActive(tc) {
    var actions = document.getElementById('touch-action-btns');
    tc.classList.remove('idle');
    if (actions) actions.classList.remove('idle');
    if (controllerIdleTimer) clearTimeout(controllerIdleTimer);
    controllerIdleTimer = setTimeout(function () {
      tc.classList.add('idle');
      if (actions) actions.classList.add('idle');
    }, 3000);
  }

  function bindControllerAutoFade(tc) {
    var actions = document.getElementById('touch-action-btns');
    markControllerActive(tc); // start the 3s countdown immediately
    var restore = function () { markControllerActive(tc); };
    tc.addEventListener('pointerdown', restore);
    tc.addEventListener('touchstart', restore, { passive: true });
    if (actions) {
      actions.addEventListener('pointerdown', restore);
      actions.addEventListener('touchstart', restore, { passive: true });
    }
  }

  // ==========================================================================
  // FOOTPRINT — exposes the controller's current on-screen height as a CSS
  // variable so scrollable containers (modals, house content) can pad their
  // bottom edge and never have content hidden behind it. Recomputed any
  // time the controller's visibility/size state changes.
  // ==========================================================================
  function updateControllerFootprint() {
    var tc = document.getElementById('touch-controls');
    var root = document.documentElement;
    if (!tc || tc.hasAttribute('hidden') || getComputedStyle(tc).display === 'none') {
      root.style.setProperty('--controller-footprint', '0px');
      return;
    }
    var h = tc.getBoundingClientRect().height || 0;
    root.style.setProperty('--controller-footprint', Math.round(h) + 'px');
  }
  window.addEventListener('resize', updateControllerFootprint);

  // ==========================================================================
  // ENABLE / DISABLE — Settings → "Show mobile controls" toggle. When
  // disabled, both the D-pad and the floating action buttons are fully
  // hidden (not just faded), and the footprint collapses to 0 so scrollable
  // content reclaims that space.
  // ==========================================================================
  function applyControllerEnabledState(tc) {
    var actions = document.getElementById('touch-action-btns');
    var enabled = true;
    try {
      enabled = typeof AppState !== 'undefined' && AppState.controlsEnabled !== false;
    } catch (e) {}
    if (enabled) {
      tc.removeAttribute('hidden');
      if (actions) actions.removeAttribute('hidden');
    } else {
      tc.setAttribute('hidden', '');
      if (actions) actions.setAttribute('hidden', '');
      stopAllMoves(tc);
    }
    updateControllerFootprint();
  }
  // Exposed so Settings can call it the moment the toggle changes, without
  // needing a full page reload.
  window.applyControllerEnabledState = function () {
    var tc = document.getElementById('touch-controls');
    if (tc) applyControllerEnabledState(tc);
  };

  (function waitForTouchControls() {
    if (document.getElementById('touch-controls')) bindTouchControls();
    else setTimeout(waitForTouchControls, 300);
  })();

  /* ==================================================================
     5. DEVELOPER "RESET ALL DATA"
     - Triple-click the HUD title to reveal reset prompt
     - Also auto-injected into Settings modal as a "Developer Zone"
     - Clears all s2talk_* localStorage + calls server endpoint
     ================================================================== */
  var DEV_KEY = 's2talk-dev-reset-9977';

  function performFullReset() {
    // Clear localStorage
    var toRemove = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && (k.startsWith('s2talk_') || k.startsWith('S2_'))) toRemove.push(k);
    }
    toRemove.forEach(function (k) { localStorage.removeItem(k); });

    // Call server-side wipe
    fetch('/api/admin/reset-all-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: DEV_KEY })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var msg = data.ok ? '✅ All data wiped. Reloading...' : ('⚠️ ' + (data.error || 'Reset failed'));
        if (typeof toast === 'function') toast(msg);
        setTimeout(function () { location.reload(); }, 1600);
      })
      .catch(function () {
        if (typeof toast === 'function') toast('🗑️ Local data cleared. Reloading...');
        setTimeout(function () { location.reload(); }, 1600);
      });
  }

  function isDevUser() {
    return !!(typeof AppState !== 'undefined' && AppState.current && AppState.current.role === 'admin');
  }

  function showResetConfirm() {
    if (typeof window.AnimationManager !== 'undefined' && window.AnimationManager.showConfirm) {
      window.AnimationManager.showConfirm(
        '⚠️ Reset All Data',
        'This will permanently delete ALL accounts, chats, projects, and progress. This cannot be undone.',
        'All data wiped!',
        performFullReset
      );
    } else if (confirm('⚠️ RESET ALL DATA?\n\nThis will permanently delete ALL accounts, chats, projects, and progress. This cannot be undone.')) {
      performFullReset();
    }
  }

  // Expose globally for external use
  window.s2talkDevReset = showResetConfirm;

  // Triple-click HUD title → dev reset (admin/developer accounts only —
  // regular users triple-clicking the title get no reaction at all)
  var hudClicks = 0, hudTimer = null;
  (function waitForHud() {
    var hudTitle = document.getElementById('hud-title');
    if (!hudTitle) { setTimeout(waitForHud, 500); return; }
    hudTitle.addEventListener('click', function () {
      if (!isDevUser()) return;
      hudTitle.style.pointerEvents = 'all';
      hudTitle.style.cursor = 'pointer';
      hudClicks++;
      clearTimeout(hudTimer);
      hudTimer = setTimeout(function () { hudClicks = 0; }, 700);
      if (hudClicks >= 3) {
        hudClicks = 0;
        showResetConfirm();
      }
    });
  })();

  // Auto-inject Reset button into Settings/About modal — admin/developer
  // accounts only, so regular users never even see this exists.
  (function waitForModalBody() {
    var mb = document.getElementById('modal-body');
    if (!mb) { setTimeout(waitForModalBody, 400); return; }

    var obs = new MutationObserver(function () {
      if (!isDevUser()) return;
      var h2s = mb.querySelectorAll('h2');
      var isSett = false;
      h2s.forEach(function (h) {
        if (h.textContent.indexOf('About') >= 0 || h.textContent.indexOf('Settings') >= 0 || h.textContent.indexOf('⚙') >= 0) isSett = true;
      });
      if (isSett && !mb.querySelector('#dev-reset-btn')) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'margin-top:22px;padding-top:14px;border-top:1px solid rgba(255,77,79,0.18);';
        wrap.innerHTML =
          '<p style="color:rgba(255,77,79,0.75);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px;">⚠️ Developer Zone</p>' +
          '<p style="color:var(--ink-dim);font-size:11px;margin:0 0 10px;">Wipes all accounts and localStorage. Cannot be undone.</p>' +
          '<button id="dev-reset-btn" style="' +
          'background:rgba(255,77,79,0.08);border:1.5px solid rgba(255,77,79,0.35);color:#ff4d4f;' +
          'border-radius:10px;padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer;' +
          'font-family:inherit;transition:.15s;' +
          '">🗑️ Reset All Data &amp; Accounts</button>';
        mb.appendChild(wrap);
        var btn = document.getElementById('dev-reset-btn');
        if (btn) {
          btn.addEventListener('click', showResetConfirm);
          btn.addEventListener('mouseenter', function () { this.style.background = 'rgba(255,77,79,0.18)'; });
          btn.addEventListener('mouseleave', function () { this.style.background = 'rgba(255,77,79,0.08)'; });
        }
      }
    });
    obs.observe(mb, { childList: true });
  })();

  /* ==================================================================
     6. AUTO-SAVE ON TAB CLOSE / VISIBILITY CHANGE
     Ensures user data is persisted even when closing the tab without
     a graceful logout.
     ================================================================== */
  function autoSave() {
    if (typeof saveUserData === 'function') {
      try { saveUserData(); } catch (e) { /* silent */ }
    }
  }
  window.addEventListener('beforeunload', autoSave);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') autoSave();
  });

  /* ==================================================================
     7. PREVENT HORIZONTAL SCROLL (mobile safety net)
     ================================================================== */
  document.querySelectorAll('.screen').forEach(function (s) {
    s.style.overflowX = 'hidden';
  });

  /* ==================================================================
     8. RESPONSIVE CANVAS RESIZE
     Keep the game canvas fitting the viewport on mobile without
     horizontal overflow.
     ================================================================== */
  function resizeCanvas() {
    var canvas = document.getElementById('world');
    if (!canvas) return;
    var wrap = document.getElementById('world-wrap');
    if (!wrap) return;

    var vw = wrap.clientWidth;
    var vh = wrap.clientHeight;
    // Don't resize on desktop (> 900px)
    if (vw > 900) {
      canvas.style.width = '';
      canvas.style.height = '';
      return;
    }

    var aspect = canvas.width / canvas.height; // 900/600 = 1.5
    var maxW = Math.min(vw - 4, vw);
    var maxH = Math.min(vh - 130, vh);

    var w = maxW;
    var h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    canvas.style.width = Math.floor(w) + 'px';
    canvas.style.height = Math.floor(h) + 'px';
  }

  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', function () {
    setTimeout(resizeCanvas, 200);
  });
  // Run once after game screen shows
  (function waitForGameScreen() {
    var game = document.getElementById('game');
    if (game && game.classList.contains('active')) resizeCanvas();
    else setTimeout(waitForGameScreen, 500);
  })();

  /* ==================================================================
     9. FLOATING PARTICLES EFFECT ON GAME SCREEN
     Adds subtle animated particles to the game background for
     visual richness at 60fps.
     ================================================================== */
  function injectParticlesCSS() {
    if (document.getElementById('s2-particles-css')) return;
    var style = document.createElement('style');
    style.id = 's2-particles-css';
    style.textContent = [
      '#game-particles { position:absolute; inset:0; z-index:1; pointer-events:none; overflow:hidden; }',
      '.g-particle {',
      '  position:absolute; width:3px; height:3px; border-radius:50%;',
      '  background:rgba(91,79,232,0.35); opacity:0;',
      '  animation: gpFloat linear infinite;',
      '}',
      'body.night .g-particle { background:rgba(124,247,201,0.25); }',
      '@keyframes gpFloat {',
      '  0%   { opacity:0; transform:translateY(0) scale(0.5); }',
      '  15%  { opacity:1; }',
      '  85%  { opacity:1; }',
      '  100% { opacity:0; transform:translateY(-100vh) scale(1.2); }',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function spawnParticles() {
    var wrap = document.getElementById('world-wrap');
    if (!wrap) return;
    if (wrap.querySelector('#game-particles')) return;

    injectParticlesCSS();
    var container = document.createElement('div');
    container.id = 'game-particles';
    wrap.appendChild(container);

    var count = 18;
    for (var i = 0; i < count; i++) {
      var p = document.createElement('div');
      p.className = 'g-particle';
      p.style.left = (Math.random() * 100) + '%';
      p.style.bottom = '-6px';
      p.style.width = (2 + Math.random() * 3) + 'px';
      p.style.height = p.style.width;
      p.style.animationDuration = (6 + Math.random() * 10) + 's';
      p.style.animationDelay = (Math.random() * 8) + 's';
      container.appendChild(p);
    }
  }

  // Spawn particles once game screen becomes active
  var particlesObserver = new MutationObserver(function () {
    var game = document.getElementById('game');
    if (game && game.classList.contains('active')) {
      spawnParticles();
    }
  });
  var gameEl = document.getElementById('game');
  if (gameEl) {
    particlesObserver.observe(gameEl, { attributes: true, attributeFilter: ['class'] });
    if (gameEl.classList.contains('active')) spawnParticles();
  }

  console.log('[S2 Talk Enhancements] Loaded: double-click entry, smooth fast-travel, touch controls, car facing, dev reset, particles.');

})();
