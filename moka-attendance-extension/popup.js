const STORAGE_KEY = 'attendanceRecords';
const DEBUG_KEY = 'debugInfo';
const DAY_META_KEY = 'dayMeta';
const VIEW_MONTH_KEY = 'viewMonthKey';
const SELECTED_DATE_KEY = 'selectedDate';

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

const calendarGridEl = document.getElementById('calendarGrid');
const dayDetailEmptyEl = document.getElementById('dayDetailEmpty');
const dayDetailBodyEl = document.getElementById('dayDetailBody');
const emptyHintEl = document.getElementById('emptyHint');
const clearBtn = document.getElementById('clearBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
const statusBoxEl = document.getElementById('statusBox');
const statusToggleEl = document.getElementById('statusToggle');
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
/** @type {Record<string, any>} */
let allDayMeta = {};
/** @type {string} */
let viewMonthKey = MokaHours.currentMonthKey();
/** @type {string|null} */
let selectedDate = null;

async function load() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEY,
    DEBUG_KEY,
    DAY_META_KEY,
    VIEW_MONTH_KEY,
    SELECTED_DATE_KEY
  ]);
  allRecords = stored[STORAGE_KEY] || {};
  allDayMeta = stored[DAY_META_KEY] || {};
  viewMonthKey = pickInitialMonth(allRecords, stored[VIEW_MONTH_KEY]);
  selectedDate = stored[SELECTED_DATE_KEY] || null;
  if (selectedDate && MokaHours.monthKeyFromDate(selectedDate) !== viewMonthKey) {
    selectedDate = null;
  }
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
  if (debug.hasTemplate) {
    lines.push(
      `接口模板 ${debug.templateMethod || ''} ${debug.templateSampleDate || ''}`.trim()
    );
  }
  if (debug.loginProbeAt) {
    lines.push(
      `登录探测 ${formatTime(debug.loginProbeAt)} · cookie=${debug.loginHasCookie ? '有' : '无'} · storage键=${debug.loginStorageKeys || 0}`
    );
  }
  if (debug.lastBatchAt) {
    lines.push(
      `批量 ${debug.lastBatchMonth || ''} 成功${debug.lastBatchOk || 0}/失败${debug.lastBatchFail || 0}${debug.lastBatchAborted ? '（已停止）' : ''}`
    );
  }
  if (debug.pageHref) lines.push(`页面 ${debug.pageHref}`);
  if (debug.seenUrl) lines.push(`请求 ${debug.seenUrl}`);
  if (debug.lastError) lines.push(`错误 ${debug.lastError}`);
  lines.push('提示：打开 /attendance 页右下角可按月批量拉取');
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

  const minKey = MokaHours.shiftMonthKey(months[0], -1);
  const maxKey = MokaHours.shiftMonthKey(months[months.length - 1], 1);
  prevMonthBtn.disabled = viewMonthKey <= minKey;
  nextMonthBtn.disabled = viewMonthKey >= maxKey;
}

function renderCalendar(monthRecords) {
  const cells = MokaHours.buildMonthCalendar(
    viewMonthKey,
    monthRecords,
    allDayMeta
  );
  calendarGridEl.innerHTML = '';

  for (const cell of cells) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cal-cell level-${cell.level}`;
    if (!cell.inMonth) {
      btn.classList.add('out');
      btn.disabled = true;
      btn.innerHTML =
        '<span class="cal-day"></span><span class="cal-emoji"></span><span class="cal-hours"></span>';
      calendarGridEl.appendChild(btn);
      continue;
    }

    if (cell.date === selectedDate) btn.classList.add('selected');
    if (cell.meta && cell.meta.isRestDay) btn.classList.add('is-rest');
    if (cell.meta && cell.meta.isWorkDay) btn.classList.add('is-work');

    const hoursText = MokaHours.formatCalendarHours(cell.record, cell.meta);
    btn.innerHTML = `
      <span class="cal-day">${cell.day}</span>
      <span class="cal-emoji">${cell.emoji || ''}</span>
      <span class="cal-hours">${hoursText ? escapeHtml(hoursText) : ''}</span>
    `;
    const parts = [cell.date];
    if (cell.styleLabel) parts.push(cell.styleLabel);
    if (cell.record && cell.record.status === 'ok') {
      parts.push(MokaHours.formatDuration(cell.record.workMs));
    } else if (cell.record) {
      parts.push(STATUS_TEXT[cell.record.status] || cell.record.status);
    } else if (cell.meta && cell.meta.isRestDay) {
      parts.push('休息日');
    } else {
      parts.push('无记录');
    }
    btn.title = parts.join(' · ');
    btn.addEventListener('click', () => selectDate(cell.date));
    calendarGridEl.appendChild(btn);
  }
}

function renderDayDetail() {
  const record = selectedDate ? allRecords[selectedDate] : null;
  const meta = selectedDate ? allDayMeta[selectedDate] : null;
  if (!selectedDate) {
    dayDetailEmptyEl.classList.remove('hidden');
    dayDetailEmptyEl.textContent = '点击日历中的日期查看明细';
    dayDetailBodyEl.classList.add('hidden');
    dayDetailBodyEl.innerHTML = '';
    return;
  }

  dayDetailEmptyEl.classList.add('hidden');
  dayDetailBodyEl.classList.remove('hidden');

  const dayKind = meta
    ? meta.isRestDay
      ? '休息日'
      : '工作日'
    : '日期类型未知';
  const style = MokaHours.calendarStyle(record, meta);

  if (!record) {
    dayDetailBodyEl.innerHTML = `
      <div class="item-top">
        <span class="date">${selectedDate}<span class="badge">${dayKind}</span></span>
        <span class="hours">${style.emoji || ''} ${
          meta && meta.isRestDay ? '休息' : '无记录'
        }</span>
      </div>
      <div class="meta">${
        meta && meta.isRestDay
          ? '休息日无打卡为正常'
          : '可在考勤页点开该日详情以采集数据'
      }</div>
    `;
    return;
  }

  const hoursClass =
    record.status === 'ok'
      ? ''
      : meta && meta.isRestDay
        ? ''
        : record.status === 'no_checkout'
          ? 'warn'
          : 'bad';
  const hoursText =
    record.status === 'ok'
      ? `${style.emoji || ''} ${MokaHours.formatDuration(record.workMs)}（${MokaHours.formatHoursDecimal(record.workMs)}h）`
      : meta && meta.isRestDay && record.status === 'no_clock'
        ? '休息日无打卡'
        : STATUS_TEXT[record.status] || record.status;
  const clockLine = [
    record.clockInTime ? `上班 ${shortTime(record.clockInTime)}` : '上班 —',
    record.clockOutTime ? `下班 ${shortTime(record.clockOutTime)}` : '下班 —'
  ].join(' · ');

  dayDetailBodyEl.innerHTML = `
    <div class="item-top">
      <span class="date">${record.date}<span class="badge">${dayKind}</span>${
        record.shiftName
          ? `<span class="badge">${escapeHtml(record.shiftName)}</span>`
          : ''
      }</span>
      <span class="hours ${hoursClass}">${hoursText}</span>
    </div>
    <div class="meta">${clockLine}${
      record.status === 'ok'
        ? ` · 毛时长 ${MokaHours.formatDuration(record.rawMs)} − 午休1h · ${style.label}`
        : ''
    }</div>
  `;
}

function renderEmptyHint(monthRecords) {
  const anyRecords = Object.keys(allRecords).length > 0;
  const monthHas = Object.keys(monthRecords).length > 0;
  emptyHintEl.classList.toggle('hidden', anyRecords && monthHas);
  if (!anyRecords) {
    emptyHintEl.textContent =
      '打开 Moka 考勤详情页并浏览日期后，本插件会自动捕获接口并计算工时。';
  } else if (!monthHas) {
    emptyHintEl.textContent = `${MokaHours.formatMonthLabel(viewMonthKey)} 暂无记录，可切换月份或继续在考勤页点开该月日期。`;
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
  renderCalendar(monthRecords);
  renderDayDetail();
  renderEmptyHint(monthRecords);
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

async function selectDate(date) {
  selectedDate = date;
  await chrome.storage.local.set({ [SELECTED_DATE_KEY]: date });
  renderCalendar(MokaHours.filterRecordsByMonth(allRecords, viewMonthKey));
  renderDayDetail();
}

async function changeMonth(delta) {
  const next = MokaHours.shiftMonthKey(viewMonthKey, delta);
  if (!next) return;
  viewMonthKey = next;
  selectedDate = null;
  await chrome.storage.local.set({
    [VIEW_MONTH_KEY]: viewMonthKey,
    [SELECTED_DATE_KEY]: null
  });
  renderAll();
}

prevMonthBtn.addEventListener('click', () => changeMonth(-1));
nextMonthBtn.addEventListener('click', () => changeMonth(1));

statusToggleEl.addEventListener('click', () => {
  statusBoxEl.classList.toggle('collapsed');
});

clearBtn.addEventListener('click', async () => {
  if (!confirm('确定清空本地已记录的工时数据？')) return;
  allRecords = {};
  selectedDate = null;
  await chrome.storage.local.set({
    [STORAGE_KEY]: {},
    [SELECTED_DATE_KEY]: null
  });
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
    const months = MokaHours.listMonthKeys(allRecords);
    if (months.length && !months.includes(viewMonthKey)) {
      viewMonthKey = months[months.length - 1];
      chrome.storage.local.set({ [VIEW_MONTH_KEY]: viewMonthKey });
    }
    renderAll();
  }
  if (changes[DAY_META_KEY]) {
    allDayMeta = changes[DAY_META_KEY].newValue || {};
    renderAll();
  }
  if (changes[DEBUG_KEY]) renderStatus(changes[DEBUG_KEY].newValue || null);
  if (changes[VIEW_MONTH_KEY] && changes[VIEW_MONTH_KEY].newValue) {
    viewMonthKey = changes[VIEW_MONTH_KEY].newValue;
    renderAll();
  }
});

load();
