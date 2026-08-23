/* ASR：webkitSpeechRecognition 听口令（zh-CN），识别结束自动重启；屏幕按钮始终兜底 */
WR.asr = (function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!SR;
  const REPEAT_RE = /没听清|再说一遍|重复|听不懂/;
  const NEXT_RE = /好了|下一个|下一题|继续/;

  let rec = null, active = false, suspended = false;
  let handler = null, failCb = null, restartTimer = null;

  function ensureRec() {
    if (rec) return;
    rec = new SR();
    rec.lang = 'zh-CN';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    rec.onresult = function (e) {
      const res = e.results[e.results.length - 1];
      const text = (res && res[0] && res[0].transcript) || '';
      if (suspended || !handler || !text) return;
      if (REPEAT_RE.test(text)) handler('repeat', text);
      else if (NEXT_RE.test(text)) handler('next', text);
    };
    rec.onend = function () {
      if (active && !suspended) restartTimer = setTimeout(startRec, 350);
    };
    rec.onerror = function (e) {
      if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) {
        stop();
        if (failCb) failCb(e.error);
      }
    };
  }

  function startRec() {
    clearTimeout(restartTimer);
    if (!rec || !active || suspended) return;
    try { rec.start(); } catch (e) { /* already started */ }
  }

  function start(onCommand, onFail) {
    if (!supported) return false;
    handler = onCommand;
    failCb = onFail;
    active = true;
    suspended = false;
    ensureRec();
    startRec();
    return true;
  }

  /* TTS 播报时暂停识别，避免自触发 */
  function suspend() {
    suspended = true;
    clearTimeout(restartTimer);
    try { rec && rec.abort(); } catch (e) { /* ignore */ }
  }

  function resume() {
    if (!active) return;
    suspended = false;
    startRec();
  }

  function stop() {
    active = false;
    suspended = false;
    clearTimeout(restartTimer);
    try { rec && rec.abort(); } catch (e) { /* ignore */ }
  }

  return { supported: supported, start: start, stop: stop, suspend: suspend, resume: resume };
})();
