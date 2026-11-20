/**
 * MAIN world：挂钩 fetch/XHR，捕获详情接口模板，并在页面上下文执行按日拉取。
 */
(function () {
  if (window.__mokaAttendanceHooked) return;
  window.__mokaAttendanceHooked = true;

  const TARGET = '/api/abs/attendance/myAttendance/v2/m/detail';
  const SOURCE = 'MOKA_ATTENDANCE_EXT';
  const DATE_RE = /\d{4}-\d{2}-\d{2}/g;

  const originalFetch = window.fetch.bind(window);
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  /** @type {null | {method:string,url:string,body:string|null,headers:Object,sampleDate:string|null}} */
  let lastTemplate = null;

  function isTargetUrl(url) {
    try {
      return String(url || '').includes(TARGET);
    } catch {
      return false;
    }
  }

  function post(type, extra) {
    window.postMessage({ source: SOURCE, type, ...(extra || {}) }, '*');
  }

  function tryParseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function headersToObject(headers) {
    const out = {};
    if (!headers) return out;
    if (headers instanceof Headers) {
      headers.forEach((v, k) => {
        out[k] = v;
      });
      return out;
    }
    if (Array.isArray(headers)) {
      for (const [k, v] of headers) out[k] = v;
      return out;
    }
    if (typeof headers === 'object') {
      for (const [k, v] of Object.entries(headers)) out[k] = String(v);
    }
    return out;
  }

  function pickUsefulHeaders(headers) {
    const allow = [
      'accept',
      'content-type',
      'authorization',
      'x-requested-with',
      'x-auth-token',
      'x-token',
      'token',
      'x-csrf-token',
      'x-xsrf-token'
    ];
    const out = {};
    for (const [k, v] of Object.entries(headers || {})) {
      if (allow.includes(String(k).toLowerCase())) out[k] = v;
    }
    return out;
  }

  function rememberTemplate( partial) {
    lastTemplate = {
      method: partial.method || 'GET',
      url: String(partial.url || ''),
      body: partial.body == null ? null : String(partial.body),
      headers: pickUsefulHeaders(partial.headers || {}),
      sampleDate: partial.sampleDate || (lastTemplate && lastTemplate.sampleDate) || null,
      capturedAt: Date.now()
    };
    post('API_TEMPLATE', { template: lastTemplate });
  }

  function publishDetail(payload, url, via) {
    const date =
      payload && payload.data && payload.data.attendanceDate
        ? String(payload.data.attendanceDate)
        : null;
    if (date && lastTemplate) {
      lastTemplate.sampleDate = date;
      post('API_TEMPLATE', { template: lastTemplate });
    } else if (date) {
      rememberTemplate({
        method: 'GET',
        url: url || `https://core.mokahr.com${TARGET}?bus=20`,
        body: null,
        headers: { Accept: 'application/json, text/plain, */*' },
        sampleDate: date
      });
    }
    post('ATTENDANCE_DETAIL', { payload, url: String(url || ''), via });
  }

  function handleBody(text, url, via) {
    const json = tryParseJson(text);
    if (json) publishDetail(json, url, via);
  }

  function buildDayRequest(date, template) {
    const base =
      template ||
      lastTemplate || {
        method: 'GET',
        url: `https://core.mokahr.com${TARGET}?bus=20`,
        body: null,
        headers: { Accept: 'application/json, text/plain, */*' },
        sampleDate: null
      };

    let url = base.url || `https://core.mokahr.com${TARGET}?bus=20`;
    let body = base.body;
    const method = (base.method || 'GET').toUpperCase();
    const sample = base.sampleDate;

    // URL 替换 / 补齐 attendanceDate
    try {
      const u = new URL(url, location.origin);
      if (sample && u.href.includes(sample)) {
        u.href = u.href.split(sample).join(date);
      }
      // 常见查询参数
      const dateKeys = ['attendanceDate', 'date', 'workDate', 'day', 'attendance_date'];
      let hasDateParam = false;
      for (const key of dateKeys) {
        if (u.searchParams.has(key)) {
          u.searchParams.set(key, date);
          hasDateParam = true;
        }
      }
      if (!hasDateParam && method === 'GET') {
        u.searchParams.set('attendanceDate', date);
      }
      if (!u.searchParams.has('bus')) u.searchParams.set('bus', '20');
      url = u.toString();
    } catch {
      if (sample) url = url.split(sample).join(date);
      if (!/[?&]attendanceDate=/.test(url)) {
        url += (url.includes('?') ? '&' : '?') + `attendanceDate=${encodeURIComponent(date)}`;
      }
    }

    // Body 替换
    if (body && sample) {
      body = body.split(sample).join(date);
    } else if (body) {
      const json = tryParseJson(body);
      if (json && typeof json === 'object') {
        const keys = ['attendanceDate', 'date', 'workDate', 'day', 'attendance_date'];
        let hit = false;
        for (const key of keys) {
          if (key in json) {
            json[key] = date;
            hit = true;
          }
        }
        if (!hit) json.attendanceDate = date;
        body = JSON.stringify(json);
      } else if (DATE_RE.test(body)) {
        body = body.replace(DATE_RE, date);
      }
    } else if (method !== 'GET') {
      body = JSON.stringify({ attendanceDate: date });
    }

    const headers = Object.assign(
      { Accept: 'application/json, text/plain, */*' },
      base.headers || {}
    );
    if (body && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json;charset=UTF-8';
    }

    return { method, url, body, headers };
  }

  async function fetchDay(date, template) {
    const req = buildDayRequest(date, template);
    const init = {
      method: req.method,
      credentials: 'include',
      headers: req.headers
    };
    if (req.body && req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = req.body;
    }
    const response = await originalFetch(req.url, init);
    const text = await response.text();
    const json = tryParseJson(text);
    return {
      ok: response.ok,
      status: response.status,
      url: req.url,
      payload: json,
      raw: text.slice(0, 500)
    };
  }

  // ---- fetch hook ----
  window.fetch = function (...args) {
    const input = args[0];
    const init = args[1] || {};
    const url = typeof input === 'string' ? input : input && input.url;
    let method = (init.method || (input && input.method) || 'GET').toUpperCase();
    let body = init.body != null ? init.body : null;
    let headers = headersToObject(init.headers || (input && input.headers));

    if (isTargetUrl(url)) {
      Promise.resolve(body)
        .then((b) => {
          const bodyStr =
            b == null
              ? null
              : typeof b === 'string'
                ? b
                : b instanceof URLSearchParams
                  ? b.toString()
                  : typeof b === 'object' && typeof b.text === 'function'
                    ? null
                    : String(b);
          rememberTemplate({ method, url, body: bodyStr, headers });
        })
        .catch(() => rememberTemplate({ method, url, body: null, headers }));
    }

    const promise = originalFetch(...args);
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

  // ---- XHR hook ----
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__mokaUrl = url;
    this.__mokaMethod = method;
    this.__mokaHeaders = {};
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
    this.__mokaHeaders = this.__mokaHeaders || {};
    this.__mokaHeaders[key] = value;
    return originalSetHeader.call(this, key, value);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (isTargetUrl(this.__mokaUrl)) {
      const bodyStr =
        body == null
          ? null
          : typeof body === 'string'
            ? body
            : body instanceof Document
              ? null
              : String(body);
      rememberTemplate({
        method: this.__mokaMethod || 'GET',
        url: this.__mokaUrl,
        body: bodyStr,
        headers: this.__mokaHeaders || {}
      });
      this.addEventListener('load', function () {
        try {
          if (typeof this.response === 'object' && this.response !== null) {
            publishDetail(this.response, this.__mokaUrl, 'xhr-json');
            return;
          }
        } catch {
          /* ignore */
        }
        handleBody(this.responseText, this.__mokaUrl, 'xhr');
      });
    }
    return originalSend.call(this, body);
  };

  // 供 content script 触发的页面内命令
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE) return;

    if (data.type === 'GET_TEMPLATE') {
      post('API_TEMPLATE', { template: lastTemplate });
      return;
    }

    if (data.type === 'FETCH_DAY' && data.date) {
      const requestId = data.requestId;
      fetchDay(data.date, data.template || lastTemplate)
        .then((result) => {
          post('FETCH_DAY_RESULT', { requestId, date: data.date, result });
          if (result.payload) {
            publishDetail(result.payload, result.url, 'batch');
          }
        })
        .catch((err) => {
          post('FETCH_DAY_RESULT', {
            requestId,
            date: data.date,
            result: {
              ok: false,
              status: 0,
              error: String(err && err.message ? err.message : err)
            }
          });
        });
    }
  });

  // 粗略探测登录痕迹（仅非 HttpOnly / 本地存储）
  function probeLogin() {
    const cookies = document.cookie || '';
    const storageKeys = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && /token|auth|user|login|session|employee/i.test(k)) storageKeys.push(k);
      }
    } catch {
      /* ignore */
    }
    post('LOGIN_PROBE', {
      href: location.href,
      hasCookie: Boolean(cookies),
      cookieLen: cookies.length,
      storageKeys,
      hasTemplate: Boolean(lastTemplate)
    });
  }

  post('HOOK_READY', { href: location.href });
  probeLogin();
  setTimeout(probeLogin, 1500);
})();
