import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTeacherTimetable, renderLabTimetable } from '../src/ui.js';

test('renders working teacher and lab timetable views', () => {
  const model = { classes: ['AIDS'], teachers: { T1: { name: 'Teacher One', initials: 'TO' } }, subjects: [{ id: 'lab', className: 'AIDS', acronym: 'LB', code: 'L1', name: 'Lab', teacher: 'Teacher One', labPeriods: 2 }] };
  const schedule = { className: 'AIDS', MON: Array(8).fill(null), TUE: Array(8).fill(null), WED: Array(8).fill(null), THU: Array(8).fill(null), FRI: Array(8).fill(null), SAT: Array(8).fill(null) };
  schedule.MON[2] = { subjectId: 'lab', acronym: 'LB', kind: 'lab', teacher: 'Teacher One', period: 2 };
  schedule.MON[3] = { subjectId: 'lab', acronym: 'LB', kind: 'lab', teacher: 'Teacher One', period: 3 };
  const result = { schedules: { AIDS: schedule } };
  assert.match(renderTeacherTimetable(result, model), /Faculty allocation across all classes/);
  assert.match(renderLabTimetable(result, model, 'AIDS'), /LB P3–P4/);
});
