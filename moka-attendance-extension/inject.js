/**
 * 运行在页面上下文，拦截 fetch / XHR，捕获考勤详情接口响应。
 * MV3 下 webRequest 读不到 response body，所以用注入脚本挂钩。
 */
(function () {
  if (window.__mokaAttendanceHooked) return;
  window.__mokaAttendanceHooked = true;

  const TARGET = '/api/abs/attendance/myAttendance/v2/m/detail';
  const EVENT = 'MOKA_ATTENDANCE_DETAIL';

  function isTargetUrl(url) {
    try {
      const u = typeof url === 'string' ? url : String(url || '');
      return u.includes(TARGET);
    } catch {
      return false;
    }
  }

  function publish(payload, url) {
    window.dispatchEvent(
      new CustomEvent(EVENT, {
        detail: { payload, url: String(url || '') }
      })
    );
  }

  function tryParseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const req = args[0];
      const url = typeof req === 'string' ? req : req && req.url;
      if (isTargetUrl(url)) {
        const clone = response.clone();
        clone.text().then((text) => {
          const json = tryParseJson(text);
          if (json) publish(json, url);
        });
      }
    } catch {
      /* ignore interception errors */
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__mokaUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (isTargetUrl(this.__mokaUrl)) {
      this.addEventListener('load', function () {
        try {
          const json = tryParseJson(this.responseText);
          if (json) publish(json, this.__mokaUrl);
        } catch {
          /* ignore */
        }
      });
    }
    return originalSend.apply(this, args);
  };
})();
