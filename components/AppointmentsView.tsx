import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Calendar, Plus, Loader2, Trash2, Clock, User, FileText, ChevronLeft, ChevronRight, List, CalendarDays, ClipboardList, UserRoundCog, CalendarCog, RotateCw, UserCog, AlertTriangle } from 'lucide-react';
import { Appointment, Doctor, DoctorCorrectionPreview, DoctorCorrectionResult, Patient, TreatmentType } from '../types';
import { exportAppointmentsToPDF } from '../utils/pdfExport';
import { exportAppointmentsToExcel } from '../utils/excelExport';
import { parseAppointmentClinicalFocus } from '../utils/appointmentClinicalFocus';
import { compareAppointmentStatus } from '../utils/appointmentSorting';
import { type Currency } from '../utils/currency';
import { formatDoctorName } from '../utils/doctorName';
import Pagination from './Pagination';
import { ConfirmDialog, Modal } from './Shared';
import ExportMenu from './ExportMenu';
import PatientQRScanButton from './PatientQRScanButton';
import { SearchableSelect } from './SearchableSelect';

// Local ISO date key (YYYY-MM-DD) used by the calendar grid and day preview.
const toISODateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDaysToDate = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

interface AppointmentsViewProps {
  appointments: Appointment[];
  patients: Patient[];
  doctors?: Pick<Doctor, 'id' | 'name'>[];
  treatmentTypes?: TreatmentType[];
  loading: boolean;
  onAddAppointment: () => void;
  onEditAppointment: (appointment: Appointment) => void;
  onDeleteAppointment: (id: string) => void;
  onUpdateStatus: (
    id: string,
    status: 'Scheduled' | 'Completed' | 'Cancelled',
    options?: { skipClinicalFee?: boolean }
  ) => void;
  currency: Currency;
  onViewChart: (appointment: Appointment) => void;
  onSelectPatient: (patient: Patient) => void;
  onEditPatientInfo?: (appointment: Appointment) => void;
  onConvertLead?: (appointment: Appointment) => void;
  onOpenAppointmentLog?: () => void;
  onExportPDF?: () => Promise<void>;
  onExportExcel?: () => Promise<void>;
  onRefresh?: () => void | Promise<void>;
  canCorrectDoctor?: boolean;
  onPreviewDoctorCorrection?: (appointmentId: string) => Promise<DoctorCorrectionPreview>;
  onCorrectDoctor?: (input: {
    appointmentId: string;
    expectedOldDoctorId?: string | null;
    newDoctorId: string;
    treatmentIds: string[];
    reason: string;
    requestToken: string;
  }) => Promise<DoctorCorrectionResult>;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canViewChart?: boolean;
  canExport?: boolean;
  uiStyle?: 'table' | 'cards';
  initialDateQuickFilter?: 'all' | 'tomorrow' | 'today';
  totalAppointments?: number;
  onQueryChange?: (query: {
    dateQuickFilter: 'all' | 'tomorrow' | 'today' | 'custom';
    date: string;
    search: string;
    doctor: string;
    treatment: string;
    page: number;
  }) => void;
}

const AppointmentsView: React.FC<AppointmentsViewProps> = ({
  appointments,
  patients,
  doctors = [],
  treatmentTypes = [],
  loading,
  onAddAppointment,
  onEditAppointment,
  onDeleteAppointment,
  onUpdateStatus,
  onViewChart,
  onSelectPatient,
  onEditPatientInfo,
  onConvertLead,
  onOpenAppointmentLog,
  onExportPDF,
  onExportExcel,
  onRefresh,
  canCorrectDoctor = false,
  onPreviewDoctorCorrection,
  onCorrectDoctor,
  canCreate = true,
  canEdit = true,
  canDelete = true,
  canViewChart = true,
  canExport = true,
  uiStyle = 'table',
  initialDateQuickFilter = 'today',
  totalAppointments,
  onQueryChange
}) => {
  const [viewMode, setViewMode] = useState<'current' | 'calendar'>('current');
  const [upcomingPage, setUpcomingPage] = useState(1);
  const [pastPage, setPastPage] = useState(1);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [showAllPast, setShowAllPast] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateQuickFilter, setDateQuickFilter] = useState<'all' | 'tomorrow' | 'today' | 'custom'>(initialDateQuickFilter);
  const [dateFilter, setDateFilter] = useState('');
  const [doctorFilter, setDoctorFilter] = useState('');
  const [treatmentFilter, setTreatmentFilter] = useState('');
  const [calendarDate, setCalendarDate] = useState(new Date());
  // Default the day preview to today so the calendar is not empty on load.
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(() => toISODateKey(new Date()));
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [appointmentToDelete, setAppointmentToDelete] = useState<string | null>(null);
  const [doctorCorrectionAppointment, setDoctorCorrectionAppointment] = useState<Appointment | null>(null);
  const [doctorCorrectionPreview, setDoctorCorrectionPreview] = useState<DoctorCorrectionPreview | null>(null);
  const [doctorCorrectionLoading, setDoctorCorrectionLoading] = useState(false);
  const [doctorCorrectionSubmitting, setDoctorCorrectionSubmitting] = useState(false);
  const [doctorCorrectionError, setDoctorCorrectionError] = useState('');
  const [correctDoctorId, setCorrectDoctorId] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [selectedCorrectionTreatmentIds, setSelectedCorrectionTreatmentIds] = useState<string[]>([]);
  const [doctorCorrectionRequestToken, setDoctorCorrectionRequestToken] = useState('');
  const doctorCorrectionPreviewRequestRef = useRef(0);
  const itemsPerPage = 100;

  const toLocalISODate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const parseLocalDate = (dateString: string) => {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
  };

  const resetAppointmentPages = () => {
    setUpcomingPage(1);
    setPastPage(1);
    setCurrentPage(1);
  };

  const applyQuickDateFilter = (filter: 'all' | 'tomorrow' | 'today') => {
    setDateQuickFilter(filter);
    setDateFilter('');
    setSelectedCalendarDate(
      filter === 'today'
        ? toISODateKey(new Date())
        : filter === 'tomorrow'
          ? toISODateKey(addDaysToDate(new Date(), 1))
          : null
    );
    resetAppointmentPages();
  };

  const applySingleDateFilter = (isoDate: string) => {
    setDateQuickFilter('custom');
    setDateFilter(isoDate);
    setSelectedCalendarDate(isoDate);
    setCalendarDate(parseLocalDate(isoDate));
    resetAppointmentPages();
  };

  const clearDateFilter = () => {
    setDateQuickFilter('all');
    setDateFilter('');
    setSelectedCalendarDate(null);
    resetAppointmentPages();
  };

  useEffect(() => {
    setDateQuickFilter(initialDateQuickFilter);
    setDateFilter('');
    setSelectedCalendarDate(
      initialDateQuickFilter === 'today'
        ? toISODateKey(new Date())
        : initialDateQuickFilter === 'tomorrow'
          ? toISODateKey(addDaysToDate(new Date(), 1))
          : null
    );
    resetAppointmentPages();
  }, [initialDateQuickFilter]);

  useEffect(() => {
    if (!onQueryChange) return;
    const timer = window.setTimeout(() => onQueryChange({
      dateQuickFilter,
      date: dateFilter,
      search: searchTerm,
      doctor: doctorFilter,
      treatment: treatmentFilter,
      page: currentPage
    }), searchTerm ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [dateQuickFilter, dateFilter, searchTerm, doctorFilter, treatmentFilter, currentPage, onQueryChange]);

  const tomorrowISO = useMemo(() => {
    const nextDay = new Date();
    nextDay.setDate(nextDay.getDate() + 1);
    return toLocalISODate(nextDay);
  }, []);

  const todayLocalISO = useMemo(() => toLocalISODate(new Date()), []);

  const formatDate = (dateString: string) => {
    const date = parseLocalDate(dateString);
    return date.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatDateDDMMYYYY = (dateString: string) => {
    const date = parseLocalDate(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const formatTime = (timeString: string) => {
    // Handle both "HH:MM:SS" and "HH:MM" formats
    const time = timeString.split(':').slice(0, 2).join(':');
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const formatDoctorDisplayName = (doctorName?: string | null) => {
    return formatDoctorName(doctorName);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Scheduled':
        return 'bg-blue-50 text-blue-700 border-blue-100';
      case 'Completed':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'Cancelled':
        return 'bg-red-100 text-red-800 border-red-300';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-100';
    }
  };

  const isNewPatientAppointment = (appointment: Appointment) => !appointment.patient_id;
  const renderNewPatientBadge = (compact = false) => (
    <span className={`rounded bg-amber-100 ${compact ? 'px-1.5' : 'px-2'} py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700`}>
      New Patient
    </span>
  );

  const getPatientForAppointment = (appointment: Appointment) => {
    if (!appointment.patient_id) return undefined;
    return patients.find((patient) => patient.id === appointment.patient_id);
  };

  const handleRegisteredPatientClick = (appointment: Appointment) => {
    if (onEditPatientInfo) {
      onEditPatientInfo(appointment);
      return;
    }

    const patient = getPatientForAppointment(appointment);
    if (patient) {
      onSelectPatient(patient);
    }
  };

  const patientNameClassName = (appointment: Appointment, baseClassName: string) => {
    if (!appointment.patient_id) return baseClassName;
    return `${baseClassName} cursor-pointer rounded px-1 -mx-1 text-[var(--hover-700)] hover:bg-[var(--hover-50)] hover:text-[var(--hover-800)] transition-colors`;
  };

  const renderPatientName = (appointment: Appointment, baseClassName: string) => {
    const content = appointment.patient_name || 'Unknown Patient';

    if (!appointment.patient_id) {
      return <span className={baseClassName}>{content}</span>;
    }

    return (
      <button
        type="button"
        onClick={() => handleRegisteredPatientClick(appointment)}
        className={patientNameClassName(appointment, baseClassName)}
        title="Edit patient info"
      >
        {content}
      </button>
    );
  };

  const renderAppointmentActionButtons = (appointment: Appointment, compact = false) => {
    const buttonClassName = compact
      ? 'appointment-action-button inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold'
      : 'appointment-action-button inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold';
    const iconClassName = compact ? 'w-3.5 h-3.5' : 'w-3.5 h-3.5';

    return (
      <>
        {canViewChart && appointment.patient_id && (
          <button
            type="button"
            onClick={() => onViewChart(appointment)}
            className={`${buttonClassName} appointment-action-clinical`}
            title="Open clinical chart"
          >
            <ClipboardList className={iconClassName} />
            Clinical Chart
          </button>
        )}
        {appointment.patient_id && onEditPatientInfo && (
          <button
            type="button"
            onClick={() => onEditPatientInfo(appointment)}
            className={`${buttonClassName} appointment-action-patient`}
            title="Edit patient information"
          >
            <UserRoundCog className={iconClassName} />
            Edit Patient Info
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => onEditAppointment(appointment)}
            className={`${buttonClassName} appointment-action-appointment`}
            title="Edit appointment information"
          >
            <CalendarCog className={iconClassName} />
            Edit Appointment Info
          </button>
        )}
        {canCorrectDoctor && appointment.patient_id && onPreviewDoctorCorrection && onCorrectDoctor && (
          <button
            type="button"
            onClick={() => void openDoctorCorrection(appointment)}
            className={`${buttonClassName} border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`}
            title="Correct the doctor for this visit and its selected records"
          >
            <UserCog className={iconClassName} />
            Correct Doctor
          </button>
        )}
      </>
    );
  };

  const closeDoctorCorrection = () => {
    if (doctorCorrectionSubmitting) return;
    doctorCorrectionPreviewRequestRef.current += 1;
    setDoctorCorrectionAppointment(null);
    setDoctorCorrectionPreview(null);
    setDoctorCorrectionError('');
    setCorrectDoctorId('');
    setCorrectionReason('');
    setSelectedCorrectionTreatmentIds([]);
    setDoctorCorrectionRequestToken('');
  };

  const openDoctorCorrection = async (appointment: Appointment) => {
    if (!onPreviewDoctorCorrection) return;
    const previewRequest = doctorCorrectionPreviewRequestRef.current + 1;
    doctorCorrectionPreviewRequestRef.current = previewRequest;
    setDoctorCorrectionAppointment(appointment);
    setDoctorCorrectionPreview(null);
    setDoctorCorrectionError('');
    setCorrectDoctorId('');
    setCorrectionReason('');
    setSelectedCorrectionTreatmentIds([]);
    setDoctorCorrectionRequestToken(typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `doctor-correction-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setDoctorCorrectionLoading(true);
    try {
      const preview = await onPreviewDoctorCorrection(appointment.id);
      if (doctorCorrectionPreviewRequestRef.current !== previewRequest) return;
      setDoctorCorrectionPreview(preview);
      setSelectedCorrectionTreatmentIds(
        preview.treatments.filter((treatment) => treatment.linked_to_appointment && !treatment.has_financial_history).map((treatment) => treatment.id)
      );
    } catch (error: any) {
      if (doctorCorrectionPreviewRequestRef.current !== previewRequest) return;
      setDoctorCorrectionError(error?.message || 'Could not load the doctor correction preview.');
    } finally {
      if (doctorCorrectionPreviewRequestRef.current === previewRequest) setDoctorCorrectionLoading(false);
    }
  };

  const submitDoctorCorrection = async () => {
    if (!doctorCorrectionPreview || !onCorrectDoctor) return;
    setDoctorCorrectionError('');
    setDoctorCorrectionSubmitting(true);
    try {
      await onCorrectDoctor({
        appointmentId: doctorCorrectionPreview.appointment_id,
        expectedOldDoctorId: doctorCorrectionPreview.old_doctor_id,
        newDoctorId: correctDoctorId,
        treatmentIds: selectedCorrectionTreatmentIds,
        reason: correctionReason,
        requestToken: doctorCorrectionRequestToken
      });
      setDoctorCorrectionSubmitting(false);
      closeDoctorCorrection();
    } catch (error: any) {
      setDoctorCorrectionError(error?.message || 'The doctor could not be corrected.');
    } finally {
      setDoctorCorrectionSubmitting(false);
    }
  };

  const activeVisitAppointments = useMemo(
    () => appointments.filter((appointment) => appointment.status !== 'Cancelled'),
    [appointments]
  );

  const firstVisitDateByPatient = useMemo(() => {
    const map = new Map<string, string>();
    activeVisitAppointments.forEach((appointment) => {
      if (!appointment.patient_id) return;
      const current = map.get(appointment.patient_id);
      if (!current || appointment.date < current) {
        map.set(appointment.patient_id, appointment.date);
      }
    });
    return map;
  }, [activeVisitAppointments]);

  const isNewPatientToday = (patientId: string) => firstVisitDateByPatient.get(patientId) === todayLocalISO;

  const makeUniqueSortedOptions = (values: string[]) =>
    Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));

  const doctorNameById = useMemo(() => {
    const map = new Map<string, string>();
    doctors.forEach((doctor) => {
      if (doctor.id && doctor.name?.trim()) {
        map.set(doctor.id, doctor.name.trim());
      }
    });
    return map;
  }, [doctors]);

  const doctorOptions = useMemo(() => {
    const configuredOptions = doctors
      .filter((doctor) => doctor.id && doctor.name?.trim())
      .map((doctor) => ({ value: `id:${doctor.id}`, label: doctor.name.trim() }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const configuredNames = new Set(configuredOptions.map((option) => option.label.toLowerCase()));
    const historicalOptions = makeUniqueSortedOptions(
      appointments.map((appointment) => appointment.doctor_name || '')
    )
      .filter((name) => !configuredNames.has(name.toLowerCase()))
      .map((name) => ({ value: `name:${name}`, label: name }));

    return [...configuredOptions, ...historicalOptions];
  }, [appointments, doctors]);

  const doctorFilterSuggestions = useMemo(
    () => makeUniqueSortedOptions(doctorOptions.map((option) => option.label)),
    [doctorOptions]
  );

  const treatmentOptions = useMemo(() => {
    const configuredNames = makeUniqueSortedOptions(
      treatmentTypes.map((treatmentType) => treatmentType.name || '')
    );
    const configuredNameSet = new Set(configuredNames.map((name) => name.toLowerCase()));
    const historicalNames = makeUniqueSortedOptions(
      appointments.flatMap((appointment) => {
        const clinicalFocus = parseAppointmentClinicalFocus(appointment.notes).clinicalFocus;
        return [appointment.type || '', clinicalFocus];
      })
    ).filter((name) => !configuredNameSet.has(name.toLowerCase()));

    return [...configuredNames, ...historicalNames];
  }, [appointments, treatmentTypes]);

  const treatmentFilterSuggestions = useMemo(
    () => makeUniqueSortedOptions(treatmentOptions),
    [treatmentOptions]
  );

  const searchFilteredAppointments = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return appointments.filter(apt => {
      const clinicalPlan = parseAppointmentClinicalFocus(apt.notes);
      const matchesSearch = !searchTerm || (
        apt.patient_name?.toLowerCase().includes(term) ||
        apt.guest_phone?.toLowerCase().includes(term) ||
        apt.guest_source?.toLowerCase().includes(term) ||
        apt.guest_notes?.toLowerCase().includes(term) ||
        apt.type?.toLowerCase().includes(term) ||
        apt.doctor_name?.toLowerCase().includes(term) ||
        apt.date.toLowerCase().includes(term) ||
        apt.time.toLowerCase().includes(term) ||
        apt.status.toLowerCase().includes(term) ||
        clinicalPlan.clinicalFocus.toLowerCase().includes(term) ||
        clinicalPlan.notes.toLowerCase().includes(term)
      );

      if (!matchesSearch) return false;

      if (doctorFilter) {
        const normalizedDoctorFilter = doctorFilter.trim().toLowerCase();
        const appointmentDoctorName = apt.doctor_name?.trim() || '';
        const resolvedDoctorName = (
          doctorNameById.get(apt.doctor_id || '') ||
          appointmentDoctorName
        ).trim();
        const isDoctorIdFilter = doctorFilter.startsWith('id:');
        const isDoctorNameFilter = doctorFilter.startsWith('name:');
        const matchesDoctor = isDoctorIdFilter
          ? apt.doctor_id === doctorFilter.replace(/^id:/, '') ||
            appointmentDoctorName.toLowerCase() === (doctorNameById.get(doctorFilter.replace(/^id:/, '')) || '').trim().toLowerCase()
          : isDoctorNameFilter
            ? appointmentDoctorName.toLowerCase() === doctorFilter.replace(/^name:/, '').trim().toLowerCase()
            : appointmentDoctorName.toLowerCase().includes(normalizedDoctorFilter) ||
              resolvedDoctorName.toLowerCase().includes(normalizedDoctorFilter) ||
              (apt.doctor_id || '').toLowerCase().includes(normalizedDoctorFilter);

        if (!matchesDoctor) return false;
      }

      if (treatmentFilter) {
        const selectedTreatment = treatmentFilter.trim().toLowerCase();
        const appointmentType = (apt.type || '').trim().toLowerCase();
        const clinicalFocus = clinicalPlan.clinicalFocus.trim().toLowerCase();
        const matchesTreatment =
          appointmentType.includes(selectedTreatment) ||
          clinicalFocus.includes(selectedTreatment);
        if (!matchesTreatment) {
          return false;
        }
      }

      return true;
    });
  }, [appointments, searchTerm, doctorFilter, treatmentFilter, doctorNameById]);

  const filteredAppointments = useMemo(() => {
    return searchFilteredAppointments.filter(apt => {
      if (dateQuickFilter === 'tomorrow') return apt.date === tomorrowISO;
      if (dateQuickFilter === 'today') return apt.date === todayLocalISO;
      if (dateQuickFilter === 'custom' && dateFilter) return apt.date === dateFilter;
      return true;
    });
  }, [searchFilteredAppointments, dateQuickFilter, tomorrowISO, todayLocalISO, dateFilter]);

  const sortedTableAppointments = useMemo(() => {
    return filteredAppointments
      .slice()
      .sort((a, b) => {
        const statusCompare = compareAppointmentStatus(a, b);
        if (statusCompare !== 0) return statusCompare;
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return a.time.localeCompare(b.time);
      });
  }, [filteredAppointments]);

  // Separate upcoming and past appointments
  const upcomingAppointments = filteredAppointments.filter(apt => {
    const aptDate = new Date(apt.date);
    aptDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return aptDate >= today && apt.status === 'Scheduled';
  }).sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return a.time.localeCompare(b.time);
  });

  const pastAppointments = filteredAppointments.filter(apt => {
    const aptDate = new Date(apt.date);
    aptDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return aptDate < today || apt.status !== 'Scheduled';
  }).sort((a, b) => {
    const statusCompare = compareAppointmentStatus(a, b);
    if (statusCompare !== 0) return statusCompare;
    const dateCompare = b.date.localeCompare(a.date);
    if (dateCompare !== 0) return dateCompare;
    return b.time.localeCompare(a.time);
  });

  // Paginated data
  const paginatedUpcoming = useMemo(() => {
    if (showAllUpcoming) return upcomingAppointments;
    const startIndex = (upcomingPage - 1) * itemsPerPage;
    return upcomingAppointments.slice(startIndex, startIndex + itemsPerPage);
  }, [upcomingAppointments, upcomingPage, showAllUpcoming]);

  const paginatedPast = useMemo(() => {
    if (showAllPast) return pastAppointments;
    const startIndex = (pastPage - 1) * itemsPerPage;
    return pastAppointments.slice(startIndex, startIndex + itemsPerPage);
  }, [pastAppointments, pastPage, showAllPast]);

  const paginatedTableAppointments = useMemo(() => {
    if (onQueryChange) return sortedTableAppointments;
    if (showAll) return sortedTableAppointments;
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedTableAppointments.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedTableAppointments, currentPage, showAll]);

  const [exporting, setExporting] = useState(false);

  const handleDownloadPDF = async () => {
    if (onExportPDF) {
      setExporting(true);
      try {
        await onExportPDF();
      } finally {
        setExporting(false);
      }
    } else {
      exportAppointmentsToPDF(appointments);
    }
  };

  const handleDownloadExcel = async () => {
    if (onExportExcel) {
      setExporting(true);
      try {
        await onExportExcel();
      } finally {
        setExporting(false);
      }
    } else {
      await exportAppointmentsToExcel(appointments);
    }
  };

  const calendarGrid = useMemo(() => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const totalDays = lastDay.getDate();
    const startWeekday = firstDay.getDay();

    const cells: Array<{ date: Date | null; isoDate: string | null; inCurrentMonth: boolean }> = [];

    for (let i = 0; i < startWeekday; i++) {
      cells.push({ date: null, isoDate: null, inCurrentMonth: false });
    }

    for (let day = 1; day <= totalDays; day++) {
      const date = new Date(year, month, day);
      cells.push({ date, isoDate: toLocalISODate(date), inCurrentMonth: true });
    }

    const remainder = cells.length % 7;
    if (remainder !== 0) {
      for (let i = 0; i < 7 - remainder; i++) {
        cells.push({ date: null, isoDate: null, inCurrentMonth: false });
      }
    }

    return cells;
  }, [calendarDate]);

  const appointmentMapByDate = useMemo(() => {
    const map = new Map<string, Appointment[]>();

    searchFilteredAppointments.forEach((apt) => {
      const dateKey = apt.date;
      if (!map.has(dateKey)) {
        map.set(dateKey, []);
      }
      map.get(dateKey)!.push(apt);
    });

    map.forEach((apts) => {
      apts.sort((a, b) => compareAppointmentStatus(a, b) || a.time.localeCompare(b.time));
    });

    return map;
  }, [searchFilteredAppointments]);

  const selectedDayAppointments = useMemo(() => {
    if (!selectedCalendarDate) return [];
    return appointmentMapByDate.get(selectedCalendarDate) || [];
  }, [selectedCalendarDate, appointmentMapByDate]);

  const monthLabel = calendarDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  });

  const todayISO = todayLocalISO;

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
    {/* Header: Title + Action Buttons (no search) */}
    <div className="px-4 md:px-6 py-3 md:py-4 border-b border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 bg-white sticky top-0 z-10">
      <div>
        <h2 className="text-lg md:text-xl font-bold text-gray-800">Appointment Schedule</h2>
        <p className="text-xs md:text-sm text-gray-500">Manage patient appointments and scheduling</p>
      </div>
      <div className="flex flex-wrap gap-2 w-full md:w-auto">
        <div className="inline-flex flex-1 md:flex-initial rounded-lg border border-gray-200 bg-gray-50 p-1">
          <button
            onClick={() => setViewMode('current')}
            className={`inline-flex flex-1 md:flex-initial items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
              viewMode === 'current' ? 'bg-white text-indigo-700 shadow-sm font-semibold' : 'text-gray-600 hover:text-gray-900'
            }`}
            title="List view"
          >
            <List className="w-3.5 h-3.5" />
            List
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`inline-flex flex-1 md:flex-initial items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
              viewMode === 'calendar' ? 'bg-white text-indigo-700 shadow-sm font-semibold' : 'text-gray-600 hover:text-gray-900'
            }`}
            title="Calendar view"
          >
            <CalendarDays className="w-3.5 h-3.5" />
            Calendar
          </button>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh?.()}
          className="refresh-action-button flex-1 md:flex-initial flex items-center justify-center gap-2 border px-4 py-2 rounded-lg text-sm font-bold"
        >
          <RotateCw className="refresh-action-icon w-4 h-4" /> <span className="hidden sm:inline">Refresh</span>
        </button>
        {onOpenAppointmentLog && (
          <button
            onClick={onOpenAppointmentLog}
            className="flex-1 md:flex-initial flex items-center justify-center gap-2 border border-indigo-200 bg-indigo-50 text-indigo-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-100 transition-colors"
          >
            <FileText className="w-4 h-4" /> <span className="hidden sm:inline">Appointment Log</span>
          </button>
        )}
        {canExport && (
          <ExportMenu
            disabled={appointments.length === 0 || exporting}
            onExportPDF={handleDownloadPDF}
            onExportExcel={handleDownloadExcel}
            className="flex-1 md:flex-initial"
          />
        )}
        <PatientQRScanButton
          patients={patients}
          onSelectPatient={onSelectPatient}
          className="flex-1 md:flex-initial flex items-center justify-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
        />
        {canCreate && (
          <button
            onClick={onAddAppointment}
            className="flex-1 md:flex-initial flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">New Appointment</span>
          </button>
        )}
      </div>
    </div>

    {/* Toolbar: Search + Date Filters (below header) */}
    <div className="px-4 md:px-6 py-2 md:py-3 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row gap-2 md:gap-3 items-start md:items-center">
      <div className="relative w-full md:w-72 lg:w-80">
        <input
          type="text"
          placeholder="Search appointments..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            resetAppointmentPages();
          }}
          className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full bg-white"
        />
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-2 w-full md:w-auto md:ml-auto">
        <div className="relative min-w-[150px] max-w-[220px]">
          <input
            type="text"
            list="appointment-doctor-filter-options"
            value={doctorFilter}
            onChange={(e) => {
              setDoctorFilter(e.target.value);
              resetAppointmentPages();
            }}
            placeholder="Doctor"
            className="h-8 w-full rounded-lg border border-gray-200 px-2 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            aria-label="Filter appointments by doctor"
          />
          <datalist id="appointment-doctor-filter-options">
            {doctorFilterSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div className="relative min-w-[150px] max-w-[220px]">
          <input
            type="text"
            list="appointment-treatment-filter-options"
            value={treatmentFilter}
            onChange={(e) => {
              setTreatmentFilter(e.target.value);
              resetAppointmentPages();
            }}
            placeholder="Treatment"
            className="h-8 w-full rounded-lg border border-gray-200 px-2 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            aria-label="Filter appointments by treatment"
          />
          <datalist id="appointment-treatment-filter-options">
            {treatmentFilterSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 whitespace-nowrap">
            <span>Filter day</span>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => {
                const nextDate = e.target.value;
                if (nextDate) {
                  applySingleDateFilter(nextDate);
                } else {
                  clearDateFilter();
                }
              }}
              className="h-8 rounded-lg border border-gray-200 px-2 text-sm font-normal text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            />
          </label>
          <button
            onClick={clearDateFilter}
            className="h-8 inline-flex items-center justify-center rounded-lg border border-gray-200 px-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors bg-white"
          >
            Clear
          </button>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          <button
            onClick={() => {
              applyQuickDateFilter('all');
            }}
            className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
              dateQuickFilter === 'all' ? 'bg-white text-indigo-700 shadow-sm font-semibold' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            All
          </button>
          <button
            onClick={() => {
              applyQuickDateFilter('tomorrow');
            }}
            className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
              dateQuickFilter === 'tomorrow' ? 'bg-white text-indigo-700 shadow-sm font-semibold' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Tomorrow
          </button>
          <button
            onClick={() => {
              applyQuickDateFilter('today');
            }}
            className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
              dateQuickFilter === 'today' ? 'bg-white text-emerald-700 shadow-sm font-semibold' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Today
          </button>
        </div>
        {(doctorFilter || treatmentFilter) && (
          <button
            type="button"
            onClick={() => {
              setDoctorFilter('');
              setTreatmentFilter('');
              resetAppointmentPages();
            }}
            className="h-8 inline-flex items-center justify-center rounded-lg border border-gray-200 px-2.5 text-xs font-semibold text-gray-500 hover:bg-gray-50 transition-colors bg-white"
          >
            Reset
          </button>
        )}
      </div>
    </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center p-12">
          <Loader2 className="animate-spin text-[var(--hover-600)] w-10 h-10" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 p-6">
          {viewMode === 'current' ? (
            <>
              {uiStyle === 'cards' ? (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-indigo-600" />
                      Upcoming Appointments
                    </h3>
                    {paginatedUpcoming.length === 0 ? (
                      <div className="text-center py-8 text-gray-400 italic text-sm">No upcoming appointments.</div>
                    ) : (
                      <div className="space-y-3">
                        {paginatedUpcoming.map((appointment) => (
                          <div key={appointment.id} className="rounded-xl border border-gray-200 bg-white p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  {renderPatientName(appointment, 'font-semibold text-gray-900')}
                                  {isNewPatientAppointment(appointment) && renderNewPatientBadge()}
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                  {formatDoctorDisplayName(appointment.doctor_name)} • {formatDateDDMMYYYY(appointment.date)} • {formatTime(appointment.time)}
                                </p>
                                {isNewPatientAppointment(appointment) && (
                                  <p className="text-xs text-amber-700 mt-1">
                                    {appointment.guest_phone || 'No phone'}{appointment.guest_source ? ` • ${appointment.guest_source}` : ''}
                                  </p>
                                )}
                                <p className="text-xs text-gray-600 mt-1">{appointment.type || 'Checkup'}</p>
                              </div>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${getStatusColor(appointment.status)}`}>
                                {appointment.status}
                              </span>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {renderAppointmentActionButtons(appointment)}
                              {isNewPatientAppointment(appointment) && onConvertLead && (
                                <button onClick={() => onConvertLead(appointment)} className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors">
                                  <User className="w-3.5 h-3.5" />
                                  Convert
                                </button>
                              )}
                              <select value={appointment.status} onChange={(e) => onUpdateStatus(appointment.id, e.target.value as any)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                                <option value="Scheduled">Scheduled</option>
                                <option value="Completed">Completed</option>
                                <option value="Cancelled">Cancelled</option>
                              </select>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                      <Clock className="w-5 h-5 text-gray-600" />
                      Past Appointments
                    </h3>
                    {paginatedPast.length === 0 ? (
                      <div className="text-center py-8 text-gray-400 italic text-sm">No past appointments.</div>
                    ) : (
                      <div className="space-y-3">
                        {paginatedPast.map((appointment) => (
                          <div key={appointment.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4 opacity-90">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  {renderPatientName(appointment, 'font-semibold text-gray-800')}
                                  {isNewPatientAppointment(appointment) && renderNewPatientBadge()}
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                  {formatDoctorDisplayName(appointment.doctor_name)} • {formatDateDDMMYYYY(appointment.date)} • {formatTime(appointment.time)}
                                </p>
                                {isNewPatientAppointment(appointment) && (
                                  <p className="text-xs text-amber-700 mt-1">
                                    {appointment.guest_phone || 'No phone'}{appointment.guest_source ? ` • ${appointment.guest_source}` : ''}
                                  </p>
                                )}
                                <p className="text-xs text-gray-600 mt-1">{appointment.type || 'Checkup'}</p>
                              </div>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${getStatusColor(appointment.status)}`}>
                                {appointment.status}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (() => {
                const tableRows = paginatedTableAppointments;

                return (
                  <div className="rounded-2xl border border-indigo-200 bg-white shadow-sm overflow-hidden">
                    <div className="max-h-[calc(100vh-260px)] overflow-auto">
                      <table className="min-w-[960px] w-full text-sm">
                        <thead className="bg-indigo-50 border-b border-indigo-200">
                          <tr className="text-indigo-700">
                            <th className="sticky top-0 z-20 bg-indigo-50 px-3 py-3 text-left font-bold uppercase text-xs tracking-wide">No.</th>
                            <th className="sticky top-0 z-20 bg-indigo-50 px-3 py-3 text-left font-bold uppercase text-xs tracking-wide">Dr. Name</th>
                            <th className="sticky top-0 z-20 bg-indigo-50 px-3 py-3 text-left font-bold uppercase text-xs tracking-wide">Date</th>
                            <th className="sticky top-0 z-20 bg-indigo-50 px-3 py-3 text-left font-bold uppercase text-xs tracking-wide">Time</th>
                            <th className="sticky top-0 z-20 bg-indigo-50 px-3 py-3 text-left font-bold uppercase text-xs tracking-wide">Pt Name</th>
                            <th className="sticky top-0 z-20 bg-indigo-50 px-3 py-3 text-left font-bold uppercase text-xs tracking-wide">Tx</th>
                            <th className="sticky top-0 z-20 bg-indigo-50 px-3 py-3 text-left font-bold uppercase text-xs tracking-wide">Status</th>
                            <th className="sticky top-0 z-20 bg-indigo-50 px-3 py-3 text-left font-bold uppercase text-xs tracking-wide">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tableRows.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="px-3 py-8 text-center text-gray-400 italic">
                                No appointments found{dateQuickFilter === 'all' ? '.' : ` for ${dateQuickFilter}.`}
                              </td>
                            </tr>
                          ) : (
                            tableRows.map((appointment, index) => {
                              const rowNo = showAll ? index + 1 : (currentPage - 1) * itemsPerPage + index + 1;
                              const rowStyle = appointment.status === 'Cancelled'
                                ? 'bg-red-100/80 border-l-4 border-l-red-500'
                                : appointment.status === 'Completed'
                                ? 'bg-emerald-100/80 border-l-4 border-l-emerald-500'
                                : 'bg-white';
                              return (
                                <tr key={appointment.id} className={`${rowStyle} border-b border-gray-100 last:border-b-0`}>
                                  <td className="px-3 py-3 align-top font-semibold text-gray-700">{rowNo}</td>
                                  <td className="px-3 py-3 align-top text-gray-800">{formatDoctorDisplayName(appointment.doctor_name)}</td>
                                  <td className="px-3 py-3 align-top text-gray-700 whitespace-nowrap">{formatDateDDMMYYYY(appointment.date)}</td>
                                  <td className="px-3 py-3 align-top text-gray-700 whitespace-nowrap">{formatTime(appointment.time)}</td>
                                  <td className="px-3 py-3 align-top font-medium text-gray-900">
                                    <div className="flex flex-wrap items-center gap-2">
                                      {renderPatientName(appointment, '')}
                                      {isNewPatientAppointment(appointment) && renderNewPatientBadge(true)}
                                    </div>
                                    {isNewPatientAppointment(appointment) && (
                                      <div className="mt-1 text-xs font-normal text-amber-700">
                                        {appointment.guest_phone || 'No phone'}{appointment.guest_source ? ` • ${appointment.guest_source}` : ''}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-3 py-3 align-top text-gray-700">{appointment.type || 'Checkup'}</td>
                                  <td className="px-3 py-3 align-top">
                                    <select
                                      value={appointment.status}
                                      onChange={(e) => onUpdateStatus(appointment.id, e.target.value as any)}
                                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                                    >
                                      <option value="Scheduled">Scheduled</option>
                                      <option value="Completed">Completed</option>
                                      <option value="Cancelled">Cancelled</option>
                                    </select>
                                  </td>
                                  <td className="px-3 py-3 align-top">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {renderAppointmentActionButtons(appointment, true)}
                                      {isNewPatientAppointment(appointment) && onConvertLead && (
                                        <button
                                          onClick={() => onConvertLead(appointment)}
                                          className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
                                          title="Convert new patient to registered patient"
                                        >
                                          <User className="w-3.5 h-3.5" />
                                          Convert
                                        </button>
                                      )}
                                      {canDelete && (
                                        <button
                                          onClick={() => {
                                            setAppointmentToDelete(appointment.id);
                                            setDeleteConfirmOpen(true);
                                          }}
                                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                          title="Delete appointment"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {uiStyle === 'table' && (
                <div className="mt-4 rounded-xl border border-gray-100 bg-white p-3">
                  <Pagination
                    totalItems={onQueryChange ? (totalAppointments || 0) : sortedTableAppointments.length}
                    itemsPerPage={itemsPerPage}
                    currentPage={currentPage}
                    onPageChange={(page) => {
                      setShowAll(false);
                      setCurrentPage(page);
                    }}
                    showAll={showAll}
                    onToggleShowAll={() => setShowAll(!showAll)}
                    showAllToggle={false}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              {/* Calendar Navigation */}
              <div className="flex items-center justify-between mb-3 md:mb-4">
                <button
                  onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1))}
                  className="p-1.5 md:p-2 rounded-lg border border-gray-200 hover:bg-gray-50"
                  title="Previous month"
                >
                  <ChevronLeft className="w-3.5 h-3.5 md:w-4 md:h-4" />
                </button>
                <h3 className="text-sm md:text-lg font-semibold text-gray-800">{monthLabel}</h3>
                <button
                  onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1))}
                  className="p-1.5 md:p-2 rounded-lg border border-gray-200 hover:bg-gray-50"
                  title="Next month"
                >
                  <ChevronRight className="w-3.5 h-3.5 md:w-4 md:h-4" />
                </button>
              </div>

              {/* Day Headers */}
              <div className="grid grid-cols-7 gap-0.5 md:gap-2 mb-1 md:mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <div key={day} className="text-[10px] md:text-xs font-bold text-gray-500 uppercase text-center py-0.5 md:py-1">
                    {day}
                  </div>
                ))}
              </div>

              {/* Calendar Grid */}
              <div className="grid grid-cols-7 gap-0.5 md:gap-2">
                {calendarGrid.map((cell, idx) => {
                  const dayAppointments = cell.isoDate ? (appointmentMapByDate.get(cell.isoDate) || []) : [];
                  const isSelected = !!cell.isoDate && cell.isoDate === selectedCalendarDate;
                  const isToday = !!cell.isoDate && cell.isoDate === todayISO;

                  return (
                    <button
                      key={`${cell.isoDate || 'empty'}-${idx}`}
                      onClick={() => cell.isoDate && applySingleDateFilter(cell.isoDate)}
                      disabled={!cell.isoDate}
                      className={`min-h-[36px] md:min-h-[80px] text-left border rounded md:rounded-xl p-0.5 md:p-2 transition-colors ${
                        !cell.inCurrentMonth
                          ? 'bg-gray-50 border-gray-100 cursor-default'
                          : isSelected
                          ? 'bg-indigo-50 border-indigo-300'
                          : 'bg-white border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {cell.date && (
                        <>
                          <div className={`text-[11px] md:text-xs font-semibold mb-0 md:mb-1 ${isToday ? 'text-indigo-700' : 'text-gray-700'}`}>
                            {cell.date.getDate()}
                          </div>
                          <div className="hidden md:block space-y-0.5 md:space-y-1">
                            {dayAppointments.slice(0, 2).map((apt) => (
                              <div
                                key={apt.id}
                                className={`text-[9px] md:text-[10px] px-1 md:px-1.5 py-0.5 rounded truncate border ${getStatusColor(apt.status)}`}
                                title={`${formatTime(apt.time)} - ${apt.patient_name || 'Unknown Patient'}`}
                              >
                                {formatTime(apt.time)} {apt.patient_name || 'Unknown'}
                              </div>
                            ))}
                            {dayAppointments.length > 2 && (
                              <div className="text-[9px] md:text-[10px] text-gray-500">+{dayAppointments.length - 2} more</div>
                            )}
                          </div>
                          {/* Mobile: show dot indicators for appointments */}
                          <div className="flex md:hidden gap-0.5 mt-0.5 flex-wrap">
                            {dayAppointments.slice(0, 4).map((apt) => (
                              <span
                                key={apt.id}
                                className={`inline-block w-1.5 h-1.5 rounded-full ${
                                  apt.status === 'Scheduled' ? 'bg-blue-500' :
                                  apt.status === 'Completed' ? 'bg-emerald-500' :
                                  'bg-red-400'
                                }`}
                                title={`${formatTime(apt.time)} - ${apt.patient_name || 'Unknown Patient'}`}
                              />
                            ))}
                            {dayAppointments.length > 4 && (
                              <span className="text-[8px] text-gray-400">+{dayAppointments.length - 4}</span>
                            )}
                          </div>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Selected Day Appointments */}
              <div className="mt-3 md:mt-6 border border-gray-200 rounded-lg md:rounded-xl p-3 md:p-4">
                <h4 className="text-xs md:text-sm font-semibold text-gray-800 mb-2 md:mb-3">
                  {selectedCalendarDate
                    ? `Appointments for ${formatDate(selectedCalendarDate)}`
                    : 'Select a date to view appointments'}
                </h4>

                {!selectedCalendarDate || selectedDayAppointments.length === 0 ? (
                  <p className="text-xs md:text-sm text-gray-500 italic">No appointments found for this date.</p>
                ) : (
                  <div className="space-y-1.5 md:space-y-2">
                    {selectedDayAppointments.map((appointment) => {
                      const clinicalPlan = parseAppointmentClinicalFocus(appointment.notes);
                      return (
                        <div key={appointment.id} className="flex flex-col md:flex-row md:items-center justify-between p-2 md:p-3 border border-gray-200 rounded-lg gap-2 md:gap-0">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5 md:gap-2 text-xs md:text-sm font-medium text-gray-900">
                              {renderPatientName(appointment, 'truncate')}
                              {isNewPatientAppointment(appointment) && renderNewPatientBadge(true)}
                            </div>
                            <div className="text-[11px] md:text-xs text-gray-500 mt-0.5 truncate">
                              {formatTime(appointment.time)} • {appointment.type || 'Checkup'}
                              {appointment.doctor_name ? ` • ${formatDoctorDisplayName(appointment.doctor_name)}` : ''}
                            </div>
                            {isNewPatientAppointment(appointment) && (
                              <div className="mt-0.5 text-[11px] md:text-xs text-amber-700 truncate">
                                {appointment.guest_phone || 'No phone'}{appointment.guest_source ? ` • ${appointment.guest_source}` : ''}
                              </div>
                            )}
                            {clinicalPlan.clinicalFocus && (
                              <div className="mt-0.5 text-[11px] md:text-xs text-indigo-700 truncate">
                                Focus: {clinicalPlan.clinicalFocus}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 md:gap-2 flex-shrink-0">
                            {renderAppointmentActionButtons(appointment, true)}
                            {isNewPatientAppointment(appointment) && onConvertLead ? (
                              <button
                                onClick={() => onConvertLead(appointment)}
                                className="inline-flex items-center gap-1 md:gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 md:px-2.5 py-1 md:py-1.5 text-[11px] md:text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
                                title="Convert new patient to registered patient"
                              >
                                <User className="w-3 h-3 md:w-3.5 md:h-3.5" />
                                <span className="hidden sm:inline">Convert</span>
                                <span className="sm:hidden">New Patient</span>
                              </button>
                            ) : null}
                            <select
                              value={appointment.status}
                              onChange={(e) => onUpdateStatus(appointment.id, e.target.value as any)}
                              className="text-[11px] md:text-xs border border-gray-200 rounded-lg px-1.5 md:px-2 py-1"
                            >
                              <option value="Scheduled">Scheduled</option>
                              <option value="Completed">Completed</option>
                              <option value="Cancelled">Cancelled</option>
                            </select>
                            {canDelete && (
                              <button
                                onClick={() => {
                                  setAppointmentToDelete(appointment.id);
                                  setDeleteConfirmOpen(true);
                                }}
                                className="p-1.5 md:p-2 text-red-600 hover:bg-red-50 rounded-lg"
                              >
                                <Trash2 className="w-3.5 h-3.5 md:w-4 md:h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {doctorCorrectionAppointment && (
        <Modal title="Correct Visit Doctor" onClose={closeDoctorCorrection} maxWidthClassName="max-w-2xl" closeDisabled={doctorCorrectionSubmitting}>
          {doctorCorrectionLoading ? (
            <div className="flex items-center justify-center gap-3 py-12 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" />Reviewing related visit records…</div>
          ) : doctorCorrectionPreview ? (
            <div className="space-y-5">
              <div className="grid gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm sm:grid-cols-2">
                <div><span className="font-semibold text-gray-500">Patient:</span> <span className="font-bold text-gray-900">{doctorCorrectionPreview.patient_name}</span></div>
                <div><span className="font-semibold text-gray-500">Visit:</span> <span className="font-bold text-gray-900">{formatDateDDMMYYYY(doctorCorrectionPreview.visit_date)} at {formatTime(doctorCorrectionPreview.visit_time)}</span></div>
                <div><span className="font-semibold text-gray-500">Current doctor:</span> <span className="font-bold text-gray-900">{formatDoctorDisplayName(doctorCorrectionPreview.old_doctor_name)}</span></div>
                <div><span className="font-semibold text-gray-500">Status:</span> <span className="font-bold text-gray-900">{doctorCorrectionPreview.status}</span></div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">Correct doctor</label>
                <SearchableSelect
                  value={correctDoctorId}
                  onChange={setCorrectDoctorId}
                  options={doctors
                    .filter((doctor) => doctor.id !== doctorCorrectionPreview.old_doctor_id)
                    .map((doctor) => ({ value: doctor.id, label: formatDoctorDisplayName(doctor.name) }))}
                  placeholder="Search and select the correct doctor"
                  emptyMessage="No matching doctors found"
                />
              </div>
              {doctorCorrectionPreview.treatments.length > 0 && (
                <div>
                  <div className="mb-2"><h4 className="text-sm font-bold text-gray-900">Treatments to reassign</h4><p className="text-xs text-gray-500">Linked treatments are preselected. Review unlinked same-day records carefully.</p></div>
                  <div className="space-y-2 rounded-2xl border border-gray-200 p-3">
                    {doctorCorrectionPreview.treatments.map((treatment) => (
                      <label key={treatment.id} className={`flex items-start gap-3 rounded-xl border p-3 ${treatment.has_financial_history ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white'}`}>
                        <input type="checkbox" checked={selectedCorrectionTreatmentIds.includes(treatment.id)} disabled={doctorCorrectionSubmitting || treatment.has_financial_history} onChange={(event) => setSelectedCorrectionTreatmentIds((current) => event.target.checked ? Array.from(new Set([...current, treatment.id])) : current.filter((id) => id !== treatment.id))} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-gray-900">{treatment.description}</span>
                          <span className="block text-xs text-gray-500">{formatDateDDMMYYYY(treatment.date)}{treatment.linked_to_appointment ? ' • Linked to this appointment' : ' • Same-day candidate (not linked)'}</span>
                          {treatment.has_financial_history && <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-red-700"><AlertTriangle className="h-3.5 w-3.5" />Paid/commissioned treatment — blocked from this correction</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label htmlFor="doctor-correction-reason" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">Reason for correction</label>
                <textarea id="doctor-correction-reason" value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} maxLength={1000} rows={4} disabled={doctorCorrectionSubmitting} placeholder="Explain why the original doctor assignment was incorrect (minimum 10 characters)." className="w-full resize-y rounded-xl border border-gray-200 p-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60" />
                <p className="mt-1 text-right text-xs text-gray-400">{correctionReason.trim().length}/1000</p>
              </div>
              {doctorCorrectionError && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /><span>{doctorCorrectionError}</span></div>}
              <div className="flex flex-col-reverse gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeDoctorCorrection} disabled={doctorCorrectionSubmitting} className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
                <button type="button" onClick={() => void submitDoctorCorrection()} disabled={doctorCorrectionSubmitting || !correctDoctorId || correctionReason.trim().length < 10} className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-amber-600/20 hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50">{doctorCorrectionSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}Confirm Correction</button>
              </div>
            </div>
          ) : (
            <div className="space-y-4"><div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /><span>{doctorCorrectionError || 'Could not load the doctor correction preview.'}</span></div><div className="flex justify-end"><button type="button" onClick={closeDoctorCorrection} className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-bold text-gray-600">Close</button></div></div>
          )}
        </Modal>
      )}

      {/* Delete Confirmation Dialog */}
      {canDelete && (
        <ConfirmDialog
          isOpen={deleteConfirmOpen}
          title="Delete Appointment"
          message="Are you sure you want to delete this appointment? This action cannot be undone."
          confirmText="Delete Appointment"
          cancelText="Cancel"
          type="danger"
          onConfirm={() => {
            if (appointmentToDelete) {
              onDeleteAppointment(appointmentToDelete);
              setAppointmentToDelete(null);
            }
            setDeleteConfirmOpen(false);
          }}
          onCancel={() => {
            setAppointmentToDelete(null);
            setDeleteConfirmOpen(false);
          }}
        />
      )}
    </div>
  );
};

export default AppointmentsView;




