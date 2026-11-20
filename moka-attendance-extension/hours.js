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

  function todayDateStr() {
    const n = new Date();
    const p = (x) => String(x).padStart(2, '0');
    return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
  }

  function isWeekendDate(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    const d = new Date(`${dateStr}T12:00:00`);
    const w = d.getDay();
    return w === 0 || w === 6;
  }

  /** 是否月历接口响应：data.year/month/days */
  function isMonthCalendarPayload(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (payload.code != null && Number(payload.code) !== 200) return false;
    const data = payload.data || payload;
    if (!data || typeof data !== 'object') return false;
    const year = Number(data.year);
    const month = Number(data.month);
    return (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      month >= 1 &&
      month <= 12 &&
      Array.isArray(data.days) &&
      data.days.length > 0 &&
      data.days[0] &&
      typeof data.days[0].day === 'string'
    );
  }

  function judgeRestFromItem(item) {
    if (!item) return false;
    const typeNum = Number(item.type);
    // type=2 休息日；fixedTimeRest 也表示休息；type=1 明确为工作日（含周日调休）
    if (typeNum === 1) return false;
    if (typeNum === 2) return true;
    if (item.fixedTimeRest === true || item.fixedTimeRest === 'true') return true;
    // 无班次且非工作日标记时，按休息处理
    if (
      (item.shiftId == null || item.shiftId === '') &&
      item.hasShift === false &&
      item.workDay === false
    ) {
      return true;
    }
    return false;
  }

  /**
   * 从月历接口抽出每日元数据。
   * type=2 / fixedTimeRest → 休息日；type=1 → 工作日（含调休上班）
   */
  function extractDayMetaMap(payload) {
    if (!isMonthCalendarPayload(payload)) return null;
    const data = payload.data || payload;
    const map = {};
    for (const item of data.days) {
      if (!item || !item.day) continue;
      const rest = judgeRestFromItem(item);
      map[item.day] = {
        date: item.day,
        type: item.type,
        workDay: Boolean(item.workDay),
        fixedTimeRest: Boolean(item.fixedTimeRest),
        hasShift: Boolean(item.hasShift),
        shiftId: item.shiftId == null || item.shiftId === '' ? null : item.shiftId,
        shiftName: item.shiftName || '',
        isRestDay: rest,
        isWorkDay: !rest,
        source: 'calendar'
      };
    }
    const year = Number(data.year);
    const month = Number(data.month);
    return {
      year,
      month,
      monthKey: `${year}-${String(month).padStart(2, '0')}`,
      beginDate: data.beginDate || null,
      endDate: data.endDate || null,
      days: map
    };
  }

  /**
   * 休息日判定：优先月历；无月历时周末兜底。
   * 月历标记 type=1 的周日调休仍算工作日。
   */
  function resolveIsRestDay(dateStr, meta) {
    if (meta && typeof meta.isRestDay === 'boolean') return meta.isRestDay;
    return isWeekendDate(dateStr);
  }

  function isRestDayMeta(meta) {
    if (!meta) return null;
    return Boolean(meta.isRestDay);
  }

  /** 日历格短工时，如 10.1 / 缺卡 / 空 */
  function formatCalendarHours(record, meta, dateStr) {
    const date = dateStr || (record && record.date) || (meta && meta.date);
    const rest = resolveIsRestDay(date, meta);
    if (!record) return '';
    if (record.status === 'ok' && record.workMs != null) {
      return (record.workMs / 3600000).toFixed(1);
    }
    // 休息日无打卡属正常，不提示异常
    if (rest || record.status === 'rest') return '';
    if (record.status === 'no_checkout') return '缺下班';
    if (record.status === 'no_clock') return '无打卡';
    return '—';
  }

  /**
   * 工作日按工时配色+表情；休息日灰色。
   * 8h 😊绿 / 10h 😐黄 / 11h 😅 / 12h 😓 / 13h 🥵 / 14h+ 🤯
   */
  function calendarStyle(record, meta, dateStr) {
    const date = dateStr || (record && record.date) || (meta && meta.date);
    const rest = resolveIsRestDay(date, meta);

    if (rest || (record && record.status === 'rest')) {
      if (record && record.status === 'ok' && record.workMs != null) {
        return { level: 'rest-ot', emoji: '', label: '休息日加班' };
      }
      return { level: 'rest', emoji: '', label: '休息日' };
    }

    if (!record) {
      return { level: 'work-empty', emoji: '', label: '工作日' };
    }
    if (record.status !== 'ok' || record.workMs == null) {
      return {
        level: 'work-warn',
        emoji: '😕',
        label: record.status
      };
    }

    const h = record.workMs / 3600000;
    if (h < 8) return { level: 'h-under', emoji: '😟', label: '不足8h' };
    if (h < 9.5) return { level: 'h-8', emoji: '😊', label: '约8h' };
    if (h < 10.5) return { level: 'h-10', emoji: '😐', label: '约10h' };
    if (h < 11.5) return { level: 'h-11', emoji: '😅', label: '约11h' };
    if (h < 12.5) return { level: 'h-12', emoji: '😓', label: '约12h' };
    if (h < 13.5) return { level: 'h-13', emoji: '🥵', label: '约13h' };
    return { level: 'h-14', emoji: '🤯', label: '≥14h' };
  }

  /**
   * 生成某月日历格（周一为一周起点）
   * dayMetaMap: { [date]: meta }
   */
  function buildMonthCalendar(monthKey, records, dayMetaMap) {
    const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return [];
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // JS: 0=Sun..6=Sat → 周一=0
    const startOffset = (first.getDay() + 6) % 7;
    const cells = [];
    const total = Math.ceil((startOffset + daysInMonth) / 7) * 7;
    const metaMap = dayMetaMap || {};

    for (let i = 0; i < total; i += 1) {
      const dayNum = i - startOffset + 1;
      if (dayNum < 1 || dayNum > daysInMonth) {
        cells.push({
          date: null,
          day: null,
          inMonth: false,
          record: null,
          meta: null,
          level: 'empty',
          emoji: '',
          styleLabel: ''
        });
        continue;
      }
      const date = `${m[1]}-${m[2]}-${String(dayNum).padStart(2, '0')}`;
      const record = (records && records[date]) || null;
      const meta = metaMap[date] || null;
      const style = calendarStyle(record, meta, date);
      cells.push({
        date,
        day: dayNum,
        inMonth: true,
        record,
        meta,
        isRestDay: resolveIsRestDay(date, meta),
        level: style.level,
        emoji: style.emoji,
        styleLabel: style.label
      });
    }
    return cells;
  }

  function calendarLevel(record, meta, dateStr) {
    return calendarStyle(record, meta, dateStr).level;
  }

  /** 将已存的「无打卡」在确认为休息日后改成 rest */
  function normalizeRestRecords(records, dayMetaMap) {
    const next = { ...(records || {}) };
    let changed = 0;
    for (const [date, rec] of Object.entries(next)) {
      if (!rec) continue;
      if (rec.status !== 'no_clock' && rec.status !== 'incomplete') continue;
      const meta = (dayMetaMap && dayMetaMap[date]) || null;
      if (resolveIsRestDay(date, meta)) {
        next[date] = { ...rec, status: 'rest' };
        changed += 1;
      }
    }
    return { records: next, changed };
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
    todayDateStr,
    isWeekendDate,
    summarizeRecords,
    listMonthKeys,
    filterRecordsByMonth,
    isMonthCalendarPayload,
    extractDayMetaMap,
    judgeRestFromItem,
    resolveIsRestDay,
    isRestDayMeta,
    formatCalendarHours,
    calendarStyle,
    buildMonthCalendar,
    calendarLevel,
    normalizeRestRecords,
    mergeRecords,
    buildExportPayload,
    parseImportPayload
  };
})(typeof self !== 'undefined' ? self : window);
