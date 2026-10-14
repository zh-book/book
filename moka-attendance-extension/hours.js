/** 共享工时计算（background / popup 通过 importScripts 或 script 标签加载） */
(function (root) {
  const LUNCH_MS = 60 * 60 * 1000;

  function parseClockTime(value) {
    if (!value || typeof value !== 'string') return null;
    const normalized = value.trim().replace('T', ' ').replace(/\.\d+/, '');
    // 按本地墙钟解析，避免 ISO 时区把结果偏移
    const m = normalized.match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/
    );
    if (m) {
      const [, y, mo, d, h, mi, s] = m;
      return new Date(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(h),
        Number(mi),
        Number(s || 0)
      );
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatDuration(ms) {
    if (ms == null || Number.isNaN(ms)) return '—';
    const sign = ms < 0 ? '-' : '';
    const abs = Math.abs(ms);
    const totalMinutes = Math.round(abs / 60000);
    const h = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${sign}${h}小时${String(mins).padStart(2, '0')}分`;
  }

  function formatHoursDecimal(ms) {
    if (ms == null || Number.isNaN(ms)) return '—';
    return (ms / 3600000).toFixed(2);
  }

  /**
   * 从考勤详情响应抽出单日工时
   * 工时 = 下班打卡 - 上班打卡 - 1 小时午休
   */
  function extractDayRecord(payload) {
    if (!payload || payload.code !== 200 || !payload.data) return null;

    const data = payload.data;
    const date = data.attendanceDate;
    if (!date) return null;

    const detail = data.detail || {};
    const clockField =
      detail['myAttendanceAttendanceRecord#clockInAndOutTime'];
    const clockList = (clockField && clockField.fieldValue) || [];
    const first = clockList[0] || {};

    const clockInTime = first.clockInTime || null;
    const clockOutTime = first.clockOutTime || null;
    const inDate = parseClockTime(clockInTime);
    const outDate = parseClockTime(clockOutTime);

    let rawMs = null;
    let workMs = null;
    let status = 'incomplete';

    if (inDate && outDate) {
      rawMs = outDate.getTime() - inDate.getTime();
      workMs = Math.max(0, rawMs - LUNCH_MS);
      status = 'ok';
    } else if (inDate && !outDate) {
      status = 'no_checkout';
    } else if (!inDate && !outDate) {
      status = 'no_clock';
    }

    const shiftField = detail['myAttendanceAttendanceRecord#shiftName'];
    const shiftName = (shiftField && shiftField.fieldValue) || '';

    return {
      date,
      employeeId: data.employeeId ?? null,
      shiftName,
      clockInTime,
      clockOutTime,
      rawMs,
      workMs,
      lunchMs: LUNCH_MS,
      status,
      updatedAt: Date.now()
    };
  }

  root.MokaHours = {
    LUNCH_MS,
    parseClockTime,
    formatDuration,
    formatHoursDecimal,
    extractDayRecord
  };
})(typeof self !== 'undefined' ? self : window);
