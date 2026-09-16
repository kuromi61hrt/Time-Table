import { DAYS, SLOT_DEFS } from './scheduler.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = name => String(name || '').split(/\s+/).map(part => part[0]).join('').slice(0, 3).toUpperCase();

export function buildExportDocument(schedule, model, template = 'class') {
  const metadata = model.metadata || {};
  const subjectRows = model.subjects.filter(subject => String(subject.className || '').trim() === String(schedule.className || '').trim());
  const timetableCols = `<colgroup><col class="col-day"><col class="col-concept">${SLOT_DEFS.map(slot => `<col class="${slot.teaching ? 'col-period' : 'col-break'}">`).join('')}</colgroup>`;
  const subjectCols = '<colgroup><col class="col-sno"><col class="col-acronym"><col class="col-code"><col class="col-name"><col class="col-workload"><col class="col-faculty"></colgroup>';
  const slotHeaders = `<th class="concept-col"><span>CONCEPT OF THE DAY<br>9.00 am to 9.05 am</span></th>${SLOT_DEFS.map(slot => slot.teaching ? `<th>${esc(slot.label).replace('–', '<br>to<br>')}</th>` : `<th class="export-break"><span>${esc(slot.label)}</span></th>`).join('')}`;
  const dayRows = DAYS.map((day, dayIndex) => {
    let cells = dayIndex === 0
      ? `<td rowspan="${DAYS.length}" class="concept-cell"><span>CONCEPT OF THE DAY<br>9.00 am to 9.05 am</span></td>`
      : '';
    for (let index = 0; index < SLOT_DEFS.length;) {
      const slot = SLOT_DEFS[index];
      if (!slot.teaching) {
        if (dayIndex === 0) cells += `<td rowspan="${DAYS.length}" class="export-break"><span>${esc(slot.label)}</span></td>`;
        index += 1;
        continue;
      }
      const cell = schedule[day][slot.period];
      let span = 1;
      if (cell?.kind === 'lab') {
        while (index + span < SLOT_DEFS.length && SLOT_DEFS[index + span].teaching) {
          const next = schedule[day][SLOT_DEFS[index + span].period];
          if (!next || next.kind !== 'lab' || next.subjectId !== cell.subjectId) break;
          span += 1;
        }
      }
      const label = cell ? `${esc(cell.acronym || cell.subjectCode)}${cell.kind === 'lab' ? ' LAB' : ''}` : '';
      cells += `<td${span > 1 ? ` colspan="${span}"` : ''} class="${cell?.kind === 'lab' ? 'export-lab' : ''}">${cell ? `<strong>${label}</strong><small>${esc(initials(cell.teacher))}</small>` : ''}</td>`;
      index += span;
    }
    return `<tr><th>${day}</th>${cells}</tr>`;
  }).join('');
  const subjectTable = subjectRows.map((subject, index) => `<tr><td>${index + 1}</td><td>${esc(subject.acronym)}</td><td>${esc(subject.code)}</td><td>${esc(subject.name)}</td><td>${subject.theoryPeriods}${subject.labPeriods ? `+${subject.labPeriods}` : ''}</td><td>${esc(subject.teacher)}</td></tr>`).join('');
  const title = template === 'teacher' ? 'INDIVIDUAL TIME TABLE' : template === 'lab' ? 'LAB TIME TABLE' : 'TIME TABLE';
  const teacher = template === 'teacher' ? (model.subjects.find(s => s.className === schedule.className)?.teacher || '') : '';
  return `<article class="pdf-page"><header class="pdf-header"><img src="/src/rpsit_logo.jpeg" alt="RPSIT logo"><div><h1>R P Sarathy</h1><h2>Institute of Technology</h2><p>An Autonomous Institution</p><small>Approved by AICTE | Accredited by NAAC with A+ | Affiliation in Anna University</small></div><strong>${title}</strong></header><section class="pdf-meta"><div><b>Document ID</b><span>${esc(metadata.documentId || `2026-27/ODD/RPSIT/${schedule.className}/TT/01`)}</span><b>Document Name</b><span>${esc(metadata.documentName || title)}</span></div><div><b>Programme</b><span>${esc(metadata.programme || schedule.className)}</span><b>Year / Sem</b><span>${esc(metadata.yearSem || '')}</span></div><div><b>Regulation</b><span>${esc(metadata.regulation || 'R-2024')}</span><b>Odd / Even</b><span>${esc(metadata.oddEven || 'ODD')}</span></div><div><b>Academic year</b><span>${esc(metadata.academicYear || '')}</span><b>W.e.f</b><span>${esc(metadata.effectiveDate || '')}</span></div><div class="pdf-advisor"><b>${template === 'teacher' ? 'Name of the Faculty' : 'Class Advisor'}</b><span>${esc(metadata.classAdvisor || teacher || 'Admin generated')}</span></div></section><table class="pdf-timetable">${timetableCols}<thead><tr><th>DAY /<br>HOURS</th>${slotHeaders}</tr></thead><tbody>${dayRows}</tbody></table><table class="pdf-subjects">${subjectCols}<thead><tr><th>S.<br>NO</th><th>Acronym</th><th>Subject<br>Code</th><th>Subject Name</th><th>Work<br>load</th><th>Faculty Members</th></tr></thead><tbody>${subjectTable}</tbody></table><footer class="pdf-footer"><span>TIME TABLE INCHARGE</span><span>HoD</span><span>PRINCIPAL</span></footer></article>`;
}

export function downloadPdf(schedule, model, template = 'class') {
  const frame = document.createElement('iframe');
  frame.className = 'print-frame';
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>RPSIT Timetable</title><link rel="stylesheet" href="/src/styles.css"></head><body class="print-body">${buildExportDocument(schedule, model, template)}<script>window.onload=()=>setTimeout(()=>window.print(),150)<\/script></body></html>`;
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 4000);
}
