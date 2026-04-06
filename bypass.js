(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 기본 visibility 스푸핑
  // ─────────────────────────────────────────────────────────────
  Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
  document.hasFocus = () => true;

  // window/document blur, focusout 직접 할당 차단
  for (const prop of ['onblur', 'onfocusout']) {
    try {
      Object.defineProperty(window, prop, { get: () => null, set: () => {}, configurable: true });
      Object.defineProperty(document, prop, { get: () => null, set: () => {}, configurable: true });
    } catch (e) {}
  }

  // ─────────────────────────────────────────────────────────────
  // addEventListener 후킹
  // ─────────────────────────────────────────────────────────────
  const _origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const isTopLevel = (this === window || this === document || this === document.documentElement);
    if (type === 'visibilitychange') {
      console.log('[SSU LMS Bypass] visibilitychange 차단');
      return;
    }
    // window/document 레벨의 blur, focusout 차단
    if ((type === 'blur' || type === 'focusout') && isTopLevel) {
      console.log('[SSU LMS Bypass] ' + type + ' 차단 on', this === window ? 'window' : 'document');
      return;
    }
    return _origAdd.call(this, type, listener, options);
  };

  // ─────────────────────────────────────────────────────────────
  // postMessage 모니터링 (부모→iframe 정지 명령 감지용)
  // ─────────────────────────────────────────────────────────────
  _origAdd.call(window, 'message', function (e) {
    const data = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
    if (/pause|stop|deactivat|blur|focus|hidden|visib/i.test(data)) {
      console.log('[SSU LMS Bypass] 의심 postMessage 수신:', data.slice(0, 200));
    }
  }, true);

  // ─────────────────────────────────────────────────────────────
  // isPlayerDeactivated 항상 false
  // ─────────────────────────────────────────────────────────────
  Object.defineProperty(window, 'isPlayerDeactivated', {
    get: () => false, set: () => {}, configurable: false, enumerable: true
  });

  // ─────────────────────────────────────────────────────────────
  // requestAnimationFrame 폴리필 (background 탭 대응)
  // ─────────────────────────────────────────────────────────────
  const _origRaf = window.requestAnimationFrame.bind(window);
  const _origCaf = window.cancelAnimationFrame.bind(window);
  const _rafMap = new Map();
  let _rafSeq = 0;

  window.requestAnimationFrame = function (cb) {
    const id = ++_rafSeq;
    let done = false;
    const nid = _origRaf((ts) => { done = true; _rafMap.delete(id); cb(ts); });
    const tid = setTimeout(() => {
      if (!done) { _origCaf(nid); _rafMap.delete(id); cb(performance.now()); }
    }, 50);
    _rafMap.set(id, { nid, tid });
    return id;
  };
  window.cancelAnimationFrame = function (id) {
    const e = _rafMap.get(id);
    if (e) { _origCaf(e.nid); clearTimeout(e.tid); _rafMap.delete(id); }
  };

  // ─────────────────────────────────────────────────────────────
  // HTMLMediaElement 포괄 감시
  //   - pause() 오버라이드: 스택 기록 후 자동 재개 예약
  //   - load() 오버라이드: 감지 로그
  //   - 'pause' 이벤트 캡처: pause() 외 경로(src='', load 등) 대응
  // ─────────────────────────────────────────────────────────────
  let _lastUserClick = 0;
  _origAdd.call(document, 'click', () => { _lastUserClick = Date.now(); }, true);

  const _origPause = HTMLMediaElement.prototype.pause;
  const _origPlay  = HTMLMediaElement.prototype.play;
  const _origLoad  = HTMLMediaElement.prototype.load;

  HTMLMediaElement.prototype.pause = function () {
    const stack = new Error().stack.split('\n').slice(1, 6).join('\n');
    console.log('[SSU LMS Bypass] pause() 호출\n', stack);
    const userAction = (Date.now() - _lastUserClick) < 600;
    if (userAction) { this._ssuUserPaused = true; }
    _origPause.call(this);
    if (!userAction) {
      const m = this;
      setTimeout(() => { if (m.paused && !m._ssuUserPaused) { m.play().catch(() => {}); } }, 300);
    }
  };

  HTMLMediaElement.prototype.play = function () {
    this._ssuUserPaused = false;
    return _origPlay.call(this);
  };

  HTMLMediaElement.prototype.load = function () {
    const stack = new Error().stack.split('\n').slice(1, 5).join('\n');
    console.log('[SSU LMS Bypass] load() 호출 (재생 리셋 가능)\n', stack);
    return _origLoad.call(this);
  };

  // pause 이벤트 자체를 캡처 — pause()를 통하지 않는 경우 (src='', error 등)도 감지
  _origAdd.call(document, 'pause', function (e) {
    const media = e.target;
    if (!(media instanceof HTMLMediaElement)) return;
    if (media._ssuUserPaused) return;
    const wasActive = (media.readyState >= 2) && !media.ended;
    if (wasActive) {
      console.log('[SSU LMS Bypass] pause 이벤트 캡처 (pause()가 아닌 경로) src:', media.currentSrc.slice(-60));
      setTimeout(() => {
        if (media.paused && !media._ssuUserPaused) {
          console.log('[SSU LMS Bypass] 자동 play() 재개');
          media.play().catch(() => {});
        }
      }, 300);
    }
  }, true);

  console.log('[SSU LMS Bypass] v5 활성화 — 포괄 감시 모드');
})();
