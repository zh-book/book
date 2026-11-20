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
  let contextDead = false;

  const pending = new Map();

  function extensionAlive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  /** 扩展热重载后旧页面脚本会失效，统一吞掉避免 Uncaught */
  function safeSendMessage(message) {
    if (contextDead || !extensionAlive()) {
      contextDead = true;
      return Promise.resolve(null);
    }
    try {
      const ret = chrome.runtime.sendMessage(message);
      if (ret && typeof ret.then === 'function') {
        return ret.catch((err) => {
          const msg = String(err && err.message ? err.message : err);
          if (/Extension context invalidated/i.test(msg)) {
            contextDead = true;
            setMeta('扩展已重新加载，请刷新本页后再批量拉取');
          }
          return null;
        });
      }
      return Promise.resolve(ret);
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      if (/Extension context invalidated/i.test(msg)) {
        contextDead = true;
        setMeta('扩展已重新加载，请刷新本页后再批量拉取');
      }
      return Promise.resolve(null);
    }
  }

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

  function requestDayWithTemplate(date, baseTemplate) {
    const requestId = `${date}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve) => {
      pending.set(requestId, resolve);
      window.postMessage(
        {
          source: SOURCE,
          type: 'FETCH_DAY',
          requestId,
          date,
          // 固定批次开始时的模板，避免 sampleDate 漂移导致隔天替换失败
          template: baseTemplate
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

  /** 批量前拉工作日历 calendar/v1/m/list */
  function requestMonthCalendar(monthKey) {
    const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return Promise.resolve({ ok: false, error: 'bad-month' });
    const year = Number(m[1]);
    const month = Number(m[2]);
    const requestId = `cal-${monthKey}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve) => {
      pending.set(requestId, resolve);
      window.postMessage(
        {
          source: SOURCE,
          type: 'FETCH_MONTH_CALENDAR',
          requestId,
          year,
          month
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

  function writeRestPlaceholder(records, date, meta) {
    const prev = records[date];
    if (prev && prev.status !== 'no_clock' && prev.status !== 'incomplete' && prev.status !== 'rest') {
      return false;
    }
    records[date] = {
      date,
      employeeId: (prev && prev.employeeId) || null,
      shiftName: (prev && prev.shiftName) || (meta && meta.shiftName) || '',
      clockInTime: null,
      clockOutTime: null,
      rawMs: null,
      workMs: null,
      lunchMs: 3600000,
      status: 'rest',
      updatedAt: Date.now()
    };
    return true;
  }

  async function filterBatchDays(monthKey, allDays, today, calendarOk) {
    let skippedRest = 0;
    let skippedFuture = 0;
    const stored = await chrome.storage.local.get(['dayMeta', 'attendanceRecords']);
    const metaMap = stored.dayMeta || {};
    const records = { ...(stored.attendanceRecords || {}) };
    let recordsDirty = false;

    // 大小周：有当月工作日历时只信 type=1/2，不再用周末兜底（大周周六要上班）
    const monthMetaCount = Object.keys(metaMap).filter((d) =>
      d.startsWith(`${monthKey}-`)
    ).length;
    const useCalendar = calendarOk || monthMetaCount > 0;

    const days = allDays.filter((d) => {
      if (d > today) {
        skippedFuture += 1;
        return false;
      }
      const meta = metaMap[d] || null;
      let isRest = false;
      if (useCalendar) {
        isRest = Boolean(meta && meta.isRestDay);
      } else if (typeof MokaHours !== 'undefined' && MokaHours.resolveIsRestDay) {
        isRest = MokaHours.resolveIsRestDay(d, meta);
      } else {
        const w = new Date(`${d}T12:00:00`).getDay();
        isRest = w === 0 || w === 6;
      }
      if (isRest) {
        skippedRest += 1;
        if (writeRestPlaceholder(records, d, meta)) recordsDirty = true;
        return false;
      }
      return true;
    });

    if (recordsDirty) {
      await chrome.storage.local.set({ attendanceRecords: records });
    }
    return { days, skippedRest, skippedFuture, useCalendar, monthMetaCount };
  }

  async function startBatch() {
    if (running) return;
    if (!extensionAlive()) {
      contextDead = true;
      setMeta('扩展上下文已失效，请刷新本页后再试');
      return;
    }

    const monthEl = document.getElementById('mokaMonth');
    const monthKey = monthEl && monthEl.value;
    if (!monthKey) {
      setMeta('请选择月份');
      return;
    }

    const allDays = daysInMonth(monthKey);
    if (!allDays.length) return;

    const today =
      typeof MokaHours !== 'undefined' && MokaHours.todayDateStr
        ? MokaHours.todayDateStr()
        : (() => {
            const n = new Date();
            const p = (x) => String(x).padStart(2, '0');
            return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
          })();

    running = true;
    abortFlag = false;
    const btn = document.getElementById('mokaBatchBtn');
    const stopBtn = document.getElementById('mokaStopBtn');
    if (btn) btn.disabled = true;
    if (stopBtn) stopBtn.hidden = false;

    let skippedRest = 0;
    let skippedFuture = 0;
    let calendarOk = false;
    let days = [];

    try {
      // 1) 先拉当月工作日历（type=1 工作日 / type=2 休息日，适配大小周）
      setMeta(`正在获取 ${monthKey} 工作日历…`);
      setProgress(0, 1);
      const calResult = await requestMonthCalendar(monthKey);
      calendarOk = Boolean(calResult && calResult.ok && calResult.payload);
      if (calendarOk && calResult.payload) {
        // 再走一遍 background，确保 dayMeta 落盘后再过滤
        await safeSendMessage({
          type: 'MONTH_CALENDAR',
          payload: calResult.payload,
          url: calResult.url || '',
          via: 'batch-calendar'
        });
        await sleep(120);
      } else {
        setMeta(
          `工作日历获取失败（${(calResult && calResult.error) || (calResult && calResult.status) || 'unknown'}），将尽量用已缓存日历…`
        );
        await sleep(400);
      }

      if (abortFlag || contextDead) throw new Error('aborted');

      const filtered = await filterBatchDays(monthKey, allDays, today, calendarOk);
      days = filtered.days;
      skippedRest = filtered.skippedRest;
      skippedFuture = filtered.skippedFuture;

      setMeta(
        calendarOk || filtered.useCalendar
          ? `日历已就绪（${filtered.monthMetaCount} 天），待拉工作日 ${days.length}，跳过休息 ${skippedRest}，跳过未来 ${skippedFuture}`
          : `无工作日历，待拉 ${days.length} 天（周末兜底跳过 ${skippedRest}）`
      );
      await sleep(200);

      // 2) 冻结详情模板后进入批量
      window.postMessage({ source: SOURCE, type: 'GET_TEMPLATE' }, '*');
      await sleep(200);
      const baseTemplate = template
        ? JSON.parse(JSON.stringify(template))
        : {
            method: 'GET',
            url: 'https://core.mokahr.com/api/abs/attendance/myAttendance/v2/m/detail?bus=20',
            body: null,
            headers: { Accept: 'application/json, text/plain, */*' },
            sampleDate: null
          };

      window.postMessage({ source: SOURCE, type: 'BATCH_START' }, '*');
      await safeSendMessage({ type: 'BATCH_START', monthKey });

      let okCount = 0;
      let failCount = 0;
      let mismatchCount = 0;
      try {
        for (let i = 0; i < days.length; i += 1) {
          if (abortFlag || contextDead) break;
          if (!extensionAlive()) {
            contextDead = true;
            break;
          }
          const date = days[i];
          setMeta(`正在拉取 ${date}（${i + 1}/${days.length}）…`);
          setProgress(i, days.length);

          const result = await requestDayWithTemplate(date, baseTemplate);
          const matched =
            result &&
            result.ok &&
            result.payload &&
            result.payload.code === 200 &&
            result.dateMatched !== false;
          if (matched) {
            okCount += 1;
          } else {
            failCount += 1;
            if (result && result.dateMatched === false) mismatchCount += 1;
          }
          await sleep(280);
        }
      } finally {
        window.postMessage({ source: SOURCE, type: 'BATCH_END' }, '*');
        await safeSendMessage({ type: 'BATCH_END' });

        setProgress(days.length, days.length);
        const mismatchTip = mismatchCount
          ? `，日期不一致 ${mismatchCount}`
          : '';
        const restTip = skippedRest ? `，跳过休息日 ${skippedRest}` : '';
        const futureTip = skippedFuture ? `，跳过未来 ${skippedFuture}` : '';
        const calTip = calendarOk ? '，日历已更新' : '，日历未刷新';
        if (contextDead) {
          setMeta(
            `扩展已重新加载，请刷新本页。已成功 ${okCount}，失败/空 ${failCount}${mismatchTip}${restTip}${futureTip}${calTip}`
          );
        } else {
          setMeta(
            abortFlag
              ? `已停止。成功 ${okCount}，失败/空 ${failCount}${mismatchTip}${restTip}${futureTip}${calTip}。可打开插件弹窗查看日历。`
              : `完成。成功 ${okCount}，失败/空 ${failCount}${mismatchTip}${restTip}${futureTip}${calTip}。可打开插件弹窗查看日历。`
          );
        }

        await safeSendMessage({
          type: 'BATCH_DONE',
          monthKey,
          okCount,
          failCount,
          mismatchCount,
          calendarOk,
          aborted: abortFlag || contextDead
        });
      }
    } catch (err) {
      window.postMessage({ source: SOURCE, type: 'BATCH_END' }, '*');
      await safeSendMessage({ type: 'BATCH_END' });
      if (!contextDead) {
        setMeta(`批量中断：${String(err && err.message ? err.message : err)}`);
      }
    } finally {
      running = false;
      if (btn) btn.disabled = false;
      if (stopBtn) stopBtn.hidden = true;
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE) return;

    if (data.type === 'API_TEMPLATE') {
      template = data.template || null;
      safeSendMessage({ type: 'SAVE_API_TEMPLATE', template });
      refreshMeta();
      return;
    }

    if (data.type === 'LOGIN_PROBE') {
      loginInfo = data;
      safeSendMessage({
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

    if (
      (data.type === 'FETCH_DAY_RESULT' || data.type === 'FETCH_MONTH_CALENDAR_RESULT') &&
      data.requestId
    ) {
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
