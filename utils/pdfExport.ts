import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Patient, Appointment, AppointmentRescheduleLog, ClinicalRecord, Doctor, Medicine, MedicineSale, Expense, PaymentRecord } from '../types';
import { formatCurrency, Currency } from './currency';
import { usesFlatVisitCommission } from './doctorCommission';
import { formatTeethWithPosition } from './toothNumbering';
import { buildAuditLogExportTableRows, buildAuditLogRows, filterAuditLogRowsForExport, type AuditLogFilterOptions } from './auditLogExport';
import { formatDoctorName, normalizeDoctorName } from './doctorName';
import { buildRecallsCancelsExportRows, type RecallsCancelsExportRow } from './recallsCancels';
import { buildPatientReport } from './patientReport';
import { buildPatientReportPdfData } from './patientReportExport';

export const RECALLS_CANCELS_PDF_TABLE_WIDTH = 252;
export const RECALLS_CANCELS_PDF_COLUMN_WIDTHS = [16, 12, 23, 18, 17, 17, 21, 22, 30, 36, 20, 20] as const;
export const RECALLS_CANCELS_PDF_HEADERS = ['Date', 'Time', 'Patient', 'Type', 'Phone', 'Source', 'Appt.', 'Doctor', 'Focus', 'Notes', 'Status', 'Done date'] as const;

// Add type declaration for jsPDF with autoTable
declare module 'jspdf' {
  interface jsPDF {
    autoTable: typeof autoTable;
  }
}

const formatPatientAddressForExport = (patient: Patient) => {
  return [patient.address, patient.township, patient.city].filter(Boolean).join(', ') || '-';
};

const getPatientRecordsForExport = (patientId: string, records: ClinicalRecord[] = []) => {
  return records
    .filter((record) => record.patient_id === patientId)
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
};

const summarizeTreatmentsForExport = (records: ClinicalRecord[]) => {
  const treatments = records.map((record) => record.description?.trim()).filter(Boolean);
  if (treatments.length === 0) return '-';
  const visibleTreatments = treatments.slice(0, 3).join(', ');
  return treatments.length > 3 ? `${visibleTreatments} +${treatments.length - 3} more` : visibleTreatments;
};

const summarizeDoctorsForExport = (records: ClinicalRecord[]) => {
  const doctors = Array.from(new Set(records.map((record) => normalizeDoctorName(record.doctor_name)).filter(Boolean)));
  if (doctors.length === 0) return '-';
  const visibleDoctors = doctors.slice(0, 2).map((doctor) => formatDoctorName(doctor)).join(', ');
  return doctors.length > 2 ? `${visibleDoctors} +${doctors.length - 2} more` : visibleDoctors;
};

const getAutoTableEndY = (doc: jsPDF, fallback: number): number => {
  const finalY = Number((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY);
  return Number.isFinite(finalY) ? finalY : fallback;
};

const addPatientReportSectionTitle = (doc: jsPDF, title: string, requestedY: number): number => {
  const pageHeight = doc.internal.pageSize.height;
  let y = requestedY;
  if (y > pageHeight - 24) {
    doc.addPage();
    y = 18;
  }
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(title, 14, y);
  return y + 4;
};

export interface AboutPatientPdfInput {
  patient: Patient;
  appointments: Appointment[];
  treatments: ClinicalRecord[];
  medicineSales: MedicineSale[];
  payments: PaymentRecord[];
  paymentsAvailable: boolean;
  doctors: Doctor[];
  currency: Currency;
}

export const buildAboutPatientPdf = ({
  patient,
  appointments,
  treatments,
  medicineSales,
  payments,
  paymentsAvailable,
  doctors,
  currency
}: AboutPatientPdfInput): { doc: jsPDF; filename: string } => {
  const report = buildPatientReport({ patient, appointments, treatments, medicineSales, payments, paymentsAvailable, doctors, currency });
  const exportData = buildPatientReportPdfData(patient, report, currency);
  const doc = new jsPDF('l', 'mm', 'a4');

  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text('About This Patient Report', 14, 18);
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  exportData.patientLines.forEach((line, index) => doc.text(line, 14, 26 + (index * 5)));
  doc.text(`Generated: ${new Date().toLocaleString()}`, 190, 26);

  autoTable(doc, {
    startY: 44,
    head: [['Summary', 'Value']],
    body: exportData.summaryRows,
    theme: 'grid',
    tableWidth: 104,
    headStyles: { fillColor: [15, 23, 42], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, cellPadding: 1.8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold' }, 1: { cellWidth: 52, halign: 'right' } },
    margin: { left: 14, right: 14, bottom: 16 }
  });

  let startY = addPatientReportSectionTitle(doc, 'Treatment Amounts and Payments', getAutoTableEndY(doc, 44) + 10);
  autoTable(doc, {
    startY,
    head: [['Date', 'Treatment', 'Teeth', 'Clinician', 'Amount', 'Paid', 'Remaining', 'Payment Dates and Details']],
    body: exportData.treatmentRows.length ? exportData.treatmentRows : [['-', 'No treatments recorded', '-', '-', '-', '-', '-', '-']],
    theme: 'grid',
    tableWidth: 215,
    showHead: 'everyPage',
    headStyles: { fillColor: [2, 132, 199], fontSize: 7, fontStyle: 'bold' },
    bodyStyles: { fontSize: 6.8, cellPadding: 1.5, overflow: 'linebreak', valign: 'top' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 16 }, 1: { cellWidth: 28 }, 2: { cellWidth: 25 }, 3: { cellWidth: 24 },
      4: { cellWidth: 20, halign: 'right' }, 5: { cellWidth: 20, halign: 'right' },
      6: { cellWidth: 20, halign: 'right' }, 7: { cellWidth: 62 }
    },
    margin: { left: 14, right: 14, bottom: 16 }
  });

  startY = addPatientReportSectionTitle(doc, 'Payment History', getAutoTableEndY(doc, startY) + 10);
  autoTable(doc, {
    startY,
    head: [['Payment Date', 'Method', 'Receipt', 'Amount', 'Patient Balance After']],
    body: exportData.paymentRows === null
      ? [['Restricted', 'Restricted', 'Restricted', 'Restricted', 'Restricted']]
      : exportData.paymentRows.length ? exportData.paymentRows : [['-', 'No payments recorded', '-', '-', '-']],
    theme: 'grid',
    tableWidth: 215,
    showHead: 'everyPage',
    headStyles: { fillColor: [5, 150, 105], fontSize: 7.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.2, cellPadding: 1.6, overflow: 'linebreak' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 56 }, 2: { cellWidth: 48 }, 3: { cellWidth: 38, halign: 'right' }, 4: { cellWidth: 47, halign: 'right' } },
    margin: { left: 14, right: 14, bottom: 16 }
  });

  startY = addPatientReportSectionTitle(doc, 'Appointment History', getAutoTableEndY(doc, startY) + 10);
  autoTable(doc, {
    startY,
    head: [['Date', 'Time', 'Type', 'Clinician', 'Status', 'Notes']],
    body: exportData.appointmentRows.length ? exportData.appointmentRows : [['-', '-', 'No appointments recorded', '-', '-', '-']],
    theme: 'grid',
    tableWidth: 215,
    showHead: 'everyPage',
    headStyles: { fillColor: [79, 70, 229], fontSize: 7.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.2, cellPadding: 1.6, overflow: 'linebreak', valign: 'top' },
    columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 18 }, 2: { cellWidth: 36 }, 3: { cellWidth: 40 }, 4: { cellWidth: 26 }, 5: { cellWidth: 71 } },
    margin: { left: 14, right: 14, bottom: 16 }
  });

  startY = addPatientReportSectionTitle(doc, 'Medicine Summary', getAutoTableEndY(doc, startY) + 10);
  autoTable(doc, {
    startY,
    head: [['Medicine / Item', 'Quantity', 'Total', 'Dates']],
    body: exportData.medicineRows.length ? exportData.medicineRows : [['No medicines recorded', '-', '-', '-']],
    theme: 'grid',
    tableWidth: 215,
    showHead: 'everyPage',
    headStyles: { fillColor: [5, 150, 105], fontSize: 7.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.2, cellPadding: 1.6, overflow: 'linebreak' },
    columnStyles: { 0: { cellWidth: 65 }, 1: { cellWidth: 38 }, 2: { cellWidth: 47, halign: 'right' }, 3: { cellWidth: 65 } },
    margin: { left: 14, right: 14, bottom: 16 }
  });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(exportData.accessNote, 14, doc.internal.pageSize.height - 8);
    doc.text(`Page ${page} of ${pageCount}`, doc.internal.pageSize.width - 14, doc.internal.pageSize.height - 8, { align: 'right' });
  }

  return { doc, filename: exportData.filename };
};

export const exportAboutPatientToPDF = (input: AboutPatientPdfInput) => {
  const { doc, filename } = buildAboutPatientPdf(input);
  doc.save(filename);
};

export const exportPatientsToPDF = (patients: Patient[], currency: Currency, treatmentRecords: ClinicalRecord[] = []) => {
  // Export the patient list currently supplied by the patient tab, including related clinical columns.
  const exportPatients = patients;
  const doc = new jsPDF('l', 'mm', 'a4'); // Landscape orientation
  
  // Header
  doc.setFontSize(18);
  doc.setTextColor(40, 40, 40);
  doc.text('Patient Directory Report', 14, 20);
  
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
  doc.text(`Total Patients: ${patients.length}`, 14, 34);
  
  // Table
  autoTable(doc, {
    startY: 40,
    head: [['No', 'Patient ID', 'Patient Name', 'Date', 'Age', 'Type', 'Contact', 'Address', 'Treatment', 'Doctor', 'Balance', 'Points', 'Portal']],
    body: exportPatients.map((patient, index) => {
      const patientRecords = getPatientRecordsForExport(patient.id, treatmentRecords);
      return [
        index + 1,
        patient.patient_unique_id || patient.id.substring(0, 8),
        patient.name,
        patient.created_at ? new Date(patient.created_at).toLocaleDateString() : '-',
        patient.age ?? '-',
        patient.patient_type || '-',
        [patient.phone, patient.email].filter(Boolean).join('\n') || '-',
        formatPatientAddressForExport(patient),
        summarizeTreatmentsForExport(patientRecords),
        summarizeDoctorsForExport(patientRecords),
        formatCurrency(patient.balance || 0, currency),
        patient.loyalty_points || 0,
        patient.has_account ? 'Active' : 'No Access'
      ];
    }),
    theme: 'grid',
    headStyles: { fillColor: [79, 70, 229], fontSize: 7, fontStyle: 'bold' },
    bodyStyles: { fontSize: 6.5, cellPadding: 1.5, overflow: 'linebreak' },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { top: 40 },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 18 },
      2: { cellWidth: 28 },
      3: { cellWidth: 18 },
      4: { cellWidth: 10 },
      5: { cellWidth: 16 },
      6: { cellWidth: 28 },
      7: { cellWidth: 34 },
      8: { cellWidth: 42 },
      9: { cellWidth: 28 },
      10: { cellWidth: 20 },
      11: { cellWidth: 12 },
      12: { cellWidth: 18 }
    }
  });
  
  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 10, { align: 'center' });
  }
  
  doc.save(`patient-directory-${new Date().toISOString().split('T')[0]}.pdf`);
};

export const exportAppointmentsToPDF = (appointments: Appointment[]) => {
  // Use all appointments for export (not just filtered/paginated view)
  const exportAppointments = appointments;
  const doc = new jsPDF();
  
  // Header
  doc.setFontSize(18);
  doc.setTextColor(40, 40, 40);
  doc.text('Appointments Report', 14, 20);
  
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
  doc.text(`Total Appointments: ${appointments.length}`, 14, 34);
  
  // Upcoming Appointments
  const upcoming = exportAppointments.filter(apt => {
    const aptDate = new Date(apt.date);
    return aptDate >= new Date() && apt.status === 'Scheduled';
  }).sort((a, b) => a.date.localeCompare(b.date));
  
  if (upcoming.length > 0) {
    doc.setFontSize(12);
    doc.setTextColor(40, 40, 40);
    doc.text('Upcoming Appointments', 14, 42);
    
    autoTable(doc, {
      startY: 46,
      head: [['Date', 'Time', 'Patient', 'Contact', 'Type', 'Doctor', 'Status']],
      body: upcoming.map(apt => [
        new Date(apt.date).toLocaleDateString(),
        apt.time,
        apt.patient_name || 'Unknown',
        apt.patient_id ? 'Registered' : [apt.guest_phone, apt.guest_source].filter(Boolean).join(' / ') || 'Lead',
        apt.type || 'Checkup',
        formatDoctorName(apt.doctor_name, 'N/A'),
        apt.status
      ]),
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229], fontSize: 9, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [245, 247, 250] }
    });
  }
  
  // Past Appointments
  const past = exportAppointments.filter(apt => {
    const aptDate = new Date(apt.date);
    return aptDate < new Date() || apt.status !== 'Scheduled';
  }).sort((a, b) => b.date.localeCompare(a.date));
  
  if (past.length > 0) {
    const startY = upcoming.length > 0 ? (doc as any).lastAutoTable.finalY + 10 : 46;
    
    doc.setFontSize(12);
    doc.setTextColor(40, 40, 40);
    doc.text('Past Appointments', 14, startY);
    
    autoTable(doc, {
      startY: startY + 4,
      head: [['Date', 'Time', 'Patient', 'Contact', 'Type', 'Status']],
      body: past.map(apt => [
        new Date(apt.date).toLocaleDateString(),
        apt.time,
        apt.patient_name || 'Unknown',
        apt.patient_id ? 'Registered' : [apt.guest_phone, apt.guest_source].filter(Boolean).join(' / ') || 'Lead',
        apt.type || 'Checkup',
        apt.status
      ]),
      theme: 'grid',
      headStyles: { fillColor: [107, 114, 128], fontSize: 9, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [245, 247, 250] }
    });
  }
  
  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 10, { align: 'center' });
  }
  
  doc.save(`appointments-report-${new Date().toISOString().split('T')[0]}.pdf`);
};

export const exportRecallsCancelsToPDF = (
  appointments: Appointment[],
  todayKey: string,
  locationName: string
) => {
  const sections = buildRecallsCancelsExportRows(appointments, todayKey);
  const total = sections.recalls.length + sections.late.length + sections.cancelled.length + sections.noShow.length + sections.rescheduled.length + sections.completedLater.length;
  const doc = new jsPDF('l', 'mm', 'a4');

  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  doc.text('Recalls & Cancels Report', 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Scope: ${locationName}`, 14, 26);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 32);
  doc.text(
    `Recalls: ${sections.recalls.length} | Late: ${sections.late.length} | Follow-up: ${sections.cancelled.length} | No Show: ${sections.noShow.length} | Rescheduled: ${sections.rescheduled.length} | Completed Later: ${sections.completedLater.length} | Total: ${total}`,
    14,
    38
  );

  const tableHeaders = [[...RECALLS_CANCELS_PDF_HEADERS]];
  const tableBody = (rows: RecallsCancelsExportRow[]) => rows.map(row => [
    row.date,
    row.time || '-',
    row.patient,
    row.patientType,
    row.phone || '-',
    row.source,
    row.appointmentType,
    row.doctor,
    row.clinicalFocus || '-',
    row.notes || '-',
    row.cancellationOutcome ? row.cancellationOutcome.replaceAll('_', ' ') : '-',
    row.completedLaterDate || '-'
  ]);
  const sectionDefinitions: Array<{
    title: string;
    rows: RecallsCancelsExportRow[];
    color: [number, number, number];
  }> = [
    { title: 'Upcoming Recalls', rows: sections.recalls, color: [5, 150, 105] },
    { title: 'Late / No-show', rows: sections.late, color: [217, 119, 6] },
    { title: 'Cancelled - Needs Follow-up', rows: sections.cancelled, color: [225, 29, 72] },
    { title: 'Cancelled - No Show', rows: sections.noShow, color: [217, 119, 6] },
    { title: 'Cancelled - Rescheduled', rows: sections.rescheduled, color: [5, 150, 105] },
    { title: 'Cancelled - Completed Later', rows: sections.completedLater, color: [5, 150, 105] }
  ];

  let startY = 47;
  sectionDefinitions.forEach((section, index) => {
    if (index > 0 && startY > 165) {
      doc.addPage();
      startY = 18;
    }

    doc.setFontSize(12);
    doc.setTextColor(...section.color);
    doc.text(`${section.title} (${section.rows.length})`, 14, startY);
    autoTable(doc, {
      startY: startY + 4,
      head: tableHeaders.map((row) => Array.from(row)),
      body: section.rows.length > 0 ? tableBody(section.rows) : [['No records', '', '', '', '', '', '', '', '', '', '', '']],
      theme: 'grid',
      headStyles: {
        fillColor: section.color,
        fontSize: 6.5,
        fontStyle: 'bold',
        cellPadding: 1.2,
        overflow: 'ellipsize',
        valign: 'middle'
      },
      bodyStyles: { fontSize: 7, textColor: [51, 65, 85], cellPadding: 2, overflow: 'linebreak' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14, bottom: 18 },
      columnStyles: {
        0: { cellWidth: RECALLS_CANCELS_PDF_COLUMN_WIDTHS[0] }, 1: { cellWidth: RECALLS_CANCELS_PDF_COLUMN_WIDTHS[1] },
        2: { cellWidth: RECALLS_CANCELS_PDF_COLUMN_WIDTHS[2] }, 3: { cellWidth: RECALLS_CANCELS_PDF_COLUMN_WIDTHS[3] },
        4: { cellWidth: RECALLS_CANCELS_PDF_COLUMN_WIDTHS[4] }, 5: { cellWidth: RECALLS_CANCELS_PDF_COLUMN_WIDTHS[5] },
        6: { cellWidth: RECALLS_CANCELS_PDF_COLUMN_WIDTHS[6] }, 7: { cellWidth: RECALLS_CANCELS_PDF_COLUMN_WIDTHS[7] },
        8: { cellWidth: RECALLS_CANCELS_PDF_COLUMN_WIDTHS[8] }, 9: { cellWidth: RECALLS_CANCELS_PDF_COLUMN_WIDTHS[9] },
        10: { cellWidth: RECALLS_CANCELS_PDF_COLUMN_WIDTHS[10] }, 11: { cellWidth: RECALLS_CANCELS_PDF_COLUMN_WIDTHS[11] }
      }
    });
    startY = (doc as any).lastAutoTable.finalY + 10;
  });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Recalls & Cancels | ${locationName}`, 14, doc.internal.pageSize.height - 9);
    doc.text(`Page ${page} of ${pageCount}`, doc.internal.pageSize.width - 14, doc.internal.pageSize.height - 9, { align: 'right' });
  }

  doc.save(`recalls-cancels-${todayKey}.pdf`);
};

interface ClinicalRecordsExportOptions extends AuditLogFilterOptions {
  appointments?: Appointment[];
  payments?: PaymentRecord[];
  rescheduleLogs?: AppointmentRescheduleLog[];
  includeAppointments?: boolean;
}

export const AUDIT_LOG_PDF_TABLE_WIDTH = 260;
export const AUDIT_LOG_PDF_COLUMN_WIDTHS = [15, 23, 26, 24, 50, 24, 21, 17, 17, 21, 22] as const;

export const exportClinicalRecordsToPDF = (records: ClinicalRecord[], currency: Currency, options: ClinicalRecordsExportOptions = {}) => {
  const exportRows = filterAuditLogRowsForExport(
    buildAuditLogRows(records, options.appointments || [], options.includeAppointments ?? false, options.payments || [], options.rescheduleLogs || []),
    options
  );
  const tableRows = buildAuditLogExportTableRows(exportRows, currency);
  const doc = new jsPDF('l', 'mm', 'a4');
  
  // Header
  doc.setFontSize(18);
  doc.setTextColor(40, 40, 40);
  doc.text(options.includeAppointments ? 'Clinical Audit Trail Report' : 'Clinical Records Audit Report', 14, 20);
  
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
  doc.text(`Visible Entries: ${exportRows.length}`, 14, 34);
  if (options.dateFrom && options.dateTo) {
    doc.text(`Date Range: ${options.dateFrom} to ${options.dateTo}`, 14, 40);
  }
  
  const netTreatmentCharges = tableRows
    .filter((row) => row.type === 'Treatment')
    .reduce((sum, row) => sum + (row.amount || 0), 0);
  doc.text(`Net Treatment Charges: ${formatCurrency(netTreatmentCharges, currency)}`, 14, options.dateFrom && options.dateTo ? 46 : 40);
  
  // Table
  autoTable(doc, {
    startY: options.dateFrom && options.dateTo ? 52 : 46,
    head: [['Type', 'Date / Time', 'Patient', 'Clinician', 'Clinical Activity', 'Patient Type', 'Patient Balance', 'Amount', 'Discount', 'Service Charges', 'Doctor Earned']],
    body: tableRows.map((row) => [
      row.type,
      row.dateTime,
      row.patient,
      row.clinician,
      row.activity,
      row.patientType,
      row.patientBalance,
      row.amount === null ? '-' : formatCurrency(row.amount, currency),
      row.discount === null ? '-' : `-${formatCurrency(row.discount, currency)}`,
      row.serviceCharges === null ? '-' : formatCurrency(row.serviceCharges, currency),
      row.doctorEarned === null ? '-' : formatCurrency(row.doctorEarned, currency)
    ]),
    theme: 'grid',
    tableWidth: AUDIT_LOG_PDF_TABLE_WIDTH,
    headStyles: { fillColor: [79, 70, 229], fontSize: 7, fontStyle: 'bold', cellPadding: 1.2, valign: 'middle', overflow: 'linebreak' },
    bodyStyles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: AUDIT_LOG_PDF_COLUMN_WIDTHS[0] },
      1: { cellWidth: AUDIT_LOG_PDF_COLUMN_WIDTHS[1] },
      2: { cellWidth: AUDIT_LOG_PDF_COLUMN_WIDTHS[2] },
      3: { cellWidth: AUDIT_LOG_PDF_COLUMN_WIDTHS[3] },
      4: { cellWidth: AUDIT_LOG_PDF_COLUMN_WIDTHS[4] },
      5: { cellWidth: AUDIT_LOG_PDF_COLUMN_WIDTHS[5] },
      6: { cellWidth: AUDIT_LOG_PDF_COLUMN_WIDTHS[6], halign: 'right' },
      7: { cellWidth: AUDIT_LOG_PDF_COLUMN_WIDTHS[7], halign: 'right', fontStyle: 'bold' },
      8: { cellWidth: AUDIT_LOG_PDF_COLUMN_WIDTHS[8], halign: 'right', fontStyle: 'bold' },
      9: { cellWidth: AUDIT_LOG_PDF_COLUMN_WIDTHS[9], halign: 'right', fontStyle: 'bold' },
      10: { cellWidth: AUDIT_LOG_PDF_COLUMN_WIDTHS[10], halign: 'right', fontStyle: 'bold' }
    }
  });
  
  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 10, { align: 'center' });
  }
  
  doc.save(`${options.includeAppointments ? 'clinic-audit-logs' : 'clinical-records'}-${new Date().toISOString().split('T')[0]}.pdf`);
};

export const exportDoctorsToPDF = (doctors: Doctor[]) => {
  // Use all doctors for export (not just filtered/paginated view)
  const exportDoctors = doctors;
  const doc = new jsPDF();
  
  // Header
  doc.setFontSize(18);
  doc.setTextColor(40, 40, 40);
  doc.text('Doctors Directory Report', 14, 20);
  
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
  doc.text(`Total Doctors: ${doctors.length}`, 14, 34);
  
  // Table
  autoTable(doc, {
    startY: 40,
    head: [['Doctor Name', 'Specialization', 'Method', 'Commission', 'Contact', 'Email']],
    body: exportDoctors.map(doctor => [
      formatDoctorName(doctor.name, 'N/A'),
      doctor.specialization || 'General',
      usesFlatVisitCommission({ commissionType: doctor.commission_type, specialization: doctor.specialization }) ? 'Fixed/visit' : 'Percentage',
      usesFlatVisitCommission({ commissionType: doctor.commission_type, specialization: doctor.specialization }) ? `${doctor.commission_per_visit || 0}/visit` : (doctor.commission_percentage != null ? `${doctor.commission_percentage}%` : '0%'),
      doctor.phone || 'N/A',
      doctor.email || 'N/A'
    ]),
    theme: 'grid',
    headStyles: { fillColor: [79, 70, 229], fontSize: 10, fontStyle: 'bold' },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [245, 247, 250] }
  });
  
  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 10, { align: 'center' });
  }
  
  doc.save(`doctors-directory-${new Date().toISOString().split('T')[0]}.pdf`);
};

export const exportInventoryToPDF = (medicines: Medicine[], currency: Currency) => {
  // Use all medicines for export (not just filtered/paginated view)
  const exportMedicines = medicines;
  const doc = new jsPDF();
  
  // Header
  doc.setFontSize(18);
  doc.setTextColor(40, 40, 40);
  doc.text('Medicine Inventory Report', 14, 20);
  
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
  doc.text(`Total Items: ${medicines.length}`, 14, 34);
  
  const totalValue = medicines.reduce((sum, med) => sum + ((med.price || 0) * (med.stock || 0)), 0);
  doc.text(`Total Inventory Value: ${formatCurrency(totalValue, currency)}`, 14, 40);
  
  // Low Stock Items
  const lowStock = medicines.filter(med => med.min_stock !== undefined && med.stock <= med.min_stock);
  if (lowStock.length > 0) {
    doc.setFontSize(10);
    doc.setTextColor(220, 38, 38);
    doc.text(`⚠ ${lowStock.length} item(s) low in stock`, 14, 46);
  }
  
  // Table
  autoTable(doc, {
    startY: 52,
    head: [['Medicine', 'Category', 'Unit', 'Price', 'Stock', 'Min Stock', 'Value']],
    body: exportMedicines.map(med => [
      med.name,
      med.category || 'N/A',
      med.unit,
      formatCurrency(med.price || 0, currency),
      `${med.stock} ${med.unit}`,
      med.min_stock !== undefined ? `${med.min_stock} ${med.unit}` : 'N/A',
      formatCurrency((med.price || 0) * (med.stock || 0), currency)
    ]),
    theme: 'grid',
    headStyles: { fillColor: [79, 70, 229], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      3: { halign: 'right' },
      6: { halign: 'right', fontStyle: 'bold' }
    }
  });
  
  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 10, { align: 'center' });
  }
  
  doc.save(`inventory-report-${new Date().toISOString().split('T')[0]}.pdf`);
};

export const exportExpensesToPDF = (expenses: Expense[], currency: Currency) => {
  const exportExpenses = expenses;
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.setTextColor(40, 40, 40);
  doc.text('Expense Report', 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
  doc.text(`Total Expenses: ${expenses.length}`, 14, 34);

  const total = exportExpenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
  doc.text(`Total Amount: ${formatCurrency(total, currency)}`, 14, 40);

  autoTable(doc, {
    startY: 46,
    head: [['Date', 'Description', 'Category', 'Amount']],
    body: exportExpenses.map(expense => [
      expense.date,
      expense.description,
      expense.category,
      formatCurrency(expense.amount || 0, currency)
    ]),
    theme: 'grid',
    headStyles: { fillColor: [79, 70, 229], fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      3: { halign: 'right', fontStyle: 'bold' }
    }
  });

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 10, { align: 'center' });
  }

  doc.save(`expense-report-${new Date().toISOString().split('T')[0]}.pdf`);
};

