import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExportDocument } from '../src/export.js';

test('builds the official single-page table structure with merged lab cells', () => {
  const schedule = { className: 'AIDS', MON: Array(8).fill(null), TUE: Array(8).fill(null), WED: Array(8).fill(null), THU: Array(8).fill(null), FRI: Array(8).fill(null), SAT: Array(8).fill(null) };
  schedule.MON[2] = { subjectId: 'lab', acronym: 'DDM', subjectCode: 'D1', teacher: 'Mr. Kannan', kind: 'lab' };
  schedule.MON[3] = { subjectId: 'lab', acronym: 'DDM', subjectCode: 'D1', teacher: 'Mr. Kannan', kind: 'lab' };
  const html = buildExportDocument(schedule, { metadata: {}, subjects: [{ className: 'AIDS', acronym: 'DDM', code: 'D1', name: 'Database Design', theoryPeriods: 4, labPeriods: 2, teacher: 'Mr. Kannan' }, { className: 'CSE', acronym: 'OS', code: 'O1', name: 'Operating Systems', theoryPeriods: 4, labPeriods: 0, teacher: 'Dr. Rao' }] });
  assert.match(html, /<col class="col-day">/);
  assert.match(html, /colspan="2" class="export-lab"/);
  assert.match(html, /rowspan="6" class="concept-cell/);
  assert.match(html, /rowspan="6" class="export-break/);
  assert.match(html, /TIME TABLE INCHARGE/);
  assert.doesNotMatch(html, /Operating Systems/);
});
