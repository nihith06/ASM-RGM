import React from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBR = {
  Monday: 'MON',
  Tuesday: 'TUE',
  Wednesday: 'WED',
  Thursday: 'THU',
  Friday: 'FRI',
  Saturday: 'SAT'
};

const YEAR_1_SLOTS = {
  1: '09:00 - 09:50 AM',
  2: '09:50 - 10:40 AM',
  3: '11:00 - 11:50 AM',
  4: '01:00 - 01:50 PM',
  5: '01:50 - 02:40 PM',
  6: '03:00 - 03:50 PM',
  7: '04:00 - 04:50 PM'
};

const SENIOR_YEAR_SLOTS = {
  1: '09:00 - 09:50 AM',
  2: '09:50 - 10:40 AM',
  3: '11:00 - 11:50 AM',
  4: '11:50 - 12:40 PM',
  5: '01:50 - 02:40 PM',
  6: '02:40 - 03:30 PM',
  7: '03:30 - 04:20 PM'
};

export async function exportToOfficialPdf(elementId, filename = 'Timetable.pdf') {
  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error('PDF layout element not found.');
  }

  // Temporarily make element visible in memory for capture
  const originalDisplay = element.style.display;
  element.style.display = 'block';

  try {
    const canvas = await html2canvas(element, {
      scale: 2, // High DPI resolution
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff'
    });

    const imgData = canvas.toDataURL('image/png');
    // A4 Landscape dimensions: 297mm x 210mm
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const availWidth = pdfWidth - (margin * 2);
    const availHeight = pdfHeight - (margin * 2);

    const imgProps = pdf.getImageProperties(imgData);
    const imgRatio = imgProps.width / imgProps.height;
    
    let renderWidth = availWidth;
    let renderHeight = availWidth / imgRatio;

    if (renderHeight > availHeight) {
      renderHeight = availHeight;
      renderWidth = availHeight * imgRatio;
    }

    const posX = margin + (availWidth - renderWidth) / 2;
    const posY = margin + (availHeight - renderHeight) / 2;

    pdf.addImage(imgData, 'PNG', posX, posY, renderWidth, renderHeight);
    pdf.save(filename);
  } finally {
    element.style.display = originalDisplay;
  }
}

export default function OfficialPdfDocument({
  section,
  year,
  gridData = {},
  facultyDetails = [],
  user
}) {
  const secName = section?.name || 'Section A';
  const secLetter = secName.replace(/section\s*/i, '').trim().toUpperCase() || 'A';
  const semNum = section?.sem || (year === 1 ? 1 : year === 2 ? 1 : year === 3 ? 1 : 1);
  const acadYear = section?.academic_year || '2026-2027';
  const batchStr = section?.batch || (year === 1 ? '2026-2030' : year === 2 ? '2025-2029' : year === 3 ? '2024-2028' : '2023-2027');
  const effectiveDate = section?.effective_date || '15-07-2026';

  const romanYear = year === 1 ? 'I' : year === 2 ? 'II' : year === 3 ? 'III' : 'IV';
  const romanSem = semNum === 1 ? 'I' : 'II';

  // Helper to render period cells with adjacent period merging
  const renderPdfPeriodCells = (day, periodList) => {
    const dayCells = gridData[day] || {};
    const cells = [];
    let i = 0;

    while (i < periodList.length) {
      const p = periodList[i];
      const cell = dayCells[p] || { subject: '—', faculty_name: '—', room: '' };
      const hasSubject = cell.subject && cell.subject !== '—';

      let span = 1;
      if (hasSubject) {
        while (i + span < periodList.length) {
          const nextP = periodList[i + span];
          const nextCell = dayCells[nextP];
          if (
            nextCell &&
            nextCell.subject &&
            nextCell.subject !== '—' &&
            nextCell.subject.trim().toLowerCase() === cell.subject.trim().toLowerCase()
          ) {
            span++;
          } else {
            break;
          }
        }
      }

      cells.push(
        <td
          key={`slot-${day}-${p}`}
          colSpan={span}
          className="border border-slate-900 text-center py-2 px-1 text-[11px] align-middle font-medium"
        >
          {cell.subject && cell.subject !== '—' ? (
            <div>
              <div className="font-bold text-[11.5px] text-black leading-tight">
                {cell.subject}
              </div>
              {cell.faculty_name && cell.faculty_name !== '—' && (
                <div className="text-[10px] text-slate-700 italic mt-0.5">
                  ({cell.faculty_name})
                </div>
              )}
              {cell.room && (
                <div className="text-[9px] text-slate-500 font-semibold">
                  [{cell.room}]
                </div>
              )}
            </div>
          ) : (
            <span className="text-slate-400 font-normal">—</span>
          )}
        </td>
      );

      i += span;
    }

    return cells;
  };

  // Compile faculty details table (unique subjects with assigned faculty & phone)
  const isStudent = user?.role === 'student';
  const displayFacultyList = facultyDetails.length > 0 ? facultyDetails : [];

  return (
    <div
      id="official-pdf-export-container"
      style={{ display: 'none', width: '1120px', backgroundColor: '#ffffff', color: '#000000', padding: '24px' }}
      className="font-sans"
    >
      {/* 1. Header (Centered, replicates 1000131124.png) */}
      <div className="text-center border-b-2 border-slate-900 pb-3 mb-4">
        <div className="text-[13px] font-bold tracking-wider text-slate-800 uppercase">
          (AUTONOMOUS)
        </div>
        <h1 className="text-base font-black uppercase tracking-wide text-black mt-0.5">
          DEPARTMENT OF COMPUTER SCIENCE AND ENGINEERING & AI&ML
        </h1>
        <div className="text-[12.5px] font-extrabold uppercase tracking-wide text-black mt-1">
          TIME TABLE FOR: B.TECH - {romanYear} YEAR {romanSem}-SEM - {secLetter}-SECTION ({acadYear}) :: {batchStr} BATCH
        </div>
        <div className="text-[11px] font-semibold text-slate-700 mt-1">
          w.e.f: {effectiveDate}
        </div>
      </div>

      {/* 2. Main Grid: MON-SAT x Periods with Vertically Merged BREAK and LUNCH */}
      <div className="mb-5">
        <table className="w-full border-collapse border-2 border-slate-900 text-xs">
          <thead>
            {year === 1 ? (
              /* Year 1 Table Header */
              <tr className="bg-slate-100 text-slate-900 font-bold text-center border-b-2 border-slate-900">
                <th className="border border-slate-900 py-2 px-1 w-20 text-[10px] font-black uppercase">
                  Day / Hour & Timing
                </th>

                {/* Hours 1 & 2 */}
                <th className="border border-slate-900 py-1.5 px-1 w-24">
                  <div className="font-bold text-[11px]">Hour 1</div>
                  <div className="text-[9px] font-normal text-slate-600">{YEAR_1_SLOTS[1]}</div>
                </th>
                <th className="border border-slate-900 py-1.5 px-1 w-24">
                  <div className="font-bold text-[11px]">Hour 2</div>
                  <div className="text-[9px] font-normal text-slate-600">{YEAR_1_SLOTS[2]}</div>
                </th>

                {/* Morning Break */}
                <th className="border border-slate-900 py-1.5 px-1 w-9 text-[9.5px] font-black bg-slate-200">
                  BREAK<br />
                  <span className="text-[7.5px] font-normal">10:40-11:00</span>
                </th>

                {/* Hour 3 */}
                <th className="border border-slate-900 py-1.5 px-1 w-24">
                  <div className="font-bold text-[11px]">Hour 3</div>
                  <div className="text-[9px] font-normal text-slate-600">{YEAR_1_SLOTS[3]}</div>
                </th>

                {/* Lunch Break */}
                <th className="border border-slate-900 py-1.5 px-1 w-11 text-[9.5px] font-black bg-slate-200">
                  LUNCH BREAK<br />
                  <span className="text-[7.5px] font-normal">11:50-1:00</span>
                </th>

                {/* Hours 4 & 5 */}
                <th className="border border-slate-900 py-1.5 px-1 w-24">
                  <div className="font-bold text-[11px]">Hour 4</div>
                  <div className="text-[9px] font-normal text-slate-600">{YEAR_1_SLOTS[4]}</div>
                </th>
                <th className="border border-slate-900 py-1.5 px-1 w-24">
                  <div className="font-bold text-[11px]">Hour 5</div>
                  <div className="text-[9px] font-normal text-slate-600">{YEAR_1_SLOTS[5]}</div>
                </th>

                {/* Afternoon Break */}
                <th className="border border-slate-900 py-1.5 px-1 w-9 text-[9.5px] font-black bg-slate-200">
                  BREAK<br />
                  <span className="text-[7.5px] font-normal">2:40-3:00</span>
                </th>

                {/* Hours 6 & 7 */}
                <th className="border border-slate-900 py-1.5 px-1 w-24">
                  <div className="font-bold text-[11px]">Hour 6</div>
                  <div className="text-[9px] font-normal text-slate-600">{YEAR_1_SLOTS[6]}</div>
                </th>
                <th className="border border-slate-900 py-1.5 px-1 w-24">
                  <div className="font-bold text-[11px]">Hour 7</div>
                  <div className="text-[9px] font-normal text-slate-600">{YEAR_1_SLOTS[7]}</div>
                </th>
              </tr>
            ) : (
              /* Senior Years (2, 3, 4) Table Header */
              <tr className="bg-slate-100 text-slate-900 font-bold text-center border-b-2 border-slate-900">
                <th className="border border-slate-900 py-2 px-2 w-24 text-[10px] font-black uppercase">
                  Day / Hour & Timing
                </th>

                {/* Hours 1 & 2 */}
                <th className="border border-slate-900 py-1.5 px-2 w-28">
                  <div className="font-bold text-[11px]">Hour 1</div>
                  <div className="text-[9.5px] font-normal text-slate-600">{SENIOR_YEAR_SLOTS[1]}</div>
                </th>
                <th className="border border-slate-900 py-1.5 px-2 w-28">
                  <div className="font-bold text-[11px]">Hour 2</div>
                  <div className="text-[9.5px] font-normal text-slate-600">{SENIOR_YEAR_SLOTS[2]}</div>
                </th>

                {/* Vertically merged BREAK Header */}
                <th className="border border-slate-900 py-1.5 px-1 w-10 text-[10px] font-black bg-slate-200">
                  BREAK<br />
                  <span className="text-[8px] font-normal">10:40-11:00</span>
                </th>

                {/* Hours 3 & 4 */}
                <th className="border border-slate-900 py-1.5 px-2 w-28">
                  <div className="font-bold text-[11px]">Hour 3</div>
                  <div className="text-[9.5px] font-normal text-slate-600">{SENIOR_YEAR_SLOTS[3]}</div>
                </th>
                <th className="border border-slate-900 py-1.5 px-2 w-28">
                  <div className="font-bold text-[11px]">Hour 4</div>
                  <div className="text-[9.5px] font-normal text-slate-600">{SENIOR_YEAR_SLOTS[4]}</div>
                </th>

                {/* Vertically merged LUNCH BREAK Header */}
                <th className="border border-slate-900 py-1.5 px-1 w-12 text-[10px] font-black bg-slate-200">
                  LUNCH BREAK<br />
                  <span className="text-[8px] font-normal">12:40-1:50</span>
                </th>

                {/* Hours 5, 6, 7 */}
                <th className="border border-slate-900 py-1.5 px-2 w-28">
                  <div className="font-bold text-[11px]">Hour 5</div>
                  <div className="text-[9.5px] font-normal text-slate-600">{SENIOR_YEAR_SLOTS[5]}</div>
                </th>
                <th className="border border-slate-900 py-1.5 px-2 w-28">
                  <div className="font-bold text-[11px]">Hour 6</div>
                  <div className="text-[9.5px] font-normal text-slate-600">{SENIOR_YEAR_SLOTS[6]}</div>
                </th>
                <th className="border border-slate-900 py-1.5 px-2 w-28">
                  <div className="font-bold text-[11px]">Hour 7</div>
                  <div className="text-[9.5px] font-normal text-slate-600">{SENIOR_YEAR_SLOTS[7]}</div>
                </th>
              </tr>
            )}
          </thead>

          <tbody>
            {year === 1 ? (
              /* Year 1 Table Body: 1, 2 | BREAK | 3 | LUNCH BREAK | 4, 5 | BREAK | 6, 7 */
              DAYS.map((day, dIdx) => (
                <tr key={day} className="border-b border-slate-900 min-h-[38px]">
                  {/* Day Name */}
                  <td className="border border-slate-900 font-extrabold text-center py-2 px-1 text-[11px] bg-slate-50 uppercase">
                    {DAY_ABBR[day]}
                  </td>

                  {/* Group 1: Hours 1 & 2 */}
                  {renderPdfPeriodCells(day, [1, 2])}

                  {/* Vertically Merged Morning BREAK Column */}
                  {dIdx === 0 && (
                    <td
                      rowSpan={6}
                      className="border border-slate-900 bg-slate-100 text-center font-black text-[10px] tracking-widest uppercase p-1 select-none align-middle"
                      style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                    >
                      B &nbsp; R &nbsp; E &nbsp; A &nbsp; K
                    </td>
                  )}

                  {/* Group 2: Hour 3 */}
                  {renderPdfPeriodCells(day, [3])}

                  {/* Vertically Merged LUNCH BREAK Column */}
                  {dIdx === 0 && (
                    <td
                      rowSpan={6}
                      className="border border-slate-900 bg-slate-100 text-center font-black text-[10px] tracking-widest uppercase p-1 select-none align-middle"
                      style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                    >
                      L &nbsp; U &nbsp; N &nbsp; C &nbsp; H &nbsp; &nbsp; B &nbsp; R &nbsp; E &nbsp; A &nbsp; K
                    </td>
                  )}

                  {/* Group 3: Hours 4 & 5 */}
                  {renderPdfPeriodCells(day, [4, 5])}

                  {/* Vertically Merged Afternoon BREAK Column */}
                  {dIdx === 0 && (
                    <td
                      rowSpan={6}
                      className="border border-slate-900 bg-slate-100 text-center font-black text-[10px] tracking-widest uppercase p-1 select-none align-middle"
                      style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                    >
                      B &nbsp; R &nbsp; E &nbsp; A &nbsp; K
                    </td>
                  )}

                  {/* Group 4: Hours 6 & 7 */}
                  {renderPdfPeriodCells(day, [6, 7])}
                </tr>
              ))
            ) : (
              /* Senior Years (2, 3, 4) Table Body */
              DAYS.map((day, dIdx) => (
                <tr key={day} className="border-b border-slate-900 min-h-[38px]">
                  {/* Day Name */}
                  <td className="border border-slate-900 font-extrabold text-center py-2 px-1 text-[11px] bg-slate-50 uppercase">
                    {DAY_ABBR[day]}
                  </td>

                  {/* Group 1: Hours 1 & 2 */}
                  {renderPdfPeriodCells(day, [1, 2])}

                  {/* Vertically Merged BREAK Column (Spanning all 6 rows on Monday) */}
                  {dIdx === 0 && (
                    <td
                      rowSpan={6}
                      className="border border-slate-900 bg-slate-100 text-center font-black text-[11px] tracking-widest uppercase p-1 select-none align-middle"
                      style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                    >
                      B &nbsp; R &nbsp; E &nbsp; A &nbsp; K
                    </td>
                  )}

                  {/* Group 2: Hours 3 & 4 */}
                  {renderPdfPeriodCells(day, [3, 4])}

                  {/* Vertically Merged LUNCH BREAK Column (Spanning all 6 rows on Monday) */}
                  {dIdx === 0 && (
                    <td
                      rowSpan={6}
                      className="border border-slate-900 bg-slate-100 text-center font-black text-[11px] tracking-widest uppercase p-1 select-none align-middle"
                      style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                    >
                      L &nbsp; U &nbsp; N &nbsp; C &nbsp; H &nbsp; &nbsp; B &nbsp; R &nbsp; E &nbsp; A &nbsp; K
                    </td>
                  )}

                  {/* Group 3: Hours 5, 6, 7 */}
                  {renderPdfPeriodCells(day, [5, 6, 7])}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 3. Footer: "Faculty details:" Table placed immediately below main grid */}
      <div className="mt-4 pt-2 border-t border-slate-300">
        <h3 className="text-xs font-black uppercase tracking-wider text-black mb-2">
          Faculty details:
        </h3>

        {displayFacultyList.length === 0 ? (
          <p className="text-[11px] text-slate-500 italic">No assigned faculty details available for this section.</p>
        ) : (
          <table className="w-full border-collapse border border-slate-800 text-[10.5px]">
            <thead>
              <tr className="bg-slate-100 text-slate-900 font-bold border-b border-slate-800 text-left">
                <th className="border border-slate-800 py-1 px-3 w-12 text-center">S.No</th>
                <th className="border border-slate-800 py-1 px-3 w-1/3">Subject Name</th>
                <th className="border border-slate-800 py-1 px-3 w-1/3">Faculty Name</th>
                <th className="border border-slate-800 py-1 px-3">
                  Phone No. {isStudent && <span className="text-[9px] font-normal text-slate-500">(Protected)</span>}
                </th>
              </tr>
            </thead>
            <tbody>
              {displayFacultyList.map((item, idx) => (
                <tr key={`${item.subject}-${idx}`} className="border-b border-slate-300">
                  <td className="border border-slate-800 py-1 px-3 text-center font-semibold text-slate-600">
                    {idx + 1}
                  </td>
                  <td className="border border-slate-800 py-1 px-3 font-bold text-black">
                    {item.subject}
                  </td>
                  <td className="border border-slate-800 py-1 px-3 font-medium text-slate-800">
                    {item.faculty_name}
                  </td>
                  <td className="border border-slate-800 py-1 px-3 font-mono text-slate-700">
                    {isStudent ? '—' : (item.phone || '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-4 flex items-center justify-between text-[9px] text-slate-500 font-medium border-t border-slate-200 pt-2">
          <div>Generated by RGMCET Academic Schedule Automation System</div>
          <div>Department of CSE (AI & ML) · Rajeev Gandhi Memorial College of Engineering and Technology</div>
        </div>
      </div>
    </div>
  );
}
