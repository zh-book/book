importScripts('hours.js');

const STORAGE_KEY = 'attendanceRecords';
const DEBUG_KEY = 'debugInfo';
const TARGET_PATH = '/api/abs/attendance/myAttendance/v2/m/detail';
const TARGET_URLS = [
  'https://core.mokahr.com/api/abs/attendance/myAttendance/v2/m/detail*'
];

/** requestId -> { url, method, body, tabId } */
const pending = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'CONTENT_READY' || message.type === 'HOOK_READY') {
    setDebug({
      contentReady: true,
      hookReady: message.type === 'HOOK_READY' ? true : undefined,
      pageHref: message.href || (sender.tab && sender.tab.url) || '',
      at: Date.now()
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'ATTENDANCE_DETAIL') {
    handleAttendanceDetail(message.payload, {
      url: message.url,
      via: message.via || 'page'
    })
      .then((record) => sendResponse({ ok: true, record }))
      .catch((err) =>
        sendResponse({ ok: false, error: String(err && err.message) })
      );
    return true;
  }

  if (message.type === 'GET_DEBUG') {
    chrome.storage.local.get([DEBUG_KEY, STORAGE_KEY]).then((stored) => {
      sendResponse({
        debug: stored[DEBUG_KEY] || null,
        recordCount: Object.keys(stored[STORAGE_KEY] || {}).length
      });
    });
    return true;
  }
});

async function setDebug(patch) {
  const stored = await chrome.storage.local.get(DEBUG_KEY);
  const prev = stored[DEBUG_KEY] || {};
  const next = { ...prev, ...patch };
  // hookReady 只升不降，避免 CONTENT_READY 覆盖掉已就绪状态
  if (patch.hookReady === undefined) next.hookReady = prev.hookReady;
  await chrome.storage.local.set({ [DEBUG_KEY]: next });
}

async function handleAttendanceDetail(payload, meta) {
  const record = self.MokaHours.extractDayRecord(payload);
  await setDebug({
    lastUrl: meta.url || '',
    lastVia: meta.via || '',
    lastAt: Date.now(),
    lastOk: Boolean(record),
    lastDate: record ? record.date : null,
    lastError: record ? '' : '响应无法解析为考勤详情'
  });
  if (!record) return null;

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const records = stored[STORAGE_KEY] || {};
  records[record.date] = record;
  await chrome.storage.local.set({ [STORAGE_KEY]: records });
  updateBadge(records);
  return record;
}

function updateBadge(records) {
  const days = Object.values(records).filter((r) => r.status === 'ok');
  const totalMs = days.reduce((sum, r) => sum + (r.workMs || 0), 0);
  const hours = totalMs / 3600000;
  const text =
    days.length === 0
      ? ''
      : hours >= 100
        ? String(Math.round(hours))
        : hours.toFixed(1);

  chrome.action.setBadgeBackgroundColor({ color: '#0F766E' });
  chrome.action.setBadgeText({ text });
  chrome.action.setTitle({
    title:
      days.length === 0
        ? 'Moka 考勤工时'
        : `已记录 ${days.length} 天，合计 ${self.MokaHours.formatDuration(totalMs)}`
  });
}

chrome.storage.local.get(STORAGE_KEY).then((stored) => {
  updateBadge(stored[STORAGE_KEY] || {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY]) {
    updateBadge(changes[STORAGE_KEY].newValue || {});
  }
});

function isTarget(url) {
  return typeof url === 'string' && url.includes(TARGET_PATH);
}

function decodeRawBody(requestBody) {
  if (!requestBody) return null;
  if (requestBody.raw && requestBody.raw.length) {
    try {
      const chunks = requestBody.raw.map((part) => {
        if (!part.bytes) return '';
        return new TextDecoder('utf-8').decode(new Uint8Array(part.bytes));
      });
      return chunks.join('');
    } catch {
      return null;
    }
  }
  if (requestBody.formData) {
    const params = new URLSearchParams();
    for (const [key, values] of Object.entries(requestBody.formData)) {
      for (const v of values) params.append(key, v);
    }
    return params.toString();
  }
  return null;
}

// 页面钩子失败时的底线：看到目标接口后，由扩展凭 cookie 再拉一次响应体
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (!isTarget(details.url)) return;
    pending.set(details.requestId, {
      url: details.url,
      method: details.method || 'GET',
      body: decodeRawBody(details.requestBody),
      tabId: details.tabId,
      type: details.type
    });
    setDebug({
      seenUrl: details.url,
      seenMethod: details.method,
      seenAt: Date.now()
    });
  },
  { urls: TARGET_URLS },
  ['requestBody']
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (!isTarget(details.url)) return;
    const info = pending.get(details.requestId) || {
      url: details.url,
      method: details.method || 'GET',
      body: null,
      tabId: details.tabId
    };
    pending.delete(details.requestId);

    // 页面钩子若已成功解析，短时间内不必重复回拉
    chrome.storage.local.get(DEBUG_KEY).then(async (stored) => {
      const debug = stored[DEBUG_KEY] || {};
      if (
        debug.lastOk &&
        debug.lastVia &&
        debug.lastVia !== 'webRequest' &&
        debug.lastAt &&
        Date.now() - debug.lastAt < 2000 &&
        debug.lastUrl &&
        details.url.includes(TARGET_PATH)
      ) {
        return;
      }
      await refetchAndStore(info);
    });
  },
  { urls: TARGET_URLS }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    pending.delete(details.requestId);
  },
  { urls: TARGET_URLS }
);

async function refetchAndStore(info) {
  try {
    const headers = {
      Accept: 'application/json, text/plain, */*'
    };
    const init = {
      method: info.method || 'GET',
      credentials: 'include',
      headers
    };
    if (info.body && info.method && info.method.toUpperCase() !== 'GET') {
      init.body = info.body;
      // 多数 JSON POST；若是 form 也尽量带上
      if (info.body.trim().startsWith('{') || info.body.trim().startsWith('[')) {
        headers['Content-Type'] = 'application/json;charset=UTF-8';
      } else {
        headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
      }
    }

    const response = await fetch(info.url, init);
    const json = await response.json();
    await handleAttendanceDetail(json, { url: info.url, via: 'webRequest' });
  } catch (err) {
    await setDebug({
      lastUrl: info.url,
      lastVia: 'webRequest',
      lastAt: Date.now(),
      lastOk: false,
      lastError: String(err && err.message ? err.message : err)
    });
  }
}

// 标签页进入 mokahr 时主动注入 MAIN world，覆盖「安装扩展前已打开」的页面
async function injectIntoTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['inject.js'],
      world: 'MAIN'
    });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js'],
      world: 'ISOLATED'
    });
  } catch {
    /* 非匹配页或无权限时忽略 */
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' && changeInfo.status !== 'complete') return;
  const url = tab.url || changeInfo.url || '';
  if (!/mokahr\.com/i.test(url)) return;
  injectIntoTab(tabId);
});
