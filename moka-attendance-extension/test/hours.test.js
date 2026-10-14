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

console.log('All hours tests passed.');
