const STORAGE_KEY = 'attendanceRecords';
const DEBUG_KEY = 'debugInfo';
const VIEW_MONTH_KEY = 'viewMonthKey';

const monthLabelEl = document.getElementById('monthLabel');
const monthRangeHintEl = document.getElementById('monthRangeHint');
const prevMonthBtn = document.getElementById('prevMonthBtn');
const nextMonthBtn = document.getElementById('nextMonthBtn');

const monthDayCountEl = document.getElementById('monthDayCount');
const monthTotalHoursEl = document.getElementById('monthTotalHours');
const monthAvgHoursEl = document.getElementById('monthAvgHours');

const allDayCountEl = document.getElementById('allDayCount');
const allTotalHoursEl = document.getElementById('allTotalHours');
const allAvgHoursEl = document.getElementById('allAvgHours');

const listEl = document.getElementById('list');
const emptyHintEl = document.getElementById('emptyHint');
const clearBtn = document.getElementById('clearBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
const statusLineEl = document.getElementById('statusLine');
const statusMetaEl = document.getElementById('statusMeta');

const STATUS_TEXT = {
  ok: '已计算',
  no_checkout: '缺下班卡',
  no_clock: '无打卡',
  incomplete: '数据不完整'
};

/** @type {Record<string, any>} */
let allRecords = {};
/** @type {string} */
let viewMonthKey = MokaHours.currentMonthKey();

async function load() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEY,
    DEBUG_KEY,
    VIEW_MONTH_KEY
  ]);
  allRecords = stored[STORAGE_KEY] || {};
  viewMonthKey = pickInitialMonth(allRecords, stored[VIEW_MONTH_KEY]);
  renderAll();
  renderStatus(stored[DEBUG_KEY] || null);
}

function pickInitialMonth(records, savedMonth) {
  const months = MokaHours.listMonthKeys(records);
  if (savedMonth && months.includes(savedMonth)) return savedMonth;
  if (months.length) return months[months.length - 1];
  const current = MokaHours.currentMonthKey();
  if (savedMonth && /^\d{4}-\d{2}$/.test(savedMonth)) return savedMonth;
  return current;
}

function formatTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function renderStatus(debug) {
  if (!debug) {
    statusLineEl.className = 'status-line warn';
    statusLineEl.textContent = '尚未检测到接口请求';
    statusMetaEl.textContent =
      '请刷新考勤页后点开某天详情。若仍无状态变化，确认地址栏域名含 mokahr.com。';
    return;
  }

  if (debug.lastOk) {
    statusLineEl.className = 'status-line ok';
    statusLineEl.textContent = `已捕获 ${debug.lastDate || ''}（via ${debug.lastVia || '—'}）`;
  } else if (debug.seenUrl) {
    statusLineEl.className = 'status-line warn';
    statusLineEl.textContent = '已看到接口，但解析/回拉失败';
  } else if (debug.hookReady || debug.contentReady) {
    statusLineEl.className = 'status-line warn';
    statusLineEl.textContent = '页面已注入，等待详情接口';
  } else {
    statusLineEl.className = 'status-line warn';
    statusLineEl.textContent = '尚未检测到接口请求';
  }

  const lines = [];
  if (debug.seenAt) lines.push(`网络监听 ${formatTime(debug.seenAt)}`);
  if (debug.lastAt) lines.push(`最近处理 ${formatTime(debug.lastAt)}`);
  if (debug.lastVia) lines.push(`来源 ${debug.lastVia}`);
  if (debug.seenMethod) lines.push(`方法 ${debug.seenMethod}`);
  if (debug.pageHref) lines.push(`页面 ${debug.pageHref}`);
  if (debug.seenUrl) lines.push(`请求 ${debug.seenUrl}`);
  if (debug.lastError) lines.push(`错误 ${debug.lastError}`);
  statusMetaEl.textContent = lines.join('\n') || '刷新考勤页并点开详情以触发接口';
}

function renderSummary(target, els) {
  els.dayCount.textContent = String(target.dayCount);
  els.totalHours.textContent = target.dayCount
    ? MokaHours.formatDuration(target.totalMs)
    : '—';
  els.avgHours.textContent =
    target.avgMs != null ? MokaHours.formatDuration(target.avgMs) : '—';
}

function renderMonthNav() {
  const months = MokaHours.listMonthKeys(allRecords);
  monthLabelEl.textContent = MokaHours.formatMonthLabel(viewMonthKey);

  if (!months.length) {
    monthRangeHintEl.textContent = '暂无记录，可左右翻月等待采集';
    prevMonthBtn.disabled = false;
    nextMonthBtn.disabled = false;
    return;
  }

  const idx = months.indexOf(viewMonthKey);
  const hasData = idx >= 0;
  monthRangeHintEl.textContent = hasData
    ? `有数据月份 ${months.length} 个（${MokaHours.formatMonthLabel(months[0])} ~ ${MokaHours.formatMonthLabel(months[months.length - 1])}）`
    : `当前月无数据；有数据：${MokaHours.formatMonthLabel(months[0])} ~ ${MokaHours.formatMonthLabel(months[months.length - 1])}`;

  // 允许翻到相邻空月，但不要无限远：以有数据范围 ±1 月为界，若无数据则不限制当前月邻域
  const minKey = MokaHours.shiftMonthKey(months[0], -1);
  const maxKey = MokaHours.shiftMonthKey(months[months.length - 1], 1);
  prevMonthBtn.disabled = viewMonthKey <= minKey;
  nextMonthBtn.disabled = viewMonthKey >= maxKey;
}

function renderList(monthRecords) {
  const items = Object.values(monthRecords).sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0
  );

  const anyRecords = Object.keys(allRecords).length > 0;
  emptyHintEl.classList.toggle('hidden', anyRecords);
  if (!anyRecords) {
    emptyHintEl.textContent =
      '打开 Moka 考勤详情页并浏览日期后，本插件会自动捕获接口并计算工时。';
  } else if (!items.length) {
    emptyHintEl.classList.remove('hidden');
    emptyHintEl.textContent = `${MokaHours.formatMonthLabel(viewMonthKey)} 暂无记录，可切换月份或继续在考勤页点开该月日期。`;
  }

  listEl.innerHTML = '';
  for (const record of items) {
    const li = document.createElement('li');
    li.className = 'item';

    const hoursClass =
      record.status === 'ok' ? '' : record.status === 'no_checkout' ? 'warn' : 'bad';
    const hoursText =
      record.status === 'ok'
        ? `${MokaHours.formatDuration(record.workMs)}（${MokaHours.formatHoursDecimal(record.workMs)}h）`
        : STATUS_TEXT[record.status] || record.status;

    const clockLine = [
      record.clockInTime ? `上班 ${shortTime(record.clockInTime)}` : '上班 —',
      record.clockOutTime ? `下班 ${shortTime(record.clockOutTime)}` : '下班 —'
    ].join(' · ');

    li.innerHTML = `
      <div class="item-top">
        <span class="date">${record.date}${
          record.shiftName
            ? `<span class="badge">${escapeHtml(record.shiftName)}</span>`
            : ''
        }</span>
        <span class="hours ${hoursClass}">${hoursText}</span>
      </div>
      <div class="meta">${clockLine}${
        record.status === 'ok'
          ? ` · 毛时长 ${MokaHours.formatDuration(record.rawMs)} − 午休1h`
          : ''
      }</div>
    `;
    listEl.appendChild(li);
  }
}

function renderAll() {
  const monthRecords = MokaHours.filterRecordsByMonth(allRecords, viewMonthKey);
  const monthSummary = MokaHours.summarizeRecords(monthRecords);
  const allSummary = MokaHours.summarizeRecords(allRecords);

  renderMonthNav();
  renderSummary(monthSummary, {
    dayCount: monthDayCountEl,
    totalHours: monthTotalHoursEl,
    avgHours: monthAvgHoursEl
  });
  renderSummary(allSummary, {
    dayCount: allDayCountEl,
    totalHours: allTotalHoursEl,
    avgHours: allAvgHoursEl
  });
  renderList(monthRecords);
}

function shortTime(value) {
  const m = String(value).match(/(\d{2}:\d{2})(?::\d{2})?$/);
  return m ? m[1] : value;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function changeMonth(delta) {
  const next = MokaHours.shiftMonthKey(viewMonthKey, delta);
  if (!next) return;
  viewMonthKey = next;
  await chrome.storage.local.set({ [VIEW_MONTH_KEY]: viewMonthKey });
  renderAll();
}

prevMonthBtn.addEventListener('click', () => changeMonth(-1));
nextMonthBtn.addEventListener('click', () => changeMonth(1));

clearBtn.addEventListener('click', async () => {
  if (!confirm('确定清空本地已记录的工时数据？')) return;
  allRecords = {};
  await chrome.storage.local.set({ [STORAGE_KEY]: {} });
  renderAll();
});

exportBtn.addEventListener('click', () => {
  const payload = MokaHours.buildExportPayload(allRecords);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `moka-attendance-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

importBtn.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async () => {
  const file = importFile.files && importFile.files[0];
  importFile.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const incoming = MokaHours.parseImportPayload(text);
    const result = MokaHours.mergeRecords(allRecords, incoming);
    allRecords = result.merged;
    await chrome.storage.local.set({ [STORAGE_KEY]: allRecords });
    const months = MokaHours.listMonthKeys(allRecords);
    if (months.length) {
      viewMonthKey = months[months.length - 1];
      await chrome.storage.local.set({ [VIEW_MONTH_KEY]: viewMonthKey });
    }
    renderAll();
    alert(
      `导入完成：新增 ${result.added}，更新 ${result.updated}，跳过 ${result.skipped}`
    );
  } catch (err) {
    alert(`导入失败：${err && err.message ? err.message : err}`);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[STORAGE_KEY]) {
    allRecords = changes[STORAGE_KEY].newValue || {};
    // 新捕获的日期若落在其他月，自动跳到该月，方便立刻看到
    const months = MokaHours.listMonthKeys(allRecords);
    if (months.length && !months.includes(viewMonthKey)) {
      viewMonthKey = months[months.length - 1];
      chrome.storage.local.set({ [VIEW_MONTH_KEY]: viewMonthKey });
    }
    renderAll();
  }
  if (changes[DEBUG_KEY]) renderStatus(changes[DEBUG_KEY].newValue || null);
  if (changes[VIEW_MONTH_KEY] && changes[VIEW_MONTH_KEY].newValue) {
    viewMonthKey = changes[VIEW_MONTH_KEY].newValue;
    renderAll();
  }
});

load();
