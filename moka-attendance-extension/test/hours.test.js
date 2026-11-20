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

console.log('All hours tests passed.');
