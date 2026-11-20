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

  /** 从 YYYY-MM-DD 取 YYYY-MM */
  function monthKeyFromDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const m = dateStr.match(/^(\d{4})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}` : null;
  }

  function shiftMonthKey(monthKey, delta) {
    const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${mo}`;
  }

  function formatMonthLabel(monthKey) {
    const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return String(monthKey || '—');
    return `${m[1]}年${m[2]}月`;
  }

  function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  function summarizeRecords(records) {
    const items = Object.values(records || {});
    const okItems = items.filter((r) => r && r.status === 'ok' && r.workMs != null);
    const totalMs = okItems.reduce((sum, r) => sum + r.workMs, 0);
    return {
      dayCount: okItems.length,
      totalMs,
      avgMs: okItems.length ? totalMs / okItems.length : null
    };
  }

  function listMonthKeys(records) {
    const set = new Set();
    for (const r of Object.values(records || {})) {
      const key = monthKeyFromDate(r && r.date);
      if (key) set.add(key);
    }
    return Array.from(set).sort();
  }

  function filterRecordsByMonth(records, monthKey) {
    const out = {};
    for (const [date, r] of Object.entries(records || {})) {
      if (monthKeyFromDate(r && r.date) === monthKey) out[date] = r;
    }
    return out;
  }

  /**
   * 合并考勤记录：同日期取 updatedAt 更新的；缺 updatedAt 时导入侧覆盖。
   * 返回 { merged, added, updated, skipped }
   */
  function mergeRecords(existing, incoming) {
    const merged = { ...(existing || {}) };
    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const [date, rec] of Object.entries(incoming || {})) {
      if (!rec || !date) continue;
      const prev = merged[date];
      if (!prev) {
        merged[date] = rec;
        added += 1;
        continue;
      }
      const prevTs = Number(prev.updatedAt) || 0;
      const nextTs = Number(rec.updatedAt) || 0;
      if (nextTs >= prevTs) {
        merged[date] = rec;
        updated += 1;
      } else {
        skipped += 1;
      }
    }
    return { merged, added, updated, skipped };
  }

  function buildExportPayload(records) {
    return {
      app: 'moka-attendance-extension',
      version: 1,
      exportedAt: new Date().toISOString(),
      records: records || {}
    };
  }

  function parseImportPayload(raw) {
    let data = raw;
    if (typeof raw === 'string') {
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error('不是合法 JSON');
      }
    }
    if (!data || typeof data !== 'object') throw new Error('导入内容为空');
    // 兼容直接导出 { date: record } 或包装格式
    if (data.records && typeof data.records === 'object') return data.records;
    const keys = Object.keys(data);
    if (keys.length && keys.every((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))) {
      return data;
    }
    throw new Error('无法识别的备份格式');
  }

  root.MokaHours = {
    LUNCH_MS,
    parseClockTime,
    formatDuration,
    formatHoursDecimal,
    extractDayRecord,
    monthKeyFromDate,
    shiftMonthKey,
    formatMonthLabel,
    currentMonthKey,
    summarizeRecords,
    listMonthKeys,
    filterRecordsByMonth,
    mergeRecords,
    buildExportPayload,
    parseImportPayload
  };
})(typeof self !== 'undefined' ? self : window);
