import test from 'node:test';
import assert from 'node:assert/strict';
import { DAYS, createDefaultSlots, generateTimetable, checkSchedule } from '../src/scheduler.js';

test('creates the eight teaching periods and fixed breaks', () => {
  const slots = createDefaultSlots();
  assert.deepEqual(slots.filter(s => s.teaching).map(s => s.period), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(slots.filter(s => !s.teaching).length, 3);
});

test('generates a schedule without teacher double booking or adjacent duplicates', () => {
  const model = {
    classes: ['AIDS', 'CSE'],
    teachers: {},
    settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] },
    subjects: [
      { id: 'a', className: 'AIDS', acronym: 'MATH', code: 'M1', name: 'Math', teacher: 'T1', theoryPeriods: 4, labPeriods: 0 },
      { id: 'b', className: 'CSE', acronym: 'OS', code: 'O1', name: 'OS', teacher: 'T1', theoryPeriods: 4, labPeriods: 0 }
    ],
    labs: []
  };
  const result = generateTimetable(model);
  assert.equal(result.diagnostics.filter(d => d.rule === 'R5' && d.severity === 'error').length, 0);
  for (const schedule of Object.values(result.schedules)) {
    assert.equal(checkSchedule(schedule, model).filter(d => d.severity === 'error').length, 0);
  }
});

test('keeps fixed labs consecutive and outside break slots', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'LAB', code: 'L1', name: 'Lab', teacher: 'T1', theoryPeriods: 0, labPeriods: 2 }],
    labs: [{ subjectId: 'a', className: 'AIDS', day: 'MON', startPeriod: 5, length: 2 }]
  };
  const result = generateTimetable(model);
  const cells = result.schedules.AIDS.MON.filter(c => c?.kind === 'lab');
  assert.equal(cells.length, 2);
  assert.deepEqual(cells.map(c => c.period), [4, 5]);
  assert.equal(result.diagnostics.filter(d => d.rule === 'R16' && d.severity === 'error').length, 0);
});

test('allows R2a fallback repeats only when weekly demand exceeds available days', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'LAB', code: 'L1', name: 'Theory', teacher: 'T1', theoryPeriods: 7, labPeriods: 0 }], labs: []
  };
  const result = generateTimetable(model);
  assert.equal(result.diagnostics.some(d => d.rule === 'R2a' && d.severity === 'warning'), true);
  assert.equal(result.diagnostics.some(d => d.rule === 'R4' && d.severity === 'error'), false);
});

test('permits exactly one R12 theory repeat on an externally fixed lab day', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'DB', code: 'D1', name: 'Database', teacher: 'T1', theoryPeriods: 7, labPeriods: 2 }],
    labs: [{ subjectId: 'a', className: 'AIDS', day: 'MON', startPeriod: 5, length: 2 }]
  };
  const result = generateTimetable(model);
  const mondayTheory = result.schedules.AIDS.MON.filter(c => c?.subjectId === 'a' && c.kind === 'theory');
  assert.equal(mondayTheory.length <= 1, true);
  assert.equal(result.diagnostics.some(d => d.rule === 'R4' && d.severity === 'error'), false);
});

test('respects unavailable teacher periods', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] },
    teachers: { T1: { name: 'T1', unavailable: [{ day: 'MON', period: 0 }], externalHours: {} } },
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'DB', code: 'D1', name: 'Database', teacher: 'T1', theoryPeriods: 1, labPeriods: 0 }], labs: []
  };
  const result = generateTimetable(model);
  assert.notEqual(result.schedules.AIDS.MON[0]?.subjectId, 'a');
  assert.equal(result.diagnostics.some(d => d.rule === 'R17' && d.severity === 'error'), false);
});

test('reserves different first-period subjects across the six days', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: Array.from({ length: 6 }, (_, index) => ({ id: `s${index}`, className: 'AIDS', acronym: `S${index + 1}`, code: `C${index + 1}`, name: `Subject ${index + 1}`, teacher: `T${index + 1}`, theoryPeriods: 2, labPeriods: 0 })), labs: []
  };
  const result = generateTimetable(model);
  const firstPeriodSubjects = model.settings.days.map(day => result.schedules.AIDS[day][0]?.subjectId);
  assert.equal(new Set(firstPeriodSubjects).size, 6);
  assert.deepEqual(new Set(firstPeriodSubjects), new Set(['s0', 's1', 's2', 's3', 's4', 's5']));
});

test('keeps auto lab blocks away from the six distinct theory first-hour slots', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [...Array.from({ length: 6 }, (_, index) => ({ id: `s${index}`, className: 'AIDS', acronym: `S${index + 1}`, code: `C${index + 1}`, name: `Subject ${index + 1}`, teacher: `T${index + 1}`, theoryPeriods: 2, labPeriods: index < 3 ? 2 : 0 })), { id: 'lab-only', className: 'AIDS', acronym: 'LB', code: 'LB1', name: 'Lab Only', teacher: 'TLB', theoryPeriods: 0, labPeriods: 2 }],
    labs: [{ subjectId: 's0', className: 'AIDS', labPeriods: 2 }, { subjectId: 's1', className: 'AIDS', labPeriods: 2 }, { subjectId: 's2', className: 'AIDS', labPeriods: 2 }, { subjectId: 'lab-only', className: 'AIDS', labPeriods: 2 }]
  };
  const result = generateTimetable(model);
  assert.equal(new Set(model.settings.days.map(day => result.schedules.AIDS[day][0]?.subjectId)).size, 6);
  assert.equal(model.settings.days.every(day => result.schedules.AIDS[day][0]?.kind === 'theory'), true);
});

test('reports unallocated capacity instead of inserting synthetic ACT cells', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [{ id: 's1', className: 'AIDS', acronym: 'M', code: 'M1', name: 'Math', teacher: 'T1', theoryPeriods: 2, labPeriods: 0 }], labs: []
  };
  const result = generateTimetable(model);
  const filled = model.settings.days.flatMap(day => result.schedules.AIDS[day]).filter(Boolean).length;
  assert.equal(filled, 6);
  assert.equal(result.schedules.AIDS.MON.some(cell => cell?.acronym === 'ACT'), false);
  assert.equal(result.diagnostics.some(d => d.rule === 'CAPACITY' && d.severity === 'error'), true);
});

test('applies HOD and CC first-hour rules independently for each class', () => {
  const model = {
    classes: ['AIDS', 'CSE'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] },
    teachers: { T1: { name: 'T1', unavailable: [], externalHours: {}, hodFor: ['AIDS'], ccFor: [] } },
    subjects: [
      { id: 'a', className: 'AIDS', acronym: 'A', code: 'A1', name: 'AIDS Subject', teacher: 'T1', theoryPeriods: 2, labPeriods: 0 },
      { id: 'c', className: 'CSE', acronym: 'C', code: 'C1', name: 'CSE Subject', teacher: 'T1', theoryPeriods: 2, labPeriods: 0 }
    ], labs: []
  };
  const result = generateTimetable(model);
  assert.equal(DAYS.some(day => result.schedules.AIDS[day][0]?.teacher === 'T1'), false);
  assert.equal(DAYS.some(day => result.schedules.CSE[day][0]?.teacher === 'T1'), true);
});

test('places extracurricular hours together on exactly one day', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [
      { id: 'club', className: 'AIDS', acronym: 'CLUB', code: 'EC1', name: 'Club Activity', teacher: 'T1', theoryPeriods: 3, labPeriods: 0, isExtracurricular: true },
      { id: 'math', className: 'AIDS', acronym: 'MATH', code: 'M1', name: 'Math', teacher: 'T2', theoryPeriods: 2, labPeriods: 0 }
    ], labs: []
  };
  const result = generateTimetable(model);
  const placements = model.settings.days.flatMap(day => result.schedules.AIDS[day].filter(cell => cell?.subjectId === 'club').map(cell => ({ day, period: cell.period, kind: cell.kind })));
  assert.equal(new Set(placements.map(item => item.day)).size, 1);
  assert.deepEqual(placements.map(item => item.period), [2, 3, 4]);
  assert.equal(placements.every(item => item.period >= 2), true);
  assert.equal(placements.every(item => item.kind === 'activity'), true);
  assert.equal(result.diagnostics.some(item => item.rule === 'R3' && item.subjectId === 'club'), false);
});

test('fills spare capacity with balanced theory subjects and keeps first periods unique', () => {
  const subjects = Array.from({ length: 8 }, (_, index) => ({ id: `s${index}`, className: 'AIDS', acronym: `S${index}`, code: `C${index}`, name: `Subject ${index}`, teacher: `T${index}`, theoryPeriods: 5, labPeriods: 0 }));
  const model = { classes: ['AIDS'], settings: { scheduleSeed: 42 }, teachers: {}, subjects, labs: [] };
  const result = generateTimetable(model);
  const schedule = result.schedules.AIDS;
  assert.equal(DAYS.flatMap(day => schedule[day]).filter(Boolean).length, 48);
  assert.equal(new Set(DAYS.map(day => schedule[day][0].subjectId)).size, 6);
  const counts = subjects.map(subject => DAYS.flatMap(day => schedule[day]).filter(cell => cell?.subjectId === subject.id).length);
  assert.equal(Math.max(...counts) - Math.min(...counts) <= 1, true);
  assert.equal(result.diagnostics.some(item => item.rule === 'CAPACITY'), false);
});

test('uses the schedule seed to produce different balanced layouts', () => {
  const subjects = Array.from({ length: 8 }, (_, index) => ({ id: `s${index}`, className: 'AIDS', acronym: `S${index}`, code: `C${index}`, name: `Subject ${index}`, teacher: `T${index}`, theoryPeriods: 5, labPeriods: 0 }));
  const first = generateTimetable({ classes: ['AIDS'], settings: { scheduleSeed: 1 }, teachers: {}, subjects, labs: [] });
  const second = generateTimetable({ classes: ['AIDS'], settings: { scheduleSeed: 2 }, teachers: {}, subjects, labs: [] });
  const signature = result => DAYS.map(day => result.schedules.AIDS[day].map(cell => cell?.subjectId).join(',')).join('|');
  assert.notEqual(signature(first), signature(second));
});

test('auto-places an unfixed lab as a continuous teaching block', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [{ id: 'lab', className: 'AIDS', acronym: 'LB', code: 'L1', name: 'Programming Lab', teacher: 'T1', theoryPeriods: 0, labPeriods: 2 }], labs: [{ subjectId: 'lab', className: 'AIDS', labPeriods: 2 }]
  };
  const result = generateTimetable(model);
  const labCells = result.schedules.AIDS.MON.concat(result.schedules.AIDS.TUE, result.schedules.AIDS.WED, result.schedules.AIDS.THU, result.schedules.AIDS.FRI, result.schedules.AIDS.SAT).filter(c => c?.kind === 'lab');
  assert.equal(labCells.length, 2);
  assert.equal(Math.abs(labCells[0].period - labCells[1].period), 1);
});

test('keeps an input-declared lab day when the start period is not supplied', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [{ id: 'lab', className: 'AIDS', acronym: 'LB', code: 'L1', name: 'Programming Lab', teacher: 'T1', theoryPeriods: 0, labPeriods: 2 }],
    labs: [{ subjectId: 'lab', className: 'AIDS', day: 'TUE', labPeriods: 2 }]
  };
  const result = generateTimetable(model);
  assert.equal(result.schedules.AIDS.MON.filter(cell => cell?.kind === 'lab').length, 0);
  const periods = result.schedules.AIDS.TUE.filter(cell => cell?.kind === 'lab').map(cell => cell.period);
  assert.equal(periods.length, 2);
  assert.equal(periods[1] - periods[0], 1);
});
