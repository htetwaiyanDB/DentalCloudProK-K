import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCurrency } from './currency';
import { groupMonthlyReportDetailRows, monthlyReportFilename, type MonthlyReport, type MonthlyReportGroup, type MonthlyReportMetadata } from './monthlyReport';

const percentage = (value: number): string => `${(value * 100).toFixed(1)}%`;
const generatedLabel = (date: Date): string => date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

const addPdfFooter = (doc: jsPDF, metadata: MonthlyReportMetadata) => {
  const drawingDoc = doc as any;
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    drawingDoc.setDrawColor(226, 232, 240);
    drawingDoc.line(14, doc.internal.pageSize.height - 13, doc.internal.pageSize.width - 14, doc.internal.pageSize.height - 13);
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`${metadata.locationName} | ${metadata.dateFrom} to ${metadata.dateTo} | Production-based profitability`, 14, doc.internal.pageSize.height - 8);
    doc.text(`Page ${page} of ${pageCount}`, doc.internal.pageSize.width - 14, doc.internal.pageSize.height - 8, { align: 'right' });
  }
};

const addPdfGroupTable = (doc: jsPDF, title: string, groups: MonthlyReportGroup[], startY: number, metadata: MonthlyReportMetadata) => {
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(title, 14, startY);
  autoTable(doc, {
    startY: startY + 4,
    head: [['Category', 'Treatments', 'Patients', 'Production', 'Payment', 'Total Cost', 'Net Profit', 'Margin']],
    body: groups.slice(0, 15).map(group => [
      group.name, String(group.treatments), String(group.patients), formatCurrency(group.production, metadata.currency),
      formatCurrency(group.payment, metadata.currency), formatCurrency(group.totalCost, metadata.currency),
      formatCurrency(group.netProfit, metadata.currency), percentage(group.netMargin)
    ]),
    theme: 'striped',
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 7, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7, textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14, bottom: 18 }
  });
};

export const exportMonthlyReportToPDF = (report: MonthlyReport, metadata: MonthlyReportMetadata) => {
  const generatedAt = metadata.generatedAt || new Date();
  const detailRows = groupMonthlyReportDetailRows(report.rows);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3', compress: true } as any);
  const drawingDoc = doc as any;
  const width = doc.internal.pageSize.width;

  drawingDoc.setFillColor(15, 23, 42);
  drawingDoc.rect(0, 0, width, 38, 'F');
  doc.setFontSize(21);
  doc.setTextColor(255, 255, 255);
  doc.text('Monthly Treatment & Profitability Report', 14, 17);
  doc.setFontSize(9);
  doc.setTextColor(203, 213, 225);
  doc.text(`${metadata.locationName}  |  ${metadata.dateFrom} to ${metadata.dateTo}  |  ${metadata.currency}`, 14, 27);
  doc.text(`Generated ${generatedLabel(generatedAt)}`, width - 14, 27, { align: 'right' });

  const cards = [
    ['Treatments', String(report.summary.treatmentCount)],
    ['Patients', String(report.summary.patientCount)],
    ['Production', formatCurrency(report.summary.production, metadata.currency)],
    ['Payments', formatCurrency(report.summary.payment, metadata.currency)],
    ['Total Cost', formatCurrency(report.summary.totalCost, metadata.currency)],
    ['Net Profit', formatCurrency(report.summary.netProfit, metadata.currency)],
    ['Net Margin', percentage(report.summary.netMargin)],
    ['Collection Rate', percentage(report.summary.collectionRate)]
  ];
  const cardWidth = (width - 28 - 7 * 3) / 8;
  cards.forEach(([label, value], index) => {
    const x = 14 + index * (cardWidth + 3);
    drawingDoc.setFillColor(index === 5 ? 236 : 248, index === 5 ? 253 : 250, index === 5 ? 245 : 252);
    drawingDoc.setDrawColor(index === 5 ? 167 : 226, index === 5 ? 243 : 232, index === 5 ? 208 : 240);
    drawingDoc.roundedRect(x, 44, cardWidth, 20, 2, 2, 'FD');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(label.toUpperCase(), x + 3, 50);
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    drawingDoc.text(value, x + 3, 59, { maxWidth: cardWidth - 6 });
  });

  autoTable(doc, {
    startY: 71,
    head: [['Date', 'Pt Name', 'Age', 'Phone', 'City', 'Township', 'Pt Type', 'Treatment', 'Dentist / Doctor', 'Cost', 'Payment', 'Balance', 'Lab Cost', 'Material Cost', 'Doctor Cost', 'Total Cost', 'Net Profit']],
    body: detailRows.length ? detailRows.map(row => [
      row.date, row.patientName, row.age === null ? '-' : String(row.age), row.phone, row.city, row.township, row.patientType,
      row.treatment, row.doctor, formatCurrency(row.cost, metadata.currency), formatCurrency(row.payment, metadata.currency),
      formatCurrency(row.balance, metadata.currency), formatCurrency(row.labCost, metadata.currency), formatCurrency(row.materialCost, metadata.currency),
      formatCurrency(row.doctorCost, metadata.currency), formatCurrency(row.totalCost, metadata.currency), formatCurrency(row.netProfit, metadata.currency)
    ]) : [['No treatments were recorded in this period.', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']],
    theme: 'grid',
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontSize: 6, fontStyle: 'bold', halign: 'center', valign: 'middle' },
    bodyStyles: { fontSize: 5.8, textColor: [30, 41, 59], cellPadding: 1.5, valign: 'middle' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 18 }, 1: { cellWidth: 25 }, 2: { cellWidth: 9, halign: 'center' }, 3: { cellWidth: 20 },
      4: { cellWidth: 16 }, 5: { cellWidth: 18 }, 6: { cellWidth: 17 }, 7: { cellWidth: 29 }, 8: { cellWidth: 23 },
      9: { halign: 'right' }, 10: { halign: 'right' }, 11: { halign: 'right' }, 12: { halign: 'right' },
      13: { halign: 'right' }, 14: { halign: 'right' }, 15: { halign: 'right' }, 16: { halign: 'right' }
    },
    didParseCell: hook => {
      if (hook.section === 'body' && hook.column.index === 16 && detailRows[hook.row.index]?.netProfit < 0) {
        hook.cell.styles.textColor = [190, 24, 93];
        hook.cell.styles.fontStyle = 'bold';
      }
    },
    margin: { left: 8, right: 8, bottom: 18 }
  });

  doc.addPage();
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text('Performance Analysis', 14, 20);
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Ranked by treatment production. Top 15 categories are shown in each section.', 14, 28);
  addPdfGroupTable(doc, 'Treatment Performance', report.byTreatment, 39, metadata);
  const firstEnd = Number((doc as any).lastAutoTable?.finalY || 85);
  addPdfGroupTable(doc, 'Clinician Performance', report.byDoctor, firstEnd + 10, metadata);
  const secondEnd = Number((doc as any).lastAutoTable?.finalY || 145);
  if (secondEnd > doc.internal.pageSize.height - 65) doc.addPage();
  addPdfGroupTable(doc, 'Patient Type Performance', report.byPatientType, secondEnd > doc.internal.pageSize.height - 65 ? 20 : secondEnd + 10, metadata);

  addPdfFooter(doc, metadata);
  doc.save(monthlyReportFilename(metadata, 'pdf'));
};

const currencyFormat = (currency: MonthlyReportMetadata['currency']) => currency === 'MMK' ? '#,##0" Ks"' : '$#,##0.00';

const EXCEL_COLORS = {
  navy: '0F172A',
  slate: '334155',
  muted: '64748B',
  border: 'CBD5E1',
  indigo: '4F46E5',
  stripe: 'F8FAFC',
  total: 'E2E8F0',
  white: 'FFFFFF',
  profit: '166534',
  profitSoft: 'DCFCE7',
  loss: 'B91C1C',
  lossSoft: 'FEE2E2'
} as const;

const excelBorder = (style: 'thin' | 'medium' = 'thin', color: string = EXCEL_COLORS.border) => ({
  top: { style, color: { rgb: color } },
  bottom: { style, color: { rgb: color } },
  left: { style, color: { rgb: color } },
  right: { style, color: { rgb: color } }
});

const fill = (rgb: string) => ({ patternType: 'solid', fgColor: { rgb } });

const applyCellStyle = (worksheet: any, address: string, style: Record<string, unknown>) => {
  const cell = worksheet[address] || (worksheet[address] = { t: 's', v: '' });
  cell.s = { ...(cell.s || {}), ...style };
};

const applyRangeStyle = (XLSX: any, worksheet: any, range: string, style: Record<string, unknown>) => {
  const decoded = XLSX.utils.decode_range(range);
  for (let row = decoded.s.r; row <= decoded.e.r; row += 1) {
    for (let column = decoded.s.c; column <= decoded.e.c; column += 1) {
      applyCellStyle(worksheet, XLSX.utils.encode_cell({ r: row, c: column }), style);
    }
  }
};

const styleReportBanner = (XLSX: any, worksheet: any, lastColumn: string) => {
  applyRangeStyle(XLSX, worksheet, `A1:${lastColumn}1`, {
    fill: fill(EXCEL_COLORS.navy),
    font: { name: 'Calibri', sz: 16, bold: true, color: { rgb: EXCEL_COLORS.white } },
    alignment: { vertical: 'center', horizontal: 'left' },
    border: excelBorder('medium', EXCEL_COLORS.navy)
  });
  applyRangeStyle(XLSX, worksheet, `A2:${lastColumn}2`, {
    fill: fill(EXCEL_COLORS.slate),
    font: { name: 'Calibri', sz: 10, color: { rgb: EXCEL_COLORS.white } },
    alignment: { vertical: 'center', horizontal: 'left' },
    border: excelBorder('thin', EXCEL_COLORS.slate)
  });
};

const styleTable = (
  XLSX: any,
  worksheet: any,
  headerRow: number,
  dataRowCount: number,
  totalRow: number,
  lastColumn: string,
  numericColumns: number[],
  centeredColumns: number[] = []
) => {
  applyRangeStyle(XLSX, worksheet, `A${headerRow}:${lastColumn}${headerRow}`, {
    fill: fill(EXCEL_COLORS.indigo),
    font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: EXCEL_COLORS.white } },
    alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
    border: excelBorder('medium', EXCEL_COLORS.indigo)
  });

  for (let row = headerRow + 1; row <= headerRow + dataRowCount; row += 1) {
    applyRangeStyle(XLSX, worksheet, `A${row}:${lastColumn}${row}`, {
      fill: fill((row - headerRow) % 2 === 0 ? EXCEL_COLORS.stripe : EXCEL_COLORS.white),
      font: { name: 'Calibri', sz: 10, color: { rgb: EXCEL_COLORS.slate } },
      alignment: { vertical: 'center', horizontal: 'left' },
      border: excelBorder()
    });
  }

  applyRangeStyle(XLSX, worksheet, `A${totalRow}:${lastColumn}${totalRow}`, {
    fill: fill(EXCEL_COLORS.total),
    font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: EXCEL_COLORS.navy } },
    alignment: { vertical: 'center', horizontal: 'left' },
    border: excelBorder('medium', EXCEL_COLORS.slate)
  });

  for (let row = headerRow + 1; row <= totalRow; row += 1) {
    numericColumns.forEach(column => {
      applyCellStyle(worksheet, XLSX.utils.encode_cell({ r: row - 1, c: column }), {
        alignment: { vertical: 'center', horizontal: 'right' }
      });
    });
    centeredColumns.forEach(column => {
      applyCellStyle(worksheet, XLSX.utils.encode_cell({ r: row - 1, c: column }), {
        alignment: { vertical: 'center', horizontal: 'center' }
      });
    });
  }
};

const styleProfitCell = (worksheet: any, address: string, value: number, bold = false) => {
  applyCellStyle(worksheet, address, {
    fill: fill(value < 0 ? EXCEL_COLORS.lossSoft : EXCEL_COLORS.profitSoft),
    font: { name: 'Calibri', sz: 10, bold, color: { rgb: value < 0 ? EXCEL_COLORS.loss : EXCEL_COLORS.profit } },
    alignment: { vertical: 'center', horizontal: 'right' },
    border: excelBorder()
  });
};

const setNumberFormat = (XLSX: any, worksheet: any, rowFrom: number, rowTo: number, columns: number[], format: string) => {
  for (let row = rowFrom; row <= rowTo; row += 1) {
    columns.forEach(column => {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row - 1, c: column })];
      if (cell?.t === 'n') cell.z = format;
    });
  }
};

const reportSubtitle = (metadata: MonthlyReportMetadata) => (
  `${metadata.locationName} | ${metadata.dateFrom} to ${metadata.dateTo} | Currency: ${metadata.currency}`
);

const configureTableSheet = (
  worksheet: any,
  headerRow: number,
  dataRowCount: number,
  lastColumn: string,
  columnWidths: number[]
) => {
  const lastDataRow = Math.max(headerRow, headerRow + dataRowCount);
  worksheet['!cols'] = columnWidths.map(wch => ({ wch }));
  worksheet['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 8 }, { hpt: 24 }];
  worksheet['!autofilter'] = { ref: `A${headerRow}:${lastColumn}${lastDataRow}` };
  worksheet['!freeze'] = {
    xSplit: 0,
    ySplit: headerRow,
    topLeftCell: `A${headerRow + 1}`,
    activePane: 'bottomLeft',
    state: 'frozen'
  };
};

export const buildMonthlyReportExcelWorkbook = async (report: MonthlyReport, metadata: MonthlyReportMetadata) => {
  const XLSX = await import('xlsx-js-style');
  const workbook = XLSX.utils.book_new();
  const generatedAt = metadata.generatedAt || new Date();
  const currency = currencyFormat(metadata.currency);
  workbook.Props = {
    Title: 'Monthly Treatment & Profitability Report',
    Subject: `${metadata.locationName} | ${metadata.dateFrom} to ${metadata.dateTo}`,
    Author: 'Dental Cloud',
    CreatedDate: generatedAt
  };

  const summaryRows: Array<Array<string | number>> = [
    ['MONTHLY TREATMENT & PROFITABILITY REPORT', '', '', '', '', '', '', ''],
    [reportSubtitle(metadata), '', '', '', '', '', '', ''],
    [`Generated ${generatedLabel(generatedAt)}`, '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['REPORT VOLUME', '', '', 'REVENUE & COLLECTIONS', '', '', 'COSTS & PROFITABILITY', ''],
    ['Treatments Performed', report.summary.treatmentCount, '', 'Treatment Production', report.summary.production, '', 'Material Cost', report.summary.materialCost],
    ['Distinct Patients', report.summary.patientCount, '', 'Collected Payment', report.summary.payment, '', 'Lab Cost', report.summary.labCost],
    ['', '', '', 'Outstanding Balance', report.summary.balance, '', 'Doctor Cost', report.summary.doctorCost],
    ['', '', '', 'Collection Rate', report.summary.collectionRate, '', 'Total Cost', report.summary.totalCost],
    ['', '', '', '', '', '', 'Net Profit', report.summary.netProfit],
    ['', '', '', '', '', '', 'Net Margin', report.summary.netMargin],
    ['', '', '', '', '', '', '', ''],
    ['REPORT DEFINITION', '', '', '', '', '', '', ''],
    ['Net Profit = Treatment Production - Material Cost - Lab Cost - Doctor Cost. Unrelated operating expenses are excluded.', '', '', '', '', '', '', '']
  ];
  const summarySheet: any = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [24, 16, 4, 24, 18, 4, 24, 18].map(wch => ({ wch }));
  summarySheet['!rows'] = [{ hpt: 30 }, { hpt: 20 }, { hpt: 18 }, { hpt: 8 }, { hpt: 24 }];
  summarySheet['!merges'] = [
    XLSX.utils.decode_range('A1:H1'), XLSX.utils.decode_range('A2:H2'), XLSX.utils.decode_range('A3:H3'),
    XLSX.utils.decode_range('A5:B5'), XLSX.utils.decode_range('D5:E5'), XLSX.utils.decode_range('G5:H5'),
    XLSX.utils.decode_range('A13:H13'), XLSX.utils.decode_range('A14:H14')
  ];
  summarySheet['!freeze'] = { xSplit: 0, ySplit: 4, topLeftCell: 'A5', activePane: 'bottomLeft', state: 'frozen' };
  ['E6', 'E7', 'E8', 'H6', 'H7', 'H8', 'H9', 'H10'].forEach(address => {
    if (summarySheet[address]?.t === 'n') summarySheet[address].z = currency;
  });
  ['E9', 'H11'].forEach(address => {
    if (summarySheet[address]?.t === 'n') summarySheet[address].z = '0.0%';
  });
  styleReportBanner(XLSX, summarySheet, 'H');
  applyRangeStyle(XLSX, summarySheet, 'A3:H3', {
    fill: fill(EXCEL_COLORS.stripe),
    font: { name: 'Calibri', sz: 9, italic: true, color: { rgb: EXCEL_COLORS.muted } },
    alignment: { vertical: 'center', horizontal: 'left' }
  });
  ['A5:B5', 'D5:E5', 'G5:H5'].forEach(range => applyRangeStyle(XLSX, summarySheet, range, {
    fill: fill(EXCEL_COLORS.indigo),
    font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: EXCEL_COLORS.white } },
    alignment: { vertical: 'center', horizontal: 'left' },
    border: excelBorder('medium', EXCEL_COLORS.indigo)
  }));
  ['A6:B11', 'D6:E11', 'G6:H11'].forEach(range => applyRangeStyle(XLSX, summarySheet, range, {
    fill: fill(EXCEL_COLORS.white),
    font: { name: 'Calibri', sz: 10, color: { rgb: EXCEL_COLORS.slate } },
    alignment: { vertical: 'center', horizontal: 'left' },
    border: excelBorder()
  }));
  ['B6', 'B7', 'E6', 'E7', 'E8', 'E9', 'H6', 'H7', 'H8', 'H9', 'H10', 'H11'].forEach(address => {
    applyCellStyle(summarySheet, address, { alignment: { vertical: 'center', horizontal: 'right' } });
  });
  styleProfitCell(summarySheet, 'H10', report.summary.netProfit, true);
  styleProfitCell(summarySheet, 'H11', report.summary.netProfit, true);
  applyRangeStyle(XLSX, summarySheet, 'A13:H13', {
    fill: fill(EXCEL_COLORS.total),
    font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: EXCEL_COLORS.navy } },
    alignment: { vertical: 'center', horizontal: 'left' },
    border: excelBorder('medium', EXCEL_COLORS.slate)
  });
  applyRangeStyle(XLSX, summarySheet, 'A14:H14', {
    fill: fill(EXCEL_COLORS.stripe),
    font: { name: 'Calibri', sz: 9, italic: true, color: { rgb: EXCEL_COLORS.slate } },
    alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
    border: excelBorder()
  });
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Executive Summary');

  const detailHeaders = [
    'Treatment Date', 'Patient Name', 'Age', 'Phone Number', 'City', 'Township', 'Patient Type', 'Treatment', 'Clinician',
    'Treatment Production', 'Collected Payment', 'Outstanding Balance', 'Material Cost', 'Lab Cost', 'Doctor Cost',
    'Total Cost', 'Net Profit', 'Net Margin'
  ];
  const groupedDetailRows = groupMonthlyReportDetailRows(report.rows);
  const detailData = groupedDetailRows.map(row => [
    row.date, row.patientName, row.age ?? '', row.phone, row.city, row.township, row.patientType, row.treatment, row.doctor,
    row.cost, row.payment, row.balance, row.materialCost, row.labCost, row.doctorCost, row.totalCost, row.netProfit, row.netMargin
  ]);
  const detailRows: Array<Array<string | number>> = [
    ['TREATMENT DETAIL', ...Array(17).fill('')],
    [reportSubtitle(metadata), ...Array(17).fill('')],
    ['', ...Array(17).fill('')],
    detailHeaders,
    ...detailData,
    ['REPORT TOTAL', '', '', '', '', '', '', '', '', report.summary.production, report.summary.payment, report.summary.balance,
      report.summary.materialCost, report.summary.labCost, report.summary.doctorCost, report.summary.totalCost, report.summary.netProfit, report.summary.netMargin]
  ];
  const detailSheet: any = XLSX.utils.aoa_to_sheet(detailRows);
  detailSheet['!merges'] = [XLSX.utils.decode_range('A1:R1'), XLSX.utils.decode_range('A2:R2')];
  configureTableSheet(detailSheet, 4, detailData.length, 'R', [15, 25, 8, 18, 18, 18, 18, 32, 24, 20, 19, 20, 16, 16, 16, 16, 16, 14]);
  setNumberFormat(XLSX, detailSheet, 5, 5 + detailData.length, [9, 10, 11, 12, 13, 14, 15, 16], currency);
  setNumberFormat(XLSX, detailSheet, 5, 5 + detailData.length, [17], '0.0%');
  styleReportBanner(XLSX, detailSheet, 'R');
  styleTable(XLSX, detailSheet, 4, detailData.length, 5 + detailData.length, 'R', [2, 9, 10, 11, 12, 13, 14, 15, 16, 17], [2]);
  groupedDetailRows.forEach((row, index) => styleProfitCell(detailSheet, `Q${5 + index}`, row.netProfit));
  styleProfitCell(detailSheet, `Q${5 + detailData.length}`, report.summary.netProfit, true);
  XLSX.utils.book_append_sheet(workbook, detailSheet, 'Treatment Detail');

  const appendGroupSheet = (name: string, title: string, categoryHeader: string, groups: MonthlyReportGroup[]) => {
    const groupData = groups.map(group => [
      group.name, group.treatments, group.patients, group.production, group.payment, group.totalCost, group.netProfit, group.netMargin
    ]);
    const rows: Array<Array<string | number>> = [
      [title, '', '', '', '', '', '', ''],
      [reportSubtitle(metadata), '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', ''],
      [categoryHeader, 'Treatments', 'Distinct Patients', 'Treatment Production', 'Collected Payment', 'Total Cost', 'Net Profit', 'Net Margin'],
      ...groupData,
      ['REPORT TOTAL', report.summary.treatmentCount, report.summary.patientCount, report.summary.production, report.summary.payment,
        report.summary.totalCost, report.summary.netProfit, report.summary.netMargin]
    ];
    const sheet: any = XLSX.utils.aoa_to_sheet(rows);
    sheet['!merges'] = [XLSX.utils.decode_range('A1:H1'), XLSX.utils.decode_range('A2:H2')];
    configureTableSheet(sheet, 4, groupData.length, 'H', [34, 13, 18, 21, 19, 16, 16, 14]);
    setNumberFormat(XLSX, sheet, 5, 5 + groupData.length, [3, 4, 5, 6], currency);
    setNumberFormat(XLSX, sheet, 5, 5 + groupData.length, [7], '0.0%');
    styleReportBanner(XLSX, sheet, 'H');
    styleTable(XLSX, sheet, 4, groupData.length, 5 + groupData.length, 'H', [1, 2, 3, 4, 5, 6, 7], [1, 2]);
    groups.forEach((group, index) => styleProfitCell(sheet, `G${5 + index}`, group.netProfit));
    styleProfitCell(sheet, `G${5 + groupData.length}`, report.summary.netProfit, true);
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  };

  appendGroupSheet('By Treatment', 'TREATMENT PERFORMANCE', 'Treatment Category', report.byTreatment);
  appendGroupSheet('By Clinician', 'CLINICIAN PERFORMANCE', 'Clinician', report.byDoctor);
  appendGroupSheet('By Patient Type', 'PATIENT TYPE PERFORMANCE', 'Patient Type', report.byPatientType);
  return workbook;
};

export const exportMonthlyReportToExcel = async (report: MonthlyReport, metadata: MonthlyReportMetadata) => {
  const XLSX = await import('xlsx-js-style');
  const workbook = await buildMonthlyReportExcelWorkbook(report, metadata);
  XLSX.writeFile(workbook, monthlyReportFilename(metadata, 'xlsx'), { compression: true, cellStyles: true });
};
