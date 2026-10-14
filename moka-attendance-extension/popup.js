const STORAGE_KEY = 'attendanceRecords';

const dayCountEl = document.getElementById('dayCount');
const totalHoursEl = document.getElementById('totalHours');
const avgHoursEl = document.getElementById('avgHours');
const listEl = document.getElementById('list');
const emptyHintEl = document.getElementById('emptyHint');
const clearBtn = document.getElementById('clearBtn');

const STATUS_TEXT = {
  ok: '已计算',
  no_checkout: '缺下班卡',
  no_clock: '无打卡',
  incomplete: '数据不完整'
};

async function load() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  render(stored[STORAGE_KEY] || {});
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
  if (area === 'local' && changes[STORAGE_KEY]) {
    render(changes[STORAGE_KEY].newValue || {});
  }
});

load();
