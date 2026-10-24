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
    doc.text(`${metadata.locationName} | ${metadata.dateFrom} to ${metadata.dateTo} | Comprehensive clinic profitability`, 14, doc.internal.pageSize.height - 8);
    doc.text(`Page ${page} of ${pageCount}`, doc.internal.pageSize.width - 14, doc.internal.pageSize.height - 8, { align: 'right' });
  }
};

const addPdfGroupTable = (doc: jsPDF, title: string, groups: MonthlyReportGroup[], startY: number, metadata: MonthlyReportMetadata) => {
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(title, 14, startY);
  autoTable(doc, {
    startY: startY + 4,
    head: [['Category', 'Treatments', 'Patients', 'Discount', 'Production', 'Payment', 'Service', 'Medicine', 'Revenue', 'MLS', 'Direct Cost', 'Contribution', 'Margin']],
    body: groups.slice(0, 15).map(group => [
      group.name, String(group.treatments), String(group.patients), formatCurrency(group.discount, metadata.currency),
      formatCurrency(group.production, metadata.currency), formatCurrency(group.payment, metadata.currency),
      formatCurrency(group.serviceCharges, metadata.currency), formatCurrency(group.medicineSales, metadata.currency),
      formatCurrency(group.totalRevenue, metadata.currency), formatCurrency(group.mlsTotal, metadata.currency), formatCurrency(group.totalCost, metadata.currency),
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
  doc.text('Monthly Clinic & Profitability Report', 14, 17);
  doc.setFontSize(9);
  doc.setTextColor(203, 213, 225);
  doc.text(`${metadata.locationName}  |  ${metadata.dateFrom} to ${metadata.dateTo}  |  ${metadata.currency}`, 14, 27);
  doc.text(`Generated ${generatedLabel(generatedAt)}`, width - 14, 27, { align: 'right' });

  const cards = [
    ['Treatments', String(report.summary.treatmentCount)],
    ['Patients', String(report.summary.patientCount)],
    ['Treatment Production', formatCurrency(report.summary.production, metadata.currency)],
    ['Discounts', formatCurrency(report.summary.discount, metadata.currency)],
    ['Service Charges', formatCurrency(report.summary.serviceCharges, metadata.currency)],
    ['Medicine Sales', formatCurrency(report.summary.medicineSales, metadata.currency)],
    ['Total Revenue', formatCurrency(report.summary.totalRevenue, metadata.currency)],
    ['Payments', formatCurrency(report.summary.payment, metadata.currency)],
    ['Outstanding Patient Balance (Current)', formatCurrency(report.summary.balance, metadata.currency)],
    ['MLS Total', formatCurrency(report.summary.mlsTotal, metadata.currency)],
    ['Operating Expenses', formatCurrency(report.summary.operatingExpenses, metadata.currency)],
    ['Net Profit', formatCurrency(report.summary.netProfit, metadata.currency)],
    ['Net Margin', percentage(report.summary.netMargin)]
  ];
  const cardsPerRow = 6;
  const cardWidth = (width - 28 - (cardsPerRow - 1) * 3) / cardsPerRow;
  cards.forEach(([label, value], index) => {
    const column = index % cardsPerRow;
    const row = Math.floor(index / cardsPerRow);
    const x = 14 + column * (cardWidth + 3);
    const y = 44 + row * 23;
    const isProfit = label === 'Net Profit';
    drawingDoc.setFillColor(isProfit ? 236 : 248, isProfit ? 253 : 250, isProfit ? 245 : 252);
    drawingDoc.setDrawColor(isProfit ? 167 : 226, isProfit ? 243 : 232, isProfit ? 208 : 240);
    drawingDoc.roundedRect(x, y, cardWidth, 20, 2, 2, 'FD');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(label.toUpperCase(), x + 3, y + 6);
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    drawingDoc.text(value, x + 3, y + 15, { maxWidth: cardWidth - 6 });
  });

  autoTable(doc, {
    startY: 94,
    head: [['Date', 'Pt Name', 'Age', 'Phone', 'City', 'Township', 'Pt Type', 'Treatment', 'Dentist / Doctor', 'Standard', 'Discount', 'Treatment Production', 'Payment', 'Current Patient Balance', 'Service', 'Medicine', 'Revenue', 'Material', 'Lab', 'Special Doctor', 'MLS Total', 'Doctor RF', 'Direct Cost', 'Contribution', 'Margin']],
    body: detailRows.length ? detailRows.map(row => [
      row.date, row.patientName, row.age === null ? '-' : String(row.age), row.phone, row.city, row.township, row.patientType,
      row.treatment, row.doctor, formatCurrency(row.standardCost, metadata.currency), formatCurrency(row.discount, metadata.currency),
      formatCurrency(row.cost, metadata.currency), formatCurrency(row.payment, metadata.currency), formatCurrency(row.balance, metadata.currency),
      formatCurrency(row.serviceCharges, metadata.currency), formatCurrency(row.medicineSales, metadata.currency), formatCurrency(row.totalRevenue, metadata.currency),
      formatCurrency(row.materialCost, metadata.currency), formatCurrency(row.labCost, metadata.currency), formatCurrency(row.specialDoctorCost, metadata.currency),
      formatCurrency(row.mlsTotal, metadata.currency), formatCurrency(row.doctorCost, metadata.currency), formatCurrency(row.totalCost, metadata.currency),
      formatCurrency(row.netProfit, metadata.currency), percentage(row.netMargin)
    ]) : [['No treatments were recorded in this period.', ...Array(24).fill('')]],
    theme: 'grid',
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontSize: 6, fontStyle: 'bold', halign: 'center', valign: 'middle' },
    bodyStyles: { fontSize: 5.8, textColor: [30, 41, 59], cellPadding: 1.5, valign: 'middle' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 18 }, 1: { cellWidth: 25 }, 2: { cellWidth: 9, halign: 'center' }, 3: { cellWidth: 20 },
      4: { cellWidth: 16 }, 5: { cellWidth: 18 }, 6: { cellWidth: 17 }, 7: { cellWidth: 29 }, 8: { cellWidth: 23 },
      9: { halign: 'right' }, 10: { halign: 'right' }, 11: { halign: 'right' }, 12: { halign: 'right' },
      13: { halign: 'right' }, 14: { halign: 'right' }, 15: { halign: 'right' }, 16: { halign: 'right' },
      17: { halign: 'right' }, 18: { halign: 'right' }, 19: { halign: 'right' }, 20: { halign: 'right' },
      21: { halign: 'right' }, 22: { halign: 'right' }, 23: { halign: 'right' }, 24: { halign: 'right' }
    },
    didParseCell: hook => {
      if (hook.section === 'body' && hook.column.index === 23 && detailRows[hook.row.index]?.netProfit < 0) {
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

  if ((report.expenses || []).length > 0) {
    doc.addPage();
    doc.setFontSize(18);
    doc.setTextColor(15, 23, 42);
    doc.text('Operating Expenses', 14, 20);
    autoTable(doc, {
      startY: 28,
      head: [['Date', 'Category', 'Description', 'Amount']],
      body: (report.expenses || []).map(expense => [expense.date, expense.category, expense.description, formatCurrency(expense.amount, metadata.currency)]),
      foot: [['', '', 'TOTAL', formatCurrency(report.summary.operatingExpenses, metadata.currency)]],
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229], textColor: 255 },
      columnStyles: { 3: { halign: 'right', fontStyle: 'bold' } },
      margin: { left: 14, right: 14, bottom: 18 }
    });
  }

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
  const directCostTotal = report.summary.mlsTotal + report.summary.doctorCost;
  const contributionTotal = report.summary.totalRevenue - directCostTotal;
  workbook.Props = {
    Title: 'Monthly Clinic & Profitability Report',
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
    ['Distinct Patients', report.summary.patientCount, '', 'Standard Production', report.summary.standardProduction, '', 'Lab Cost', report.summary.labCost],
    ['', '', '', 'Treatment Discount', report.summary.discount, '', 'Special Doctor Cost', report.summary.specialDoctorCost],
    ['', '', '', 'Service Charges', report.summary.serviceCharges, '', 'MLS Total', report.summary.mlsTotal],
    ['', '', '', 'Medicine Sales', report.summary.medicineSales, '', 'Doctor Cost', report.summary.doctorCost],
    ['', '', '', 'Total Revenue', report.summary.totalRevenue, '', 'Operating Expenses', report.summary.operatingExpenses],
    ['', '', '', 'Collected Treatment Payment', report.summary.payment, '', 'Total Cost', report.summary.totalCost],
    ['', '', '', 'Outstanding Patient Balance (Current)', report.summary.balance, '', 'Net Profit', report.summary.netProfit],
    ['', '', '', 'Collection Rate', report.summary.collectionRate, '', 'Net Margin', report.summary.netMargin],
    ['', '', '', '', '', '', '', ''],
    ['REPORT DEFINITION', '', '', '', '', '', '', ''],
    ['Net Profit = Treatment Production + Service Charges + Medicine Sales - MLS Total - Doctor Cost - Operating Expenses. Outstanding Patient Balance is the current database balance for each distinct report patient and is counted once per patient. MLS-generated expenses are excluded from Operating Expenses to prevent double counting.', '', '', '', '', '', '', '']
  ];
  const summarySheet: any = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [24, 16, 4, 24, 18, 4, 24, 18].map(wch => ({ wch }));
  summarySheet['!rows'] = [{ hpt: 30 }, { hpt: 20 }, { hpt: 18 }, { hpt: 8 }, { hpt: 24 }];
  summarySheet['!merges'] = [
    XLSX.utils.decode_range('A1:H1'), XLSX.utils.decode_range('A2:H2'), XLSX.utils.decode_range('A3:H3'),
    XLSX.utils.decode_range('A5:B5'), XLSX.utils.decode_range('D5:E5'), XLSX.utils.decode_range('G5:H5'),
    XLSX.utils.decode_range('A16:H16'), XLSX.utils.decode_range('A17:H17')
  ];
  summarySheet['!freeze'] = { xSplit: 0, ySplit: 4, topLeftCell: 'A5', activePane: 'bottomLeft', state: 'frozen' };
  ['E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'E12', 'E13', 'H6', 'H7', 'H8', 'H9', 'H10', 'H11', 'H12', 'H13'].forEach(address => {
    if (summarySheet[address]?.t === 'n') summarySheet[address].z = currency;
  });
  ['E14', 'H14'].forEach(address => {
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
  ['A6:B14', 'D6:E14', 'G6:H14'].forEach(range => applyRangeStyle(XLSX, summarySheet, range, {
    fill: fill(EXCEL_COLORS.white),
    font: { name: 'Calibri', sz: 10, color: { rgb: EXCEL_COLORS.slate } },
    alignment: { vertical: 'center', horizontal: 'left' },
    border: excelBorder()
  }));
  ['B6', 'B7', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'E12', 'E13', 'E14', 'H6', 'H7', 'H8', 'H9', 'H10', 'H11', 'H12', 'H13', 'H14'].forEach(address => {
    applyCellStyle(summarySheet, address, { alignment: { vertical: 'center', horizontal: 'right' } });
  });
  styleProfitCell(summarySheet, 'H13', report.summary.netProfit, true);
  applyRangeStyle(XLSX, summarySheet, 'A16:H16', {
    fill: fill(EXCEL_COLORS.total),
    font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: EXCEL_COLORS.navy } },
    alignment: { vertical: 'center', horizontal: 'left' },
    border: excelBorder('medium', EXCEL_COLORS.slate)
  });
  applyRangeStyle(XLSX, summarySheet, 'A17:H17', {
    fill: fill(EXCEL_COLORS.stripe),
    font: { name: 'Calibri', sz: 9, italic: true, color: { rgb: EXCEL_COLORS.slate } },
    alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
    border: excelBorder()
  });
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Executive Summary');

  const detailHeaders = [
    'Treatment Date', 'Patient Name', 'Age', 'Phone Number', 'City', 'Township', 'Patient Type', 'Treatment', 'Clinician',
    'Standard Production', 'Discount', 'Treatment Production', 'Collected Payment', 'Current Patient Balance', 'Service Charges', 'Medicine Sales',
    'Total Revenue', 'Material Cost', 'Lab Cost', 'Special Doctor Cost', 'MLS Total', 'Doctor RF', 'Direct Cost', 'Contribution', 'Contribution Margin'
  ];
  const groupedDetailRows = groupMonthlyReportDetailRows(report.rows);
  const detailData = groupedDetailRows.map(row => [
    row.date, row.patientName, row.age ?? '', row.phone, row.city, row.township, row.patientType, row.treatment, row.doctor,
    row.standardCost, row.discount, row.cost, row.payment, row.balance, row.serviceCharges, row.medicineSales, row.totalRevenue,
    row.materialCost, row.labCost, row.specialDoctorCost, row.mlsTotal, row.doctorCost, row.totalCost, row.netProfit, row.netMargin
  ]);
  const detailRows: Array<Array<string | number>> = [
    ['TREATMENT DETAIL', ...Array(24).fill('')],
    [reportSubtitle(metadata), ...Array(24).fill('')],
    ['', ...Array(24).fill('')],
    detailHeaders,
    ...detailData,
    ['REPORT TOTAL', '', '', '', '', '', '', '', '', report.summary.standardProduction, report.summary.discount, report.summary.production,
      report.summary.payment, report.summary.balance, report.summary.serviceCharges, report.summary.medicineSales, report.summary.totalRevenue,
      report.summary.materialCost, report.summary.labCost, report.summary.specialDoctorCost, report.summary.mlsTotal, report.summary.doctorCost,
      directCostTotal, contributionTotal, report.summary.totalRevenue > 0 ? contributionTotal / report.summary.totalRevenue : 0]
  ];
  const detailSheet: any = XLSX.utils.aoa_to_sheet(detailRows);
  detailSheet['!merges'] = [XLSX.utils.decode_range('A1:Y1'), XLSX.utils.decode_range('A2:Y2')];
  configureTableSheet(detailSheet, 4, detailData.length, 'Y', [15, 25, 8, 18, 18, 18, 18, 32, 24, 18, 16, 20, 19, 20, 17, 17, 18, 16, 16, 18, 16, 16, 16, 16, 14]);
  setNumberFormat(XLSX, detailSheet, 5, 5 + detailData.length, [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], currency);
  setNumberFormat(XLSX, detailSheet, 5, 5 + detailData.length, [24], '0.0%');
  styleReportBanner(XLSX, detailSheet, 'Y');
  styleTable(XLSX, detailSheet, 4, detailData.length, 5 + detailData.length, 'Y', [2, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24], [2]);
  groupedDetailRows.forEach((row, index) => styleProfitCell(detailSheet, `X${5 + index}`, row.netProfit));
  styleProfitCell(detailSheet, `X${5 + detailData.length}`, contributionTotal, true);
  XLSX.utils.book_append_sheet(workbook, detailSheet, 'Treatment Detail');

  const appendGroupSheet = (name: string, title: string, categoryHeader: string, groups: MonthlyReportGroup[]) => {
    const groupData = groups.map(group => [
      group.name, group.treatments, group.patients, group.discount, group.production, group.payment, group.serviceCharges,
      group.medicineSales, group.totalRevenue, group.mlsTotal, group.totalCost, group.netProfit, group.netMargin
    ]);
    const rows: Array<Array<string | number>> = [
      [title, ...Array(12).fill('')],
      [reportSubtitle(metadata), ...Array(12).fill('')],
      ['', ...Array(12).fill('')],
      [categoryHeader, 'Treatments', 'Distinct Patients', 'Discount', 'Treatment Production', 'Collected Payment', 'Service Charges', 'Medicine Sales', 'Total Revenue', 'MLS Total', 'Direct Cost', 'Contribution', 'Contribution Margin'],
      ...groupData,
      ['REPORT TOTAL', report.summary.treatmentCount, report.summary.patientCount, report.summary.discount, report.summary.production,
        report.summary.payment, report.summary.serviceCharges, report.summary.medicineSales, report.summary.totalRevenue,
        report.summary.mlsTotal, directCostTotal, contributionTotal,
        report.summary.totalRevenue > 0 ? contributionTotal / report.summary.totalRevenue : 0]
    ];
    const sheet: any = XLSX.utils.aoa_to_sheet(rows);
    sheet['!merges'] = [XLSX.utils.decode_range('A1:M1'), XLSX.utils.decode_range('A2:M2')];
    configureTableSheet(sheet, 4, groupData.length, 'M', [34, 13, 18, 16, 21, 19, 17, 17, 18, 16, 16, 16, 14]);
    setNumberFormat(XLSX, sheet, 5, 5 + groupData.length, [3, 4, 5, 6, 7, 8, 9, 10, 11], currency);
    setNumberFormat(XLSX, sheet, 5, 5 + groupData.length, [12], '0.0%');
    styleReportBanner(XLSX, sheet, 'M');
    styleTable(XLSX, sheet, 4, groupData.length, 5 + groupData.length, 'M', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [1, 2]);
    groups.forEach((group, index) => styleProfitCell(sheet, `L${5 + index}`, group.netProfit));
    styleProfitCell(sheet, `L${5 + groupData.length}`, contributionTotal, true);
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  };

  appendGroupSheet('By Treatment', 'TREATMENT PERFORMANCE', 'Treatment Category', report.byTreatment);
  appendGroupSheet('By Clinician', 'CLINICIAN PERFORMANCE', 'Clinician', report.byDoctor);
  appendGroupSheet('By Patient Type', 'PATIENT TYPE PERFORMANCE', 'Patient Type', report.byPatientType);
  const expenseRows = (report.expenses || []).map(expense => [expense.date, expense.category, expense.description, expense.amount]);
  const expenseSheet: any = XLSX.utils.aoa_to_sheet([
    ['OPERATING EXPENSES', '', '', ''],
    [reportSubtitle(metadata), '', '', ''],
    ['', '', '', ''],
    ['Date', 'Category', 'Description', 'Amount'],
    ...expenseRows,
    ['REPORT TOTAL', '', '', report.summary.operatingExpenses]
  ]);
  expenseSheet['!merges'] = [XLSX.utils.decode_range('A1:D1'), XLSX.utils.decode_range('A2:D2')];
  configureTableSheet(expenseSheet, 4, expenseRows.length, 'D', [15, 24, 50, 18]);
  setNumberFormat(XLSX, expenseSheet, 5, 5 + expenseRows.length, [3], currency);
  styleReportBanner(XLSX, expenseSheet, 'D');
  styleTable(XLSX, expenseSheet, 4, expenseRows.length, 5 + expenseRows.length, 'D', [3]);
  XLSX.utils.book_append_sheet(workbook, expenseSheet, 'Operating Expenses');
  return workbook;
};

export const exportMonthlyReportToExcel = async (report: MonthlyReport, metadata: MonthlyReportMetadata) => {
  const XLSX = await import('xlsx-js-style');
  const workbook = await buildMonthlyReportExcelWorkbook(report, metadata);
  XLSX.writeFile(workbook, monthlyReportFilename(metadata, 'xlsx'), { compression: true, cellStyles: true });
};
