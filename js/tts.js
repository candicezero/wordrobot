/* TTS：中英文分 voice 分段合成（iPad Safari）；首次需在手势内调用 unlock() */
WR.tts = (function () {
  let zhVoice = null, enVoice = null;

  function pickVoices() {
    try {
      const vs = speechSynthesis.getVoices();
      zhVoice = vs.find(function (v) { return /^zh[-_]CN/i.test(v.lang); }) ||
        vs.find(function (v) { return /^zh/i.test(v.lang); }) || null;
      enVoice = vs.find(function (v) { return /^en[-_]US/i.test(v.lang); }) ||
        vs.find(function (v) { return /^en/i.test(v.lang); }) || null;
    } catch (e) { /* ignore */ }
  }
  if ('speechSynthesis' in window) {
    pickVoices();
    speechSynthesis.onvoiceschanged = pickVoices;
  }

  function available() { return 'speechSynthesis' in window; }

  /* iOS 需在用户手势内"点亮"语音合成：静音念一句 */
  function unlock() {
    if (!available()) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  /* segments: [{lang:'zh'|'en', text, rate?}]，依次排队合成；resolve 于全部结束 */
  function speak(segments, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (!available() || !segments || !segments.length) { resolve(); return; }
      try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
      const rate = opts.rate || WR_CONFIG.tts.rate;
      let finished = false;
      const finish = function () {
        if (finished) return;
        finished = true;
        clearTimeout(watchdog);
        resolve();
      };
      /* 兜底看门狗：按字数估算最长时长，避免个别浏览器不触发 onend */
      const chars = segments.reduce(function (s, x) { return s + (x.text || '').length + 8; }, 0);
      const watchdog = setTimeout(finish, Math.max(4000, chars * 550));
      segments.forEach(function (seg, i) {
        const u = new SpeechSynthesisUtterance(seg.text);
        u.lang = seg.lang === 'en' ? 'en-US' : 'zh-CN';
        if (seg.lang === 'en' && enVoice) u.voice = enVoice;
        if (seg.lang === 'zh' && zhVoice) u.voice = zhVoice;
        u.rate = seg.rate || rate;
        if (i === segments.length - 1) {
          u.onend = finish;
          u.onerror = finish;
        }
        speechSynthesis.speak(u);
      });
    });
  }

  function stop() {
    if (!available()) return;
    try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  }

  return { available: available, unlock: unlock, speak: speak, stop: stop };
})();
