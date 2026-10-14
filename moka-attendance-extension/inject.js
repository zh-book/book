/**
 * MAIN world：直接跑在页面 JS 环境，绕过 CSP 对扩展脚本 src 的拦截。
 */
(function () {
  if (window.__mokaAttendanceHooked) return;
  window.__mokaAttendanceHooked = true;

  const TARGET = '/api/abs/attendance/myAttendance/v2/m/detail';
  const SOURCE = 'MOKA_ATTENDANCE_EXT';

  function isTargetUrl(url) {
    try {
      return String(url || '').includes(TARGET);
    } catch {
      return false;
    }
  }

  function publish(payload, url, via) {
    window.postMessage(
      {
        source: SOURCE,
        type: 'ATTENDANCE_DETAIL',
        payload,
        url: String(url || ''),
        via
      },
      '*'
    );
  }

  function tryParseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function handleBody(text, url, via) {
    const json = tryParseJson(text);
    if (json) publish(json, url, via);
  }

  // ---- fetch ----
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const req = args[0];
    const url = typeof req === 'string' ? req : req && req.url;
    const promise = originalFetch.apply(this, args);
    if (isTargetUrl(url)) {
      promise
        .then((response) => {
          response
            .clone()
            .text()
            .then((text) => handleBody(text, url, 'fetch'))
            .catch(() => {});
          return response;
        })
        .catch(() => {});
    }
    return promise;
  };

  // ---- XHR ----
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__mokaUrl = url;
    this.__mokaMethod = method;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (isTargetUrl(this.__mokaUrl)) {
      this.addEventListener('load', function () {
        // responseType 非 text/'' 时 responseText 可能读不到，优先 response
        try {
          if (typeof this.response === 'object' && this.response !== null) {
            publish(this.response, this.__mokaUrl, 'xhr-json');
            return;
          }
        } catch {
          /* ignore */
        }
        handleBody(this.responseText, this.__mokaUrl, 'xhr');
      });
    }
    return originalSend.apply(this, args);
  };

  // 告知隔离世界：钩子已挂上（便于 popup 排查）
  window.postMessage({ source: SOURCE, type: 'HOOK_READY', href: location.href }, '*');
})();
