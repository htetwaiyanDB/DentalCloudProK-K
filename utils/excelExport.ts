import { Appointment, AppointmentRescheduleLog, ClinicalRecord, Doctor, Expense, Medicine, Patient, PaymentRecord } from '../types';
import { Currency } from './currency';
import { usesFlatVisitCommission } from './doctorCommission';
import { buildAuditLogExportTableRows, buildAuditLogRows, filterAuditLogRowsForExport, type AuditLogFilterOptions } from './auditLogExport';
import { formatAppointmentNotesForDisplay } from './appointmentClinicalFocus';
import { formatDoctorName, normalizeDoctorName } from './doctorName';
import { buildRecallsCancelsExportRows, type RecallsCancelsExportRow } from './recallsCancels';

type ExcelPrimitive = string | number;
type ExcelRow = Record<string, ExcelPrimitive>;
type ColumnFormat = 'text' | 'integer' | 'currency';

interface ExcelColumn {
  header: string;
  width?: number;
  format?: ColumnFormat;
}

const getCurrencyNumberFormat = (currency: Currency) => {
  return currency === 'MMK' ? '#,##0"Ks"' : '$#,##0.00';
};

const applyColumnFormatting = (
  worksheet: Record<string, any>,
  columns: ExcelColumn[],
  rowCount: number,
  currency: Currency
) => {
  columns.forEach((column, columnIndex) => {
    if (!column.format || rowCount === 0) return;

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const cellAddress = `${String.fromCharCode(65 + columnIndex)}${rowIndex + 2}`;
      const cell = worksheet[cellAddress];

      if (!cell || cell.t !== 'n') continue;

      if (column.format === 'currency') {
        cell.z = getCurrencyNumberFormat(currency);
      }

      if (column.format === 'integer') {
        cell.z = '#,##0';
      }
    }
  });
};

export const EXCEL_HEADER_ROW_HEIGHT_POINTS = 20;
export const RECALLS_CANCELS_EXCEL_HEADERS = ['Date', 'Time', 'Patient', 'Type', 'Phone', 'Source', 'Appt.', 'Doctor', 'Focus', 'Notes', 'Status', 'Done date'] as const;
export const RECALLS_CANCELS_EXCEL_COLUMN_WIDTHS = [14, 10, 26, 16, 18, 18, 20, 22, 30, 38, 18, 16] as const;

interface WorksheetLayoutOptions {
  compactHeader?: boolean;
  freezeHeader?: boolean;
}

export const buildWorksheet = async (
  rows: ExcelRow[],
  columns: ExcelColumn[],
  currency: Currency,
  layout: WorksheetLayoutOptions = {}
) => {
  const XLSX = await import('xlsx');
  const headers = columns.map(column => column.header);
  const worksheet = XLSX.utils.aoa_to_sheet([headers]);

  if (rows.length > 0) {
    XLSX.utils.sheet_add_json(worksheet, rows, {
      header: headers,
      skipHeader: true,
      origin: 'A2'
    });
  }

  worksheet['!cols'] = columns.map((column) => {
    if (column.width) return { wch: column.width };

    const valueLength = rows.reduce((max, row) => {
      const value = row[column.header];
      return Math.max(max, String(value ?? '').length);
    }, column.header.length);

    return { wch: Math.min(Math.max(valueLength + 2, 12), 40) };
  });
  if (layout.compactHeader) {
    worksheet['!rows'] = [{ hpt: EXCEL_HEADER_ROW_HEIGHT_POINTS }];
    headers.forEach((_, columnIndex) => {
      const cellAddress = `${String.fromCharCode(65 + columnIndex)}1`;
      const cell = worksheet[cellAddress];
      if (!cell) return;
      cell.s = {
        ...(cell.s || {}),
        alignment: { ...(cell.s?.alignment || {}), vertical: 'center', wrapText: false }
      };
    });
  }

  if (headers.length > 0) {
    const lastColumnLetter = String.fromCharCode(64 + headers.length);
    const lastRowNumber = rows.length + 1;
    worksheet['!autofilter'] = { ref: `A1:${lastColumnLetter}${lastRowNumber}` };
    if (layout.freezeHeader) {
      worksheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
    }
  }

  applyColumnFormatting(worksheet, columns, rows.length, currency);

  return { XLSX, worksheet };
};

const saveWorkbook = async (
  rows: ExcelRow[],
  columns: ExcelColumn[],
  sheetName: string,
  fileName: string,
  currency: Currency = 'USD',
  layout: WorksheetLayoutOptions = {}
) => {
  const { XLSX, worksheet } = await buildWorksheet(rows, columns, currency, layout);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, fileName);
};

const formatPatientAddressForExport = (patient: Patient) => {
  return [patient.address, patient.township, patient.city].filter(Boolean).join(', ') || 'N/A';
};

const getPatientRecordsForExport = (patientId: string, records: ClinicalRecord[] = []) => {
  return records
    .filter((record) => record.patient_id === patientId)
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
};

const summarizeTreatmentsForExport = (records: ClinicalRecord[]) => {
  const treatments = records.map((record) => record.description?.trim()).filter(Boolean);
  return treatments.length > 0 ? treatments.join(', ') : 'N/A';
};

const summarizeDoctorsForExport = (records: ClinicalRecord[]) => {
  const doctors = Array.from(new Set(records.map((record) => normalizeDoctorName(record.doctor_name)).filter(Boolean)));
  return doctors.length > 0 ? doctors.map((doctor) => formatDoctorName(doctor, 'N/A')).join(', ') : 'N/A';
};

export const exportPatientsToExcel = async (patients: Patient[], currency: Currency, treatmentRecords: ClinicalRecord[] = []) => {
  const columns: ExcelColumn[] = [
    { header: 'No', width: 8, format: 'integer' },
    { header: 'Patient ID', width: 14 },
    { header: 'Patient Name', width: 24 },
    { header: 'Date', width: 15 },
    { header: 'Age', width: 8, format: 'integer' },
    { header: 'Patient Type', width: 15 },
    { header: 'Phone', width: 16 },
    { header: 'Email', width: 28 },
    { header: 'Address', width: 30 },
    { header: 'City', width: 15 },
    { header: 'Township', width: 15 },
    { header: 'Treatment', width: 45 },
    { header: 'Doctor', width: 30 },
    { header: 'Medical Status', width: 18 },
    { header: 'Balance', width: 14, format: 'currency' },
    { header: 'Portal Access', width: 14 },
    { header: 'Loyalty Points', width: 14, format: 'integer' },
    { header: 'Join Date', width: 15 }
  ];
  const rows = patients.map((patient, index) => {
    const patientRecords = getPatientRecordsForExport(patient.id, treatmentRecords);
    return {
      No: index + 1,
      'Patient ID': patient.patient_unique_id || patient.id.substring(0, 8),
      'Patient Name': patient.name,
      Date: patient.created_at ? new Date(patient.created_at).toLocaleDateString() : 'N/A',
      Age: patient.age ?? 'N/A',
      'Patient Type': patient.patient_type || 'N/A',
      Phone: patient.phone || 'N/A',
      Email: patient.email || 'N/A',
      Address: formatPatientAddressForExport(patient),
      City: patient.city || '',
      Township: patient.township || '',
      Treatment: summarizeTreatmentsForExport(patientRecords),
      Doctor: summarizeDoctorsForExport(patientRecords),
      'Medical Status': patient.medicalHistory ? 'Review Required' : 'No Alerts',
      Balance: patient.balance || 0,
      'Portal Access': patient.has_account ? 'Active' : 'No Access',
      'Loyalty Points': patient.loyalty_points || 0,
      'Join Date': patient.created_at ? new Date(patient.created_at).toLocaleDateString() : 'N/A'
    };
  });

  await saveWorkbook(rows, columns, 'Patients', `patient-directory-${new Date().toISOString().split('T')[0]}.xlsx`, currency);
};

export const exportAppointmentsToExcel = async (appointments: Appointment[]) => {
  const columns: ExcelColumn[] = [
    { header: 'Date', width: 14 },
    { header: 'Time', width: 10 },
    { header: 'Patient', width: 24 },
    { header: 'Phone', width: 16 },
    { header: 'Source', width: 18 },
    { header: 'Type', width: 18 },
    { header: 'Doctor', width: 22 },
    { header: 'Status', width: 14 },
    { header: 'Notes', width: 32 }
  ];
  const rows = appointments
    .slice()
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .map((appointment) => ({
      Date: appointment.date,
      Time: appointment.time,
      Patient: appointment.patient_name || 'Unknown',
      Phone: appointment.guest_phone || '',
      Source: appointment.patient_id ? 'Registered Patient' : appointment.guest_source || 'Lead',
      Type: appointment.type || 'Checkup',
      Doctor: formatDoctorName(appointment.doctor_name, 'N/A'),
      Status: appointment.status,
      Notes: formatAppointmentNotesForDisplay(appointment.notes)
    }));

  await saveWorkbook(rows, columns, 'Appointments', `appointments-report-${new Date().toISOString().split('T')[0]}.xlsx`);
};

export const exportRecallsCancelsToExcel = async (
  appointments: Appointment[],
  todayKey: string,
  locationName: string
) => {
  const XLSX = await import('xlsx');
  const sections = buildRecallsCancelsExportRows(appointments, todayKey);
  const workbook = XLSX.utils.book_new();
  const generatedAt = new Date().toLocaleString();
  const total = sections.recalls.length + sections.late.length + sections.cancelled.length + sections.noShow.length + sections.rescheduled.length + sections.completedLater.length;
  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['Recalls & Cancels Report'],
    ['Report Scope', locationName],
    ['Generated', generatedAt],
    ['Report Date', todayKey],
    [],
    ['Category', 'Count'],
    ['Upcoming Recalls', sections.recalls.length],
    ['Late / No-show', sections.late.length],
    ['Cancelled - Needs Follow-up', sections.cancelled.length],
    ['Cancelled - No Show', sections.noShow.length],
    ['Cancelled - Rescheduled', sections.rescheduled.length],
    ['Cancelled - Completed Later', sections.completedLater.length],
    ['Total', total]
  ]);
  summarySheet['!cols'] = [{ wch: 28 }, { wch: 34 }];
  summarySheet['!merges'] = [XLSX.utils.decode_range('A1:B1')];
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  const headers = [...RECALLS_CANCELS_EXCEL_HEADERS];
  const appendSectionSheet = (sheetName: string, rows: RecallsCancelsExportRow[]) => {
    const data = rows.map(row => ({
      Date: row.date,
      Time: row.time,
      Patient: row.patient,
      Type: row.patientType,
      Phone: row.phone,
      Source: row.source,
      'Appt.': row.appointmentType,
      Doctor: row.doctor,
      Focus: row.clinicalFocus,
      Notes: row.notes,
      Status: row.cancellationOutcome ? row.cancellationOutcome.replaceAll('_', ' ') : '',
      'Done date': row.completedLaterDate
    }));
    const worksheet = XLSX.utils.json_to_sheet(data, { header: headers });
    worksheet['!cols'] = RECALLS_CANCELS_EXCEL_COLUMN_WIDTHS.map((wch) => ({ wch }));
    worksheet['!rows'] = [{ hpt: EXCEL_HEADER_ROW_HEIGHT_POINTS }];
    headers.forEach((_, columnIndex) => {
      const cellAddress = `${String.fromCharCode(65 + columnIndex)}1`;
      const cell = worksheet[cellAddress];
      if (!cell) return;
      cell.s = {
        ...(cell.s || {}),
        alignment: { ...(cell.s?.alignment || {}), vertical: 'center', wrapText: false }
      };
    });
    worksheet['!autofilter'] = { ref: `A1:L${Math.max(rows.length + 1, 1)}` };
    worksheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  };

  appendSectionSheet('Upcoming Recalls', sections.recalls);
  appendSectionSheet('Late-No-show', sections.late);
  appendSectionSheet('Cancelled - Follow-up', sections.cancelled);
  appendSectionSheet('Cancelled - No Show', sections.noShow);
  appendSectionSheet('Cancelled - Rescheduled', sections.rescheduled);
  appendSectionSheet('Cancelled - Completed', sections.completedLater);
  XLSX.writeFile(workbook, `recalls-cancels-${todayKey}.xlsx`);
};

interface ClinicalRecordsExcelExportOptions extends AuditLogFilterOptions {
  appointments?: Appointment[];
  payments?: PaymentRecord[];
  rescheduleLogs?: AppointmentRescheduleLog[];
  includeAppointments?: boolean;
}

export const exportClinicalRecordsToExcel = async (records: ClinicalRecord[], currency: Currency, options: ClinicalRecordsExcelExportOptions = {}) => {
  const columns: ExcelColumn[] = [
    { header: 'Type', width: 14 },
    { header: 'Date / Time', width: 22 },
    { header: 'Patient', width: 24 },
    { header: 'Clinician', width: 22 },
    { header: 'Clinical Activity', width: 48 },
    { header: 'Patient Type', width: 18 },
    { header: 'Patient Balance', width: 16 },
    { header: 'Amount', width: 14, format: 'currency' },
    { header: 'Discount', width: 14, format: 'currency' },
    { header: 'Service Charges', width: 18, format: 'currency' },
    { header: 'Doctor Earned', width: 18, format: 'currency' }
  ];
  const exportRows = filterAuditLogRowsForExport(
    buildAuditLogRows(records, options.appointments || [], options.includeAppointments ?? false, options.payments || [], options.rescheduleLogs || []),
    options
  );
  const rows = buildAuditLogExportTableRows(exportRows, currency).map((row) => ({
    Type: row.type,
    'Date / Time': row.dateTime,
    Patient: row.patient,
    Clinician: row.clinician,
    'Clinical Activity': row.activity,
    'Patient Type': row.patientType,
    'Patient Balance': row.patientBalance,
    Amount: row.amount ?? 0,
    Discount: row.discount === null ? 0 : -row.discount,
    'Service Charges': row.serviceCharges ?? 0,
    'Doctor Earned': row.doctorEarned ?? 0
  }));

  await saveWorkbook(
    rows,
    columns,
    options.includeAppointments ? 'Audit Log' : 'Clinical Records',
    `${options.includeAppointments ? 'clinic-audit-logs' : 'clinical-records'}-${new Date().toISOString().split('T')[0]}.xlsx`,
    currency,
    { compactHeader: true, freezeHeader: true }
  );
};

export const exportDoctorsToExcel = async (doctors: Doctor[]) => {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const columns: ExcelColumn[] = [
    { header: 'Doctor Name', width: 24 },
    { header: 'Specialization', width: 18 },
    { header: 'Commission Method', width: 20 },
    { header: 'Commission %', width: 14 },
    { header: 'Commission Per Visit', width: 20 },
    { header: 'Phone', width: 16 },
    { header: 'Email', width: 28 },
    { header: 'Schedule', width: 40 }
  ];
  const rows = doctors.map((doctor) => ({
    'Doctor Name': formatDoctorName(doctor.name, 'N/A'),
    Specialization: doctor.specialization || 'General',
    'Commission Method': usesFlatVisitCommission({ commissionType: doctor.commission_type, specialization: doctor.specialization }) ? 'Fixed per visit' : 'Percentage',
    'Commission %': usesFlatVisitCommission({ commissionType: doctor.commission_type, specialization: doctor.specialization }) ? 'N/A' : (doctor.commission_percentage != null ? doctor.commission_percentage : 0),
    'Commission Per Visit': usesFlatVisitCommission({ commissionType: doctor.commission_type, specialization: doctor.specialization }) ? (doctor.commission_per_visit || 0) : 'N/A',
    Phone: doctor.phone || 'N/A',
    Email: doctor.email || 'N/A',
    Schedule: doctor.schedules.length === 0
      ? 'No schedule set'
      : doctor.schedules
          .map(schedule => `${dayNames[schedule.day_of_week]} ${schedule.start_time}-${schedule.end_time}`)
          .join(' | ')
  }));

  await saveWorkbook(rows, columns, 'Doctors', `doctors-directory-${new Date().toISOString().split('T')[0]}.xlsx`);
};

export const exportInventoryToExcel = async (medicines: Medicine[], currency: Currency) => {
  const columns: ExcelColumn[] = [
    { header: 'Medicine', width: 24 },
    { header: 'Category', width: 18 },
    { header: 'Description', width: 30 },
    { header: 'Unit', width: 10 },
    { header: 'Price', width: 14, format: 'currency' },
    { header: 'Stock', width: 12, format: 'integer' },
    { header: 'Min Stock', width: 12, format: 'integer' },
    { header: 'Inventory Value', width: 16, format: 'currency' }
  ];
  const rows = medicines.map((medicine) => ({
    Medicine: medicine.name,
    Category: medicine.category || 'N/A',
    Description: medicine.description || '',
    Unit: medicine.unit,
    Price: medicine.price || 0,
    Stock: medicine.stock || 0,
    'Min Stock': medicine.min_stock ?? 0,
    'Inventory Value': (medicine.price || 0) * (medicine.stock || 0)
  }));

  await saveWorkbook(rows, columns, 'Inventory', `inventory-report-${new Date().toISOString().split('T')[0]}.xlsx`, currency);
};

export const exportExpensesToExcel = async (expenses: Expense[], currency: Currency) => {
  const columns: ExcelColumn[] = [
    { header: 'Date', width: 14 },
    { header: 'Description', width: 32 },
    { header: 'Category', width: 18 },
    { header: 'Amount', width: 14, format: 'currency' }
  ];
  const rows = expenses.map((expense) => ({
    Date: expense.date,
    Description: expense.description,
    Category: expense.category || 'Uncategorized',
    Amount: expense.amount || 0
  }));

  await saveWorkbook(rows, columns, 'Expenses', `expenses-${new Date().toISOString().split('T')[0]}.xlsx`, currency);
};
