/**
 * 仅在考勤相关页（顶层帧）注入批量拉取面板。
 */
(function () {
  if (window !== window.top) return;

  const SOURCE = 'MOKA_ATTENDANCE_EXT';
  const PANEL_ID = 'moka-hours-batch-panel';

  function isAttendancePage() {
    try {
      return /\/attendance/i.test(location.pathname || '');
    } catch {
      return false;
    }
  }

  if (!isAttendancePage()) return;
  if (document.getElementById(PANEL_ID)) return;

  /** @type {any} */
  let template = null;
  /** @type {any} */
  let loginInfo = null;
  let running = false;
  let abortFlag = false;

  const pending = new Map();

  function monthInputValue(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  function daysInMonth(monthKey) {
    const m = monthKey.match(/^(\d{4})-(\d{2})$/);
    if (!m) return [];
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const total = new Date(y, mo, 0).getDate();
    const days = [];
    for (let d = 1; d <= total; d += 1) {
      days.push(`${m[1]}-${m[2]}-${String(d).padStart(2, '0')}`);
    }
    return days;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function ensurePanel() {
    if (document.getElementById(PANEL_ID)) return;

    const root = document.createElement('div');
    root.id = PANEL_ID;
    root.innerHTML = `
      <style>
        #${PANEL_ID} {
          position: fixed;
          right: 20px;
          bottom: 20px;
          z-index: 2147483646;
          width: 280px;
          font-family: "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
          color: #134e4a;
          background: rgba(255,255,255,0.96);
          border: 1px solid #d7ebe7;
          border-radius: 14px;
          box-shadow: 0 12px 32px rgba(15,118,110,0.18);
          backdrop-filter: blur(8px);
          overflow: hidden;
        }
        #${PANEL_ID} .hd {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 12px;
          background: linear-gradient(135deg, #0f766e, #0d9488);
          color: #fff;
          font-weight: 700;
          font-size: 13px;
        }
        #${PANEL_ID} .hd button {
          border: 0;
          background: rgba(255,255,255,0.18);
          color: #fff;
          border-radius: 6px;
          width: 24px;
          height: 24px;
          cursor: pointer;
        }
        #${PANEL_ID} .bd { padding: 12px; }
        #${PANEL_ID} .row {
          display: flex;
          gap: 8px;
          align-items: center;
          margin-bottom: 10px;
        }
        #${PANEL_ID} label { font-size: 12px; color: #5f7f7b; min-width: 40px; }
        #${PANEL_ID} input[type="month"] {
          flex: 1;
          border: 1px solid #d7ebe7;
          border-radius: 8px;
          padding: 6px 8px;
          font-size: 13px;
        }
        #${PANEL_ID} .btn {
          width: 100%;
          border: 0;
          border-radius: 10px;
          padding: 9px 12px;
          background: #0f766e;
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
        }
        #${PANEL_ID} .btn:disabled { opacity: 0.55; cursor: not-allowed; }
        #${PANEL_ID} .btn.stop { background: #b45309; margin-top: 8px; }
        #${PANEL_ID} .meta {
          margin-top: 10px;
          font-size: 11px;
          color: #5f7f7b;
          line-height: 1.45;
          word-break: break-all;
        }
        #${PANEL_ID} .bar {
          margin-top: 8px;
          height: 6px;
          background: #e7f5f2;
          border-radius: 999px;
          overflow: hidden;
        }
        #${PANEL_ID} .bar > i {
          display: block;
          height: 100%;
          width: 0;
          background: #0f766e;
        }
        #${PANEL_ID}.mini .bd { display: none; }
      </style>
      <div class="hd">
        <span>考勤工时批量拉取</span>
        <button type="button" id="mokaPanelMin" title="折叠">–</button>
      </div>
      <div class="bd">
        <div class="row">
          <label>月份</label>
          <input type="month" id="mokaMonth" />
        </div>
        <button type="button" class="btn" id="mokaBatchBtn">批量拉取该月</button>
        <button type="button" class="btn stop" id="mokaStopBtn" hidden>停止</button>
        <div class="bar"><i id="mokaBar"></i></div>
        <div class="meta" id="mokaMeta">正在检测登录态…</div>
      </div>
    `;
    (document.documentElement || document.body).appendChild(root);

    const monthEl = root.querySelector('#mokaMonth');
    monthEl.value = monthInputValue(new Date());

    root.querySelector('#mokaPanelMin').addEventListener('click', () => {
      root.classList.toggle('mini');
    });
    root.querySelector('#mokaBatchBtn').addEventListener('click', () => startBatch());
    root.querySelector('#mokaStopBtn').addEventListener('click', () => {
      abortFlag = true;
    });

    refreshMeta();
  }

  function setMeta(text) {
    const el = document.getElementById('mokaMeta');
    if (el) el.textContent = text;
  }

  function setProgress(done, total) {
    const bar = document.getElementById('mokaBar');
    if (bar) bar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
  }

  function refreshMeta() {
    const parts = [];
    if (loginInfo) {
      parts.push(
        loginInfo.hasCookie || (loginInfo.storageKeys && loginInfo.storageKeys.length)
          ? '已检测到页面登录痕迹'
          : '未检测到本地登录痕迹（仍可能靠 HttpOnly Cookie）'
      );
      if (loginInfo.storageKeys && loginInfo.storageKeys.length) {
        parts.push(`存储键: ${loginInfo.storageKeys.slice(0, 5).join(', ')}`);
      }
    }
    if (template) {
      parts.push(`已捕获接口模板 ${template.method} ${template.sampleDate || ''}`.trim());
    } else {
      parts.push('尚未捕获详情接口；可先点开任意一天，或直接批量（将用默认参数）');
    }
    setMeta(parts.join('\n'));
  }

  function requestDay(date) {
    const requestId = `${date}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve) => {
      pending.set(requestId, resolve);
      window.postMessage(
        {
          source: SOURCE,
          type: 'FETCH_DAY',
          requestId,
          date,
          template
        },
        '*'
      );
      setTimeout(() => {
        if (pending.has(requestId)) {
          pending.delete(requestId);
          resolve({ ok: false, status: 0, error: 'timeout' });
        }
      }, 20000);
    });
  }

  async function startBatch() {
    if (running) return;
    const monthEl = document.getElementById('mokaMonth');
    const monthKey = monthEl && monthEl.value;
    if (!monthKey) {
      setMeta('请选择月份');
      return;
    }

    const days = daysInMonth(monthKey);
    if (!days.length) return;

    running = true;
    abortFlag = false;
    const btn = document.getElementById('mokaBatchBtn');
    const stopBtn = document.getElementById('mokaStopBtn');
    if (btn) btn.disabled = true;
    if (stopBtn) stopBtn.hidden = false;

    // 先向页面要一次最新模板
    window.postMessage({ source: SOURCE, type: 'GET_TEMPLATE' }, '*');
    await sleep(200);

    let okCount = 0;
    let failCount = 0;
    for (let i = 0; i < days.length; i += 1) {
      if (abortFlag) break;
      const date = days[i];
      setMeta(`正在拉取 ${date}（${i + 1}/${days.length}）…`);
      setProgress(i, days.length);

      const result = await requestDay(date);
      if (result && result.ok && result.payload && result.payload.code === 200) {
        okCount += 1;
      } else {
        failCount += 1;
      }
      // 轻微限速，降低风控风险
      await sleep(250);
    }

    setProgress(days.length, days.length);
    setMeta(
      abortFlag
        ? `已停止。成功 ${okCount}，失败/空 ${failCount}。可打开插件弹窗查看日历。`
        : `完成。成功 ${okCount}，失败/空 ${failCount}。可打开插件弹窗查看日历。`
    );

    running = false;
    if (btn) btn.disabled = false;
    if (stopBtn) stopBtn.hidden = true;

    chrome.runtime.sendMessage({
      type: 'BATCH_DONE',
      monthKey,
      okCount,
      failCount,
      aborted: abortFlag
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE) return;

    if (data.type === 'API_TEMPLATE') {
      template = data.template || null;
      chrome.runtime.sendMessage({ type: 'SAVE_API_TEMPLATE', template });
      refreshMeta();
      return;
    }

    if (data.type === 'LOGIN_PROBE') {
      loginInfo = data;
      chrome.runtime.sendMessage({
        type: 'SAVE_LOGIN_PROBE',
        probe: {
          href: data.href,
          hasCookie: data.hasCookie,
          cookieLen: data.cookieLen,
          storageKeys: data.storageKeys || [],
          hasTemplate: data.hasTemplate,
          at: Date.now()
        }
      });
      refreshMeta();
      return;
    }

    if (data.type === 'FETCH_DAY_RESULT' && data.requestId) {
      const resolve = pending.get(data.requestId);
      if (resolve) {
        pending.delete(data.requestId);
        resolve(data.result);
      }
    }
  });

  function boot() {
    ensurePanel();
    window.postMessage({ source: SOURCE, type: 'GET_TEMPLATE' }, '*');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // SPA 路由变化后再挂一次
  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    if (isAttendancePage()) boot();
  }, 1000);
})();
