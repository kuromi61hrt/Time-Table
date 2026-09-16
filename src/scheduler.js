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
const isHodFor = (record, className) => record.hodFor?.includes(className) || record.isHod === true;
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
      if (cell.period === 0 && (isHodFor(record, schedule.className) || record.ccFor?.includes(schedule.className))) diagnostics.push({ rule: isHodFor(record, schedule.className) ? 'R1' : 'R11', severity: 'error', day, period: 1, message: `${cell.teacher} cannot teach Period 1 for this class.` });
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
  const firstPeriodSubjects = DAYS.map(day => schedule[day]?.[0]?.subjectId).filter(Boolean);
  const repeatedFirstPeriod = firstPeriodSubjects.find((subjectId, index) => firstPeriodSubjects.indexOf(subjectId) !== index);
  if (repeatedFirstPeriod) diagnostics.push({ rule: 'R20', severity: 'error', subjectId: repeatedFirstPeriod, message: 'The same subject cannot occupy Period 1 on more than one day.' });
  return diagnostics;
}

export function generateTimetable(model) {
  const schedules = Object.fromEntries(model.classes.map(className => { const week = emptyWeek(); week.className = className; return [className, week]; }));
  const diagnostics = [];
  const teacherBusy = new Map();
  const teacherDailyHours = new Map();
  const subjectsById = new Map(model.subjects.map(subject => [subject.id, subject]));
  const placedCounts = new Map();
  const seedText = String(model.settings?.scheduleSeed ?? model.subjects.map(subject => subject.id).join('|'));
  let seed = [...seedText].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const random = () => { seed += 0x6D2B79F5; let value = seed; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
  const shuffle = values => { const copy = [...values]; for (let index = copy.length - 1; index > 0; index--) { const target = Math.floor(random() * (index + 1)); [copy[index], copy[target]] = [copy[target], copy[index]]; } return copy; };
  const theoryCount = subjectId => placedCounts.get(subjectId) || 0;
  const put = (subject, day, period, kind = 'theory') => {
    const schedule = schedules[subject.className];
    if (!schedule || schedule[day][period]) return false;
    const teacher = teacherName(subject);
    const busyKey = `${day}-${period}`;
    if (teacherBusy.get(busyKey)?.has(teacher) || unavailable(model, teacher, day, period)) return false;
    const record = teacherRecord(model, teacher);
    if (period === 0 && (isHodFor(record, subject.className) || record.ccFor?.includes(subject.className))) return false;
    if (kind === 'activity' && period < 2) return false;
    const dayCells = schedule[day];
    if (kind === 'theory') {
      const sameDay = dayCells.filter(cell => cell?.subjectId === subject.id && cell.kind === 'theory').length;
      const dailyCap = fixedLabDays(model, subject.id).has(day) ? 1 : (subject.theoryPeriods > DAYS.length ? 2 : 1);
      if (sameDay >= dailyCap) return false;
      if (dayCells[period - 1]?.subjectId === subject.id || dayCells[period + 1]?.subjectId === subject.id) return false;
      if (period === 0 && DAYS.some(otherDay => otherDay !== day && schedule[otherDay][0]?.subjectId === subject.id)) return false;
      const teacherHoursKey = `${teacher}-${day}`;
      const teacherHours = teacherDailyHours.get(teacherHoursKey) || 0;
      if (teacherHours + externalHours(model, teacher, day) >= 5) return false;
      teacherDailyHours.set(teacherHoursKey, teacherHours + 1);
      placedCounts.set(subject.id, theoryCount(subject.id) + 1);
    }
    dayCells[period] = { subjectId: subject.id, subjectCode: subject.code, acronym: subject.acronym, subjectName: subject.name, teacher, period, kind, lab: kind === 'lab' };
    if (!teacherBusy.has(busyKey)) teacherBusy.set(busyKey, new Set());
    teacherBusy.get(busyKey).add(teacher);
    return true;
  };

  for (const lab of shuffle(model.labs || [])) {
    const subject = subjectsById.get(lab.subjectId) || lab;
    const length = lab.length || lab.labPeriods || subject.labPeriods || 2;
    const fixedStart = lab.startPeriod != null ? Number(lab.startPeriod) - 1 : null;
    const automaticStarts = length === 2 ? [2, 4, 6] : [...Array(8 - length + 1).keys()].filter(start => start > 0);
    const starts = fixedStart != null ? [fixedStart] : shuffle(automaticStarts);
    const days = lab.day ? [lab.day] : shuffle(DAYS);
    let placed = false;
    for (const day of days) {
      for (const start of starts) {
        const periods = Array.from({ length }, (_, offset) => start + offset);
        const teacher = teacherName(subject);
        if (!periods.every(period => period < 8 && !schedules[subject.className]?.[day][period] && !unavailable(model, teacher, day, period) && !teacherBusy.get(`${day}-${period}`)?.has(teacher))) continue;
        periods.forEach(period => put(subject, day, period, 'lab'));
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) diagnostics.push({ rule: 'R16', severity: 'error', message: 'Lab block could not be placed as a continuous block.', subjectId: lab.subjectId });
  }

  const extracurricular = shuffle(model.subjects.filter(subject => subject.theoryPeriods > 0 && subject.isExtracurricular));
  for (const subject of extracurricular) {
    const length = subject.theoryPeriods;
    let placed = false;
    for (const day of shuffle(DAYS)) {
      for (const start of shuffle(Array.from({ length: Math.max(0, 7 - length) }, (_, index) => index + 2))) {
        const periods = Array.from({ length }, (_, offset) => start + offset);
        const teacher = teacherName(subject);
        if (!periods.every(period => period < 8 && !schedules[subject.className]?.[day][period] && !unavailable(model, teacher, day, period) && !teacherBusy.get(`${day}-${period}`)?.has(teacher))) continue;
        periods.forEach(period => put(subject, day, period, 'activity'));
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) diagnostics.push({ rule: 'R18', severity: 'error', subjectId: subject.id, message: `${subject.name} could not be placed as one continuous extracurricular block.` });
  }

  const theory = model.subjects.filter(subject => subject.theoryPeriods > 0 && !subject.isExtracurricular);
  for (const className of shuffle(model.classes)) {
    const schedule = schedules[className];
    const candidates = shuffle(theory.filter(subject => subject.className === className));
    const used = new Set(DAYS.map(day => schedule[day][0]?.subjectId).filter(Boolean));
    for (const day of shuffle(DAYS.filter(day => !schedule[day][0]))) {
      const subject = candidates.find(candidate => !used.has(candidate.id) && put(candidate, day, 0));
      if (subject) used.add(subject.id);
      else diagnostics.push({ rule: 'R9', severity: 'error', className, day, period: 1, message: 'A unique eligible Period-1 subject could not be assigned.' });
    }
  }

  const orderedTheory = shuffle(theory).sort((left, right) => right.theoryPeriods - left.theoryPeriods || random() - 0.5);
  for (const subject of orderedTheory) {
    let attempts = 0;
    while (theoryCount(subject.id) < subject.theoryPeriods && attempts++ < 12) {
      const slots = shuffle(DAYS.flatMap(day => Array.from({ length: 8 }, (_, period) => [day, period])));
      const slot = slots.find(([day, period]) => put(subject, day, period));
      if (!slot) break;
    }
    if (theoryCount(subject.id) < subject.theoryPeriods) diagnostics.push({ rule: 'R4', severity: 'error', subjectId: subject.id, message: `${subject.name} has ${subject.theoryPeriods - theoryCount(subject.id)} unresolved weekly period(s).` });
  }

  for (const className of shuffle(model.classes)) {
    const schedule = schedules[className];
    const candidates = theory.filter(subject => subject.className === className);
    let progress = true;
    while (progress) {
      progress = false;
      const emptySlots = shuffle(DAYS.flatMap(day => Array.from({ length: 8 }, (_, period) => [day, period])).filter(([day, period]) => !schedule[day][period]));
      for (const [day, period] of emptySlots) {
        const balanced = shuffle(candidates).sort((left, right) => theoryCount(left.id) - theoryCount(right.id) || random() - 0.5);
        if (balanced.some(subject => put(subject, day, period))) progress = true;
      }
    }
  }

  for (const schedule of Object.values(schedules)) {
    diagnostics.push(...checkSchedule(schedule, model));
    const filled = DAYS.reduce((total, day) => total + schedule[day].filter(Boolean).length, 0);
    const unallocated = DAYS.length * 8 - filled;
    if (unallocated > 0) diagnostics.push({ rule: 'CAPACITY', severity: 'error', className: schedule.className, message: `${unallocated} teaching slot(s) remain unallocated for ${schedule.className} because no eligible subject satisfies all constraints.` });
  }
  return { schedules, diagnostics };
}
