export const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const SLOT_DEFS = [
  { period: 0, label: '09.05–10.00', teaching: true }, { period: 1, label: '10.00–11.00', teaching: true },
  { period: null, label: 'BREAK', teaching: false }, { period: 2, label: '11.15–12.15', teaching: true },
  { period: 3, label: '12.15–01.00', teaching: true }, { period: null, label: 'LUNCH BREAK', teaching: false },
  { period: 4, label: '01.40–02.20', teaching: true }, { period: 5, label: '02.20–03.00', teaching: true },
  { period: null, label: 'BREAK', teaching: false }, { period: 6, label: '03.10–03.50', teaching: true },
  { period: 7, label: '03.50–04.30', teaching: true }
];

export function createDefaultSlots() { return SLOT_DEFS.map((slot, index) => ({ ...slot, index })); }
const emptyWeek = () => Object.fromEntries(DAYS.map(day => [day, Array(8).fill(null)]));
const teacherName = subject => subject.teacher.split(/[,;]/)[0].trim();
const teacherRecord = (model, teacher) => model.teachers?.[teacher] || Object.values(model.teachers || {}).find(record => record.name === teacher || record.name?.startsWith(teacher)) || {};
const externalHours = (model, teacher, day) => Number(teacherRecord(model, teacher).externalHours?.[day] || 0);
const unavailable = (model, teacher, day, period) => (teacherRecord(model, teacher).unavailable || []).some(x => x.day === day && x.period === period);
const fixedLabDays = (model, subjectId) => new Set((model.labs || []).filter(lab => lab.subjectId === subjectId && lab.day).map(lab => lab.day));

export function checkSchedule(schedule, model) {
  const diagnostics = [];
  for (const day of DAYS) {
    const cells = schedule[day] || [];
    const seen = new Map();
    for (const cell of cells.filter(Boolean)) {
      const record = teacherRecord(model, cell.teacher);
      if (cell.period === 0 && (record.isHod || record.ccFor?.includes(schedule.className))) diagnostics.push({ rule: record.isHod ? 'R1' : 'R11', severity: 'error', day, period: 1, message: `${cell.teacher} cannot teach Period 1 for this class.` });
      if (unavailable(model, cell.teacher, day, cell.period)) diagnostics.push({ rule: 'R17', severity: 'error', day, period: cell.period + 1, message: `${cell.teacher} is unavailable.` });
      if (cell.kind === 'activity' && cell.period < 2) diagnostics.push({ rule: 'R19', severity: 'error', day, period: cell.period + 1, subjectId: cell.subjectId, message: 'Extracurricular subjects cannot be scheduled in Period 1 or Period 2.' });
      if (cell.kind === 'theory') seen.set(cell.subjectId, (seen.get(cell.subjectId) || 0) + 1);
    }
    for (const [subjectId, count] of seen) {
      const subject = model.subjects.find(item => item.id === subjectId);
      const labDay = fixedLabDays(model, subjectId).has(day);
      const fallback = subject && subject.theoryPeriods > DAYS.length;
      if (count > 1 && !fallback && !labDay) diagnostics.push({ rule: 'R2', severity: 'error', day, subjectId, message: 'Theory subject appears more than once on this day.' });
      if (count > 1 && fallback) diagnostics.push({ rule: 'R2a', severity: 'warning', day, subjectId, message: 'Subject repeats under the weekly-shortfall fallback.' });
      if (count > 1 && labDay) diagnostics.push({ rule: 'R12', severity: 'warning', day, subjectId, message: 'One same-day theory repeat is permitted because the subject has an externally fixed lab.' });
    }
    for (let i = 1; i < cells.length; i++) if (cells[i]?.kind === 'theory' && cells[i - 1]?.kind === 'theory' && cells[i].subjectId === cells[i - 1].subjectId) diagnostics.push({ rule: 'R3', severity: 'error', day, period: cells[i].period + 1, message: 'Same theory subject is scheduled in adjacent periods.' });
  }
  return diagnostics;
}

export function generateTimetable(model) {
  const schedules = Object.fromEntries(model.classes.map(className => { const week = emptyWeek(); week.className = className; return [className, week]; }));
  const diagnostics = [];
  const teacherBusy = new Map();
  const teacherDailyHours = new Map();
  const subjectsById = new Map(model.subjects.map(s => [s.id, s]));
  const placedCounts = new Map();
  const firstHourSubjects = model.subjects.filter(subject => subject.theoryPeriods > 0 && !subject.isExtracurricular).slice(0, DAYS.length);
  const firstHourIds = new Set(firstHourSubjects.map(subject => subject.id));
  const put = (subject, day, period, kind = 'theory') => {
    const schedule = schedules[subject.className];
    if (!schedule || schedule[day][period]) return false;
    const teacher = teacherName(subject);
    const busyKey = `${day}-${period}`;
    if (teacherBusy.get(busyKey)?.has(teacher)) return false;
    if (unavailable(model, teacher, day, period)) return false;
    const record = teacherRecord(model, teacher);
    if (period === 0 && (record.isHod || record.ccFor?.includes(subject.className))) return false;
    const dayCells = schedule[day];
    const subjectTheoryCount = dayCells.filter(c => c?.subjectId === subject.id && c.kind === 'theory').length;
    const repeatsAllowed = subject.theoryPeriods > DAYS.length || fixedLabDays(model, subject.id).has(day);
    const dailyTheoryCap = fixedLabDays(model, subject.id).has(day) ? 1 : (subject.theoryPeriods > DAYS.length ? 2 : 1);
    if (kind === 'theory' && subjectTheoryCount >= dailyTheoryCap) return false;
    if (kind === 'theory' && period > 0 && dayCells[period - 1]?.subjectId === subject.id) return false;
    const teacherHoursKey = `${teacher}-${day}`;
    const teacherHours = teacherDailyHours.get(teacherHoursKey) || 0;
    if (kind === 'theory' && teacherHours + externalHours(model, teacher, day) >= 5) return false;
    const cell = { subjectId: subject.id, subjectCode: subject.code, acronym: subject.acronym, subjectName: subject.name, teacher, period, kind, lab: kind === 'lab' };
    dayCells[period] = cell;
    if (!teacherBusy.has(busyKey)) teacherBusy.set(busyKey, new Set());
    teacherBusy.get(busyKey).add(teacher);
    if (kind === 'theory') teacherDailyHours.set(teacherHoursKey, teacherHours + 1);
    return true;
  };
  const remove = (schedule, day, period) => {
    const cell = schedule[day]?.[period];
    if (!cell) return null;
    schedule[day][period] = null;
    const busyKey = `${day}-${period}`;
    const busy = teacherBusy.get(busyKey);
    busy?.delete(cell.teacher);
    if (busy?.size === 0) teacherBusy.delete(busyKey);
    if (cell.kind === 'theory') {
      const key = `${cell.teacher}-${day}`;
      const hours = teacherDailyHours.get(key) || 0;
      if (hours <= 1) teacherDailyHours.delete(key); else teacherDailyHours.set(key, hours - 1);
    }
    return { schedule, cell };
  };
  for (const lab of model.labs || []) {
    const spec = model.labs.find(x => x.subjectId === lab.subjectId && x.startPeriod != null) || lab;
    if (spec.day && spec.startPeriod != null) {
      for (let offset = 0; offset < (spec.length || lab.labPeriods || 2); offset++) {
        if (!put(subjectsById.get(lab.subjectId) || lab, spec.day, spec.startPeriod + offset - 1, 'lab')) diagnostics.push({ rule: 'R16', severity: 'error', message: 'Fixed lab block could not be placed consecutively.', subjectId: lab.subjectId });
      }
    } else {
      const subject = subjectsById.get(lab.subjectId) || lab;
      const length = spec.length || lab.labPeriods || subject.labPeriods || 2;
      const protectFirstHour = firstHourSubjects.length >= DAYS.length;
      const starts = length === 2
        ? (protectFirstHour || firstHourIds.has(subject.id) ? [2, 4, 6] : [0, 2, 4, 6])
        : [...Array(8 - length + 1).keys()].filter(start => !protectFirstHour && !firstHourIds.has(subject.id) || start > 0);
      let placed = false;
      const candidateDays = spec.day ? [spec.day] : DAYS;
      for (const day of candidateDays) {
        for (const start of starts) {
          const candidate = [...Array(length).keys()].map(offset => start + offset);
          const teacher = teacherName(subject);
          const available = candidate.every(period => !schedules[subject.className]?.[day][period] && !unavailable(model, teacher, day, period) && !teacherBusy.get(`${day}-${period}`)?.has(teacher));
          if (!available) continue;
          candidate.forEach(period => put(subject, day, period, 'lab'));
          placed = true;
          break;
        }
        if (placed) break;
      }
      if (!placed) diagnostics.push({ rule: 'R16', severity: 'error', message: 'Lab block could not be placed as a continuous block.', subjectId: lab.subjectId });
    }
  }
  const extracurricular = model.subjects.filter(subject => subject.theoryPeriods > 0 && subject.isExtracurricular);
  for (const subject of extracurricular) {
    const length = subject.theoryPeriods;
    let placed = false;
    for (const day of DAYS) {
      for (let start = 2; start <= 8 - length; start++) {
        const periods = Array.from({ length }, (_, offset) => start + offset);
        const teacher = teacherName(subject);
        const record = teacherRecord(model, teacher);
        const available = periods.every(period =>
          !schedules[subject.className]?.[day][period] &&
          !unavailable(model, teacher, day, period) &&
          !teacherBusy.get(`${day}-${period}`)?.has(teacher) &&
          !(period === 0 && (record.isHod || record.ccFor?.includes(subject.className)))
        );
        if (!available) continue;
        periods.forEach(period => put(subject, day, period, 'activity'));
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) diagnostics.push({ rule: 'R18', severity: 'error', subjectId: subject.id, message: `${subject.name} could not be placed as one continuous extracurricular block.` });
  }
  firstHourSubjects.forEach((subject, index) => {
    if (put(subject, DAYS[index], 0)) placedCounts.set(subject.id, 1);
    else diagnostics.push({ rule: 'R9', severity: 'warning', subjectId: subject.id, day: DAYS[index], period: 1, message: 'Top-six first-hour preference could not be placed because of a hard constraint.' });
  });
  const theory = model.subjects.filter(s => s.theoryPeriods > 0 && !s.isExtracurricular).sort((a, b) => b.theoryPeriods - a.theoryPeriods);
  for (const subject of theory) {
    let placed = placedCounts.get(subject.id) || 0;
    for (let pass = 0; pass < 2 && placed < subject.theoryPeriods; pass++) {
      for (const day of DAYS) {
        const preferred = [...Array(8).keys()].sort((a, b) => pass === 0 ? a - b : Math.abs(a - 3.5) - Math.abs(b - 3.5));
        for (const period of preferred) {
          if (put(subject, day, period)) { placed++; placedCounts.set(subject.id, placed); break; }
        }
        if (placed >= subject.theoryPeriods) break;
      }
    }
    if (subject.theoryPeriods > DAYS.length) diagnostics.push({ rule: 'R2a', severity: 'warning', subjectId: subject.id, message: 'Weekly requirement exceeds available days; fallback repeat was used or required.' });
  }
  // Repair one or more remaining theory periods by swapping a movable theory cell
  // into an empty slot. This keeps exact workload without inserting synthetic ACT cells.
  for (const target of theory) {
    let remaining = target.theoryPeriods - DAYS.reduce((total, day) => total + schedules[target.className][day].filter(cell => cell?.subjectId === target.id && cell.kind === 'theory').length, 0);
    while (remaining > 0) {
      let repaired = false;
      const empties = [];
      for (const day of DAYS) for (let period = 0; period < 8; period++) if (!schedules[target.className][day][period]) empties.push([day, period]);
      for (const [emptyDay, emptyPeriod] of empties) {
        if (put(target, emptyDay, emptyPeriod)) { remaining -= 1; repaired = true; break; }
        for (const sourceSchedule of Object.values(schedules)) {
          if (repaired) break;
          for (const sourceDay of DAYS) {
            if (repaired) break;
            for (let sourcePeriod = 1; sourcePeriod < 8; sourcePeriod++) {
              const source = sourceSchedule[sourceDay][sourcePeriod];
              const sourceSubject = source && subjectsById.get(source.subjectId);
              if (!sourceSubject || source.kind !== 'theory' || source.subjectId === target.id) continue;
              const sourceClass = sourceSchedule.className;
              const removed = remove(sourceSchedule, sourceDay, sourcePeriod);
              if (!removed) continue;
              const moved = put(sourceSubject, emptyDay, emptyPeriod);
              const filled = moved && put(target, sourceDay, sourcePeriod);
              if (filled) { remaining -= 1; repaired = true; break; }
              if (moved) remove(schedules[sourceSubject.className], emptyDay, emptyPeriod);
              put(sourceSubject, sourceDay, sourcePeriod);
            }
          }
        }
        if (repaired) break;
      }
      if (!repaired) break;
    }
  }
  for (const subject of theory) {
    const placed = DAYS.reduce((total, day) => total + schedules[subject.className][day].filter(cell => cell?.subjectId === subject.id && cell.kind === 'theory').length, 0);
    if (placed < subject.theoryPeriods) diagnostics.push({ rule: 'R4', severity: 'error', subjectId: subject.id, message: `${subject.name} has ${subject.theoryPeriods - placed} unresolved weekly period(s).` });
    const p1 = DAYS.some(day => schedules[subject.className][day].some(c => c?.subjectId === subject.id && c.period === 0));
    if (!p1) diagnostics.push({ rule: 'R9', severity: 'warning', subjectId: subject.id, message: 'Subject did not receive a Period-1 slot.' });
  }
  for (const schedule of Object.values(schedules)) {
    diagnostics.push(...checkSchedule(schedule, model));
    const filled = DAYS.reduce((total, day) => total + schedule[day].filter(Boolean).length, 0);
    const unallocated = DAYS.length * 8 - filled;
    if (unallocated > 0) diagnostics.push({ rule: 'CAPACITY', severity: 'error', className: schedule.className, message: `${unallocated} teaching slot(s) remain unallocated for ${schedule.className}. Add valid workload or adjust constraints.` });
    for (const day of DAYS) for (const cell of schedule[day].filter(Boolean)) {
      if (cell.kind === 'theory' && fixedLabDays(model, cell.subjectId).has(day)) diagnostics.push({ rule: 'R12', severity: 'warning', day, period: cell.period + 1, subjectId: cell.subjectId, message: 'Theory placement shares a day with the subject lab under the R12 exception.' });
    }
  }
  return { schedules, diagnostics };
}
