/**
 * MAIN world：挂钩 fetch/XHR，捕获详情接口模板，并在页面上下文执行按日拉取。
 */
(function () {
  if (window.__mokaAttendanceHooked) return;
  window.__mokaAttendanceHooked = true;

  const TARGET = '/api/abs/attendance/myAttendance/v2/m/detail';
  const SOURCE = 'MOKA_ATTENDANCE_EXT';
  const DATE_KEYS = [
    'attendanceDate',
    'date',
    'workDate',
    'day',
    'attendance_date'
  ];

  const originalFetch = window.fetch.bind(window);
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  /** @type {null | {method:string,url:string,body:string|null,headers:Object,sampleDate:string|null}} */
  let lastTemplate = null;
  /** 批量期间跳过对详情接口的二次挂钩处理，避免干扰 */
  let batchQuiet = false;

  function isTargetUrl(url) {
    try {
      return String(url || '').includes(TARGET);
    } catch {
      return false;
    }
  }

  function isMokahrApiUrl(url) {
    try {
      const u = String(url || '');
      return /mokahr\.com/i.test(u) && /\/api\//i.test(u);
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

  function rememberTemplate(partial) {
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
      // 只更新 sampleDate 供展示；真正发请求时不再依赖它做字符串替换
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

  function isMonthCalendarPayload(payload) {
    return Boolean(
      payload &&
        payload.code === 200 &&
        payload.data &&
        typeof payload.data.year === 'number' &&
        typeof payload.data.month === 'number' &&
        Array.isArray(payload.data.days)
    );
  }

  function handleBody(text, url, via) {
    const json = tryParseJson(text);
    if (!json) return;
    // 月历：区分工作日/休息日（type=2 / fixedTimeRest）
    if (isMonthCalendarPayload(json)) {
      post('MONTH_CALENDAR', { payload: json, url: String(url || ''), via });
    }
    if (isTargetUrl(url)) publishDetail(json, url, via);
  }

  /** 把任意 YYYY-MM-DD 替换成目标日（不依赖 sampleDate 是否仍写在模板里） */
  function replaceAllDates(text, date) {
    return String(text || '').replace(/\d{4}-\d{2}-\d{2}/g, date);
  }

  function applyDateToJson(obj, date) {
    if (!obj || typeof obj !== 'object') return obj;
    let hit = false;
    for (const key of DATE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        obj[key] = date;
        hit = true;
      }
    }
    // 常见嵌套
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object') {
        const before = JSON.stringify(v);
        applyDateToJson(v, date);
        if (JSON.stringify(v) !== before) hit = true;
      } else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        // 其它值为纯日期的字段一并替换
        if (DATE_KEYS.includes(k) || /date|day/i.test(k)) {
          obj[k] = date;
          hit = true;
        }
      }
    }
    if (!hit) obj.attendanceDate = date;
    return obj;
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

    const method = (base.method || 'GET').toUpperCase();
    let url = base.url || `https://core.mokahr.com${TARGET}?bus=20`;
    let body = base.body == null ? null : String(base.body);

    // URL：显式设置 attendanceDate，避免 sampleDate 与模板不同步导致隔天失败
    try {
      const u = new URL(url, location.origin);
      // 先清掉旧日期参数，再写入目标日
      for (const key of DATE_KEYS) {
        if (u.searchParams.has(key)) u.searchParams.delete(key);
      }
      // path/query 里若还残留日期字符串，统一替换
      let href = u.toString();
      href = replaceAllDates(href, date);
      const u2 = new URL(href);
      u2.searchParams.set('attendanceDate', date);
      if (!u2.searchParams.has('bus')) u2.searchParams.set('bus', '20');
      url = u2.toString();
    } catch {
      url = replaceAllDates(url, date);
      if (!/[?&]attendanceDate=/.test(url)) {
        url += (url.includes('?') ? '&' : '?') + `attendanceDate=${encodeURIComponent(date)}`;
      }
    }

    // Body：优先按 JSON 字段写入；否则全局替换日期字面量
    if (body) {
      const json = tryParseJson(body);
      if (json && typeof json === 'object') {
        applyDateToJson(json, date);
        body = JSON.stringify(json);
      } else {
        body = replaceAllDates(body, date);
        if (!/attendanceDate/.test(body) && method !== 'GET') {
          body = JSON.stringify({ attendanceDate: date });
        }
      }
    } else if (method !== 'GET' && method !== 'HEAD') {
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
    const responseDate =
      json && json.data && json.data.attendanceDate
        ? String(json.data.attendanceDate)
        : null;
    return {
      ok: response.ok,
      status: response.status,
      url: req.url,
      requestDate: date,
      responseDate,
      dateMatched: !responseDate || responseDate === date,
      payload: json,
      raw: text.slice(0, 500)
    };
  }

  // ---- fetch hook ----
  window.fetch = function (...args) {
    const input = args[0];
    const init = args[1] || {};
    const url = typeof input === 'string' ? input : input && input.url;
    const method = (init.method || (input && input.method) || 'GET').toUpperCase();
    const body = init.body != null ? init.body : null;
    const headers = headersToObject(init.headers || (input && input.headers));

    if (isTargetUrl(url) && !batchQuiet) {
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
    // detail 模板 + 月历工作日/休息日，都需要读响应
    if (isMokahrApiUrl(url) && !batchQuiet) {
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
    const url = this.__mokaUrl;
    if (isTargetUrl(url) && !batchQuiet) {
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
        url,
        body: bodyStr,
        headers: this.__mokaHeaders || {}
      });
    }
    if (isMokahrApiUrl(url) && !batchQuiet) {
      this.addEventListener('load', function () {
        try {
          if (typeof this.response === 'object' && this.response !== null) {
            if (isMonthCalendarPayload(this.response)) {
              post('MONTH_CALENDAR', {
                payload: this.response,
                url: String(url || ''),
                via: 'xhr-json'
              });
            }
            if (isTargetUrl(url)) {
              publishDetail(this.response, url, 'xhr-json');
            }
            return;
          }
        } catch {
          /* ignore */
        }
        handleBody(this.responseText, url, 'xhr');
      });
    }
    return originalSend.call(this, body);
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE) return;

    if (data.type === 'GET_TEMPLATE') {
      post('API_TEMPLATE', { template: lastTemplate });
      return;
    }

    if (data.type === 'BATCH_START') {
      batchQuiet = true;
      post('BATCH_FLAG', { active: true });
      return;
    }

    if (data.type === 'BATCH_END') {
      batchQuiet = false;
      post('BATCH_FLAG', { active: false });
      return;
    }

    if (data.type === 'FETCH_DAY' && data.date) {
      const requestId = data.requestId;
      // 批量时固定用「启动时」传入的 base 模板，避免 sampleDate 漂移
      fetchDay(data.date, data.template || lastTemplate)
        .then((result) => {
          post('FETCH_DAY_RESULT', { requestId, date: data.date, result });
          // 仅当响应日期与请求日一致（或无法判断）时才入库，防止错日覆盖
          if (result.payload && result.dateMatched !== false) {
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
