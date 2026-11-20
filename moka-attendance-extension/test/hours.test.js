/**
 * 简易自测：node test/hours.test.js
 * 不依赖测试框架，便于在无浏览器环境验证计算公式。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'hours.js'), 'utf8');
const sandbox = { self: {}, window: {}, console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { MokaHours } = sandbox.self;

const sample = {
  code: 200,
  msg: '操作成功',
  data: {
    detail: {
      'myAttendanceAttendanceRecord#shiftName': {
        fieldName: 'myAttendanceAttendanceRecord#shiftName',
        fieldLabel: '班次名称',
        fieldValue: 'E9至18'
      },
      'myAttendanceAttendanceRecord#clockInAndOutTime': {
        fieldName: 'myAttendanceAttendanceRecord#clockInAndOutTime',
        fieldLabel: '上下班打卡时间',
        fieldValue: [
          {
            clockInTime: '2026-08-06 08:52',
            clockOutTime: '2026-08-06 19:57'
          }
        ]
      }
    },
    employeeId: 1728170,
    attendanceDate: '2026-08-06'
  }
};

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const record = MokaHours.extractDayRecord(sample);
assert(record, '应解析出记录');
assert(record.date === '2026-08-06', '日期错误');
assert(record.status === 'ok', '状态应为 ok');
assert(record.workMs === 10 * 3600000 + 5 * 60000, `工时应为 10h05m，实际 ${record.workMs}`);
assert(
  MokaHours.formatDuration(record.workMs) === '10小时05分',
  `格式化错误: ${MokaHours.formatDuration(record.workMs)}`
);

const noOut = JSON.parse(JSON.stringify(sample));
noOut.data.detail['myAttendanceAttendanceRecord#clockInAndOutTime'].fieldValue[0].clockOutTime =
  null;
const incomplete = MokaHours.extractDayRecord(noOut);
assert(incomplete.status === 'no_checkout', '缺下班卡状态错误');

assert(MokaHours.monthKeyFromDate('2026-08-06') === '2026-08', '月键错误');
assert(MokaHours.shiftMonthKey('2026-01', -1) === '2025-12', '跨年上一月错误');
assert(MokaHours.shiftMonthKey('2026-12', 1) === '2027-01', '跨年下一月错误');
assert(MokaHours.formatMonthLabel('2026-08') === '2026年08月', '月标签错误');

const records = {
  '2026-08-06': {
    date: '2026-08-06',
    status: 'ok',
    workMs: 10 * 3600000 + 5 * 60000
  },
  '2026-08-07': {
    date: '2026-08-07',
    status: 'ok',
    workMs: 9 * 3600000
  },
  '2026-09-01': {
    date: '2026-09-01',
    status: 'ok',
    workMs: 8 * 3600000
  },
  '2026-08-08': {
    date: '2026-08-08',
    status: 'no_checkout',
    workMs: null
  }
};

const months = MokaHours.listMonthKeys(records);
assert(months.join(',') === '2026-08,2026-09', `月份列表错误: ${months}`);

const aug = MokaHours.filterRecordsByMonth(records, '2026-08');
assert(Object.keys(aug).length === 3, '八月过滤条数错误');
const augSummary = MokaHours.summarizeRecords(aug);
assert(augSummary.dayCount === 2, '八月有效天数错误');
assert(
  augSummary.totalMs === 19 * 3600000 + 5 * 60000,
  `八月合计错误: ${augSummary.totalMs}`
);
assert(
  Math.abs(augSummary.avgMs - (19 * 3600000 + 5 * 60000) / 2) < 1,
  '八月日均错误'
);

const allSummary = MokaHours.summarizeRecords(records);
assert(allSummary.dayCount === 3, '总有效天数错误');
assert(
  Math.abs(allSummary.avgMs - (27 * 3600000 + 5 * 60000) / 3) < 1,
  '总日均错误'
);

const existing = {
  '2026-08-06': { date: '2026-08-06', status: 'ok', workMs: 1, updatedAt: 10 }
};
const incoming = {
  '2026-08-06': { date: '2026-08-06', status: 'ok', workMs: 2, updatedAt: 20 },
  '2026-08-07': { date: '2026-08-07', status: 'ok', workMs: 3, updatedAt: 1 }
};
const merged = MokaHours.mergeRecords(existing, incoming);
assert(merged.added === 1 && merged.updated === 1, '合并计数错误');
assert(merged.merged['2026-08-06'].workMs === 2, '应采用较新记录');

const exportPayload = MokaHours.buildExportPayload(existing);
assert(exportPayload.app === 'moka-attendance-extension', '导出包装错误');
const parsed = MokaHours.parseImportPayload(JSON.stringify(exportPayload));
assert(parsed['2026-08-06'].workMs === 1, '导入解析错误');

const cal = MokaHours.buildMonthCalendar('2026-08', {
  '2026-08-06': { date: '2026-08-06', status: 'ok', workMs: 10.1 * 3600000 }
});
assert(cal.length % 7 === 0, '日历格数应为 7 的倍数');
const day6 = cal.find((c) => c.date === '2026-08-06');
assert(day6 && day6.level === 'h-10', `8/6 等级应为 h-10，实际 ${day6 && day6.level}`);
assert(day6.emoji === '😐', `8/6 表情应为 😐，实际 ${day6.emoji}`);
assert(
  MokaHours.formatCalendarHours(day6.record) === '10.1',
  `日历工时格式错误: ${MokaHours.formatCalendarHours(day6.record)}`
);

const monthPayload = {
  code: 200,
  data: {
    year: 2026,
    month: 12,
    days: [
      { day: '2026-12-01', type: 1, fixedTimeRest: false, workDay: false },
      { day: '2026-12-05', type: 2, fixedTimeRest: true, workDay: false }
    ]
  }
};
assert(MokaHours.isMonthCalendarPayload(monthPayload), '应识别月历接口');
const extracted = MokaHours.extractDayMetaMap(monthPayload);
assert(extracted.days['2026-12-01'].isWorkDay, '12-01 应为工作日');
assert(extracted.days['2026-12-05'].isRestDay, '12-05 应为休息日');

const restStyle = MokaHours.calendarStyle(
  { status: 'no_clock', workMs: null },
  extracted.days['2026-12-05'],
  '2026-12-05'
);
assert(restStyle.level === 'rest', '休息日无打卡应为 rest');

const h8 = MokaHours.calendarStyle(
  { status: 'ok', workMs: 8 * 3600000 },
  extracted.days['2026-12-01'],
  '2026-12-01'
);
assert(h8.level === 'h-8' && h8.emoji === '😊', '8h 应为绿色笑脸');

// type 可能是字符串 "2"
const stringTypePayload = {
  code: '200',
  data: {
    year: '2026',
    month: '12',
    days: [{ day: '2026-12-06', type: '2', fixedTimeRest: 'true', workDay: false }]
  }
};
assert(MokaHours.isMonthCalendarPayload(stringTypePayload), '应识别字符串 code/year 月历');
const extracted2 = MokaHours.extractDayMetaMap(stringTypePayload);
assert(extracted2.days['2026-12-06'].isRestDay, '字符串 type=2 应为休息日');

// 无月历时周末兜底（2026-12-05 周六、2026-12-06 周日、2026-12-07 周一）
assert(MokaHours.resolveIsRestDay('2026-12-05', null), '无元数据时周六应为休息日');
assert(MokaHours.resolveIsRestDay('2026-12-06', null), '无元数据时周日应为休息日');
assert(!MokaHours.resolveIsRestDay('2026-12-07', null), '无元数据时周一不应为休息日');
// 周日调休上班：月历 type=1 优先于周末
assert(
  !MokaHours.resolveIsRestDay('2026-12-06', {
    isRestDay: false,
    isWorkDay: true,
    type: 1
  }),
  '月历标记工作日时周末也应算工作日'
);

const normalized = MokaHours.normalizeRestRecords(
  {
    '2026-12-05': { date: '2026-12-05', status: 'no_clock', workMs: null },
    '2026-12-01': { date: '2026-12-01', status: 'no_clock', workMs: null }
  },
  extracted.days
);
assert(normalized.changed === 1, '应只纠偏休息日无打卡');
assert(normalized.records['2026-12-05'].status === 'rest', '休息日应改为 rest');
assert(normalized.records['2026-12-01'].status === 'no_clock', '工作日无打卡保持');

assert(
  MokaHours.formatCalendarHours(
    { status: 'no_clock', workMs: null },
    extracted.days['2026-12-05'],
    '2026-12-05'
  ) === '',
  '休息日日历格不应显示「无打卡」'
);

console.log('All hours tests passed.');
