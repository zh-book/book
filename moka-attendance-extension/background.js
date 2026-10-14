importScripts('hours.js');

const STORAGE_KEY = 'attendanceRecords';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'ATTENDANCE_DETAIL') return;

  handleAttendanceDetail(message.payload)
    .then((record) => sendResponse({ ok: true, record }))
    .catch((err) =>
      sendResponse({ ok: false, error: String(err && err.message) })
    );
  return true;
});

async function handleAttendanceDetail(payload) {
  const record = self.MokaHours.extractDayRecord(payload);
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
    days.length === 0 ? '' : hours >= 100 ? String(Math.round(hours)) : hours.toFixed(1);

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
