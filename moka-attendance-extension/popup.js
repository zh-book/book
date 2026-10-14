const STORAGE_KEY = 'attendanceRecords';
const DEBUG_KEY = 'debugInfo';

const dayCountEl = document.getElementById('dayCount');
const totalHoursEl = document.getElementById('totalHours');
const avgHoursEl = document.getElementById('avgHours');
const listEl = document.getElementById('list');
const emptyHintEl = document.getElementById('emptyHint');
const clearBtn = document.getElementById('clearBtn');
const statusLineEl = document.getElementById('statusLine');
const statusMetaEl = document.getElementById('statusMeta');

const STATUS_TEXT = {
  ok: '已计算',
  no_checkout: '缺下班卡',
  no_clock: '无打卡',
  incomplete: '数据不完整'
};

async function load() {
  const stored = await chrome.storage.local.get([STORAGE_KEY, DEBUG_KEY]);
  render(stored[STORAGE_KEY] || {});
  renderStatus(stored[DEBUG_KEY] || null);
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

function render(records) {
  const items = Object.values(records).sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0
  );
  const okItems = items.filter((r) => r.status === 'ok' && r.workMs != null);
  const totalMs = okItems.reduce((sum, r) => sum + r.workMs, 0);

  dayCountEl.textContent = String(okItems.length);
  totalHoursEl.textContent = okItems.length
    ? MokaHours.formatDuration(totalMs)
    : '—';
  avgHoursEl.textContent = okItems.length
    ? MokaHours.formatDuration(totalMs / okItems.length)
    : '—';

  emptyHintEl.classList.toggle('hidden', items.length > 0);
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

clearBtn.addEventListener('click', async () => {
  if (!confirm('确定清空本地已记录的工时数据？')) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: {} });
  render({});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[STORAGE_KEY]) render(changes[STORAGE_KEY].newValue || {});
  if (changes[DEBUG_KEY]) renderStatus(changes[DEBUG_KEY].newValue || null);
});

load();
