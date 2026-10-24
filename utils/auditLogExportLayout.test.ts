import { describe, expect, it } from 'vitest';
import { buildWorksheet, EXCEL_HEADER_ROW_HEIGHT_POINTS } from './excelExport';
import { AUDIT_LOG_PDF_COLUMN_WIDTHS, AUDIT_LOG_PDF_TABLE_WIDTH } from './pdfExport';

describe('audit log export table layout', () => {
  it('keeps every PDF column within the declared landscape table width', () => {
    expect(AUDIT_LOG_PDF_COLUMN_WIDTHS).toHaveLength(12);
    expect(AUDIT_LOG_PDF_COLUMN_WIDTHS.reduce((sum, width) => sum + width, 0)).toBe(AUDIT_LOG_PDF_TABLE_WIDTH);
    expect(AUDIT_LOG_PDF_TABLE_WIDTH).toBeLessThanOrEqual(269);
    expect(AUDIT_LOG_PDF_COLUMN_WIDTHS[11]).toBeGreaterThanOrEqual(20);
  });

  it('uses a compact non-wrapping Excel header row', async () => {
    const columns = [
      { header: 'Service Charges', width: 18 },
      { header: 'Doctor Earned', width: 18 }
    ];
    const { worksheet } = await buildWorksheet([], columns, 'MMK', { compactHeader: true, freezeHeader: true });

    expect(worksheet['!rows']?.[0]?.hpt).toBe(EXCEL_HEADER_ROW_HEIGHT_POINTS);
    expect(worksheet.A1.s?.alignment).toMatchObject({ vertical: 'center', wrapText: false });
    expect(worksheet.B1.s?.alignment).toMatchObject({ vertical: 'center', wrapText: false });
    expect(worksheet['!cols']).toEqual([{ wch: 18 }, { wch: 18 }]);
    expect(worksheet['!freeze']).toMatchObject({ ySplit: 1, topLeftCell: 'A2' });
  });
});
