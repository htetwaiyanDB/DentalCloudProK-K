import React, { useState, useMemo } from 'react';
import { Plus, Edit2, Trash2, Clock, Loader2, User, RotateCw } from 'lucide-react';
import { Doctor, DoctorSchedule } from '../types';
import { exportDoctorsToPDF } from '../utils/pdfExport';
import { exportDoctorsToExcel } from '../utils/excelExport';
import { Currency, formatCurrency } from '../utils/currency';
import { usesFlatVisitCommission } from '../utils/doctorCommission';
import Pagination from './Pagination';
import { ConfirmDialog } from './Shared';
import ExportMenu from './ExportMenu';

interface DoctorsViewProps {
  doctors: Doctor[];
  loading: boolean;
  currency: Currency;
  onAdd: () => void;
  onEdit: (doctor: Doctor) => void;
  onDelete: (id: string) => void;
  onRefresh?: () => void | Promise<void>;
}

const DoctorsView: React.FC<DoctorsViewProps> = ({
  doctors,
  loading,
  currency,
  onAdd,
  onEdit,
  onDelete,
  onRefresh
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [doctorToDelete, setDoctorToDelete] = useState<string | null>(null);
  const itemsPerPage = 10;
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Filtered data based on search term
  const filteredDoctors = useMemo(() => {
    if (!searchTerm) return doctors;
    const term = searchTerm.toLowerCase();
    return doctors.filter(doctor => 
      doctor.name.toLowerCase().includes(term) ||
      doctor.specialization?.toLowerCase().includes(term) ||
      doctor.email?.toLowerCase().includes(term) ||
      doctor.phone?.toLowerCase().includes(term)
    );
  }, [doctors, searchTerm]);

  // Paginated data
  const paginatedDoctors = useMemo(() => {
    if (showAll) return filteredDoctors;
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredDoctors.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredDoctors, currentPage, showAll]);

  // Reset to first page when doctors change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [doctors]);

  const handleDownloadPDF = () => {
    exportDoctorsToPDF(doctors);
  };

  const handleDownloadExcel = async () => {
    await exportDoctorsToExcel(doctors);
  };

  const formatSchedule = (schedules: DoctorSchedule[]) => {
    if (schedules.length === 0) return 'No schedule set';
    
    const grouped = schedules.reduce((acc, sched) => {
      const dayName = dayNames[sched.day_of_week];
      if (!acc[dayName]) acc[dayName] = [];
      acc[dayName].push(`${sched.start_time} - ${sched.end_time}`);
      return acc;
    }, {} as Record<string, string[]>);

    return Object.entries(grouped)
      .map(([day, times]) => `${day}: ${times.join(', ')}`)
      .join(' | ');
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden animate-fade-in">
      <div className="p-4 md:p-6 border-b border-gray-100 bg-white sticky top-0 z-10">
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
          <div className="min-w-0">
            <h2 className="text-lg md:text-xl font-bold text-gray-800 truncate">Doctors & Schedules</h2>
          <p className="text-xs md:text-sm text-gray-500 truncate">Manage doctors and their working schedules</p>
        </div>
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch gap-2 sm:gap-3">
          <div className="relative">
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1); // Reset to first page when searching
              }}
              className="w-full sm:w-48 lg:w-64 pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button
            type="button"
            onClick={() => void onRefresh?.()}
            className="refresh-action-button inline-flex items-center gap-2 border px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-bold whitespace-nowrap"
          >
            <RotateCw className="refresh-action-icon w-4 h-4 shrink-0" /> <span>Refresh</span>
          </button>
          <ExportMenu
            disabled={doctors.length === 0}
            onExportPDF={handleDownloadPDF}
            onExportExcel={handleDownloadExcel}
          />
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-2 bg-indigo-600 text-white px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium hover:bg-indigo-700 transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4 shrink-0" /> <span>Add Doctor</span>
          </button>
        </div>
        </div>
      </div>

      {loading ? (
        <div className="p-8 md:p-12 flex justify-center">
          <Loader2 className="animate-spin text-[var(--hover-600)]" />
        </div>
      ) : doctors.length === 0 ? (
        <div className="p-8 md:p-12 text-center text-gray-400 italic">
          No doctors found. Add your first doctor to begin.
        </div>
      ) : (
        <div className="p-3 sm:p-4 md:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {paginatedDoctors.map((doctor) => (
              <div
                key={doctor.id}
                className="border border-gray-200 rounded-xl p-4 sm:p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3 sm:mb-4 gap-2">
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm sm:text-lg flex-shrink-0">
                      {doctor.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-gray-900 text-lg truncate">{doctor.name}</h3>
                      {doctor.specialization && (
                        <p className="text-sm text-gray-600 truncate">{doctor.specialization}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 sm:gap-2 flex-shrink-0">
                    <button
                      onClick={() => onEdit(doctor)}
                      className="p-1.5 sm:p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                      title="Edit doctor"
                    >
                      <Edit2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setDoctorToDelete(doctor.id);
                        setDeleteConfirmOpen(true);
                      }}
                      className="p-1.5 sm:p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete doctor"
                    >
                      <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-2 sm:space-y-3">
                  {doctor.email && (
                    <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-600 truncate">
                      <span className="font-medium shrink-0">Email:</span>
                      <span>{doctor.email}</span>
                    </div>
                  )}
                  {doctor.phone && (
                    <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-600 truncate">
                      <span className="font-medium shrink-0">Phone:</span>
                      <span>{doctor.phone}</span>
                    </div>
                  )}
                  
                  {usesFlatVisitCommission({ commissionType: doctor.commission_type, specialization: doctor.specialization }) ? (
                    <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-600 truncate">
                      <span className="font-medium shrink-0">Commission:</span>
                      <span className="text-green-700 font-bold">{formatCurrency(Number(doctor.commission_per_visit || 0), currency)}/visit</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-600 truncate">
                      <span className="font-medium shrink-0">Commission:</span>
                      <span className="text-green-700 font-bold">{doctor.commission_percentage ?? 0}%</span>
                    </div>
                  )}
                  
                  <div className="pt-2 sm:pt-3 border-t border-gray-100">
                    <div className="flex items-start gap-1.5 sm:gap-2">
                      <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] sm:text-xs font-semibold text-gray-500 uppercase mb-0.5 sm:mb-1">Schedule</p>
                        <p className="text-xs sm:text-sm text-gray-700 leading-relaxed break-words">
                          {formatSchedule(doctor.schedules)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {!loading && doctors.length > 0 && (
        <Pagination
          totalItems={doctors.length}
          itemsPerPage={itemsPerPage}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          showAll={showAll}
          onToggleShowAll={() => setShowAll(!showAll)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title="Delete Doctor"
        message={`Are you sure you want to delete this doctor? This action cannot be undone.`}
        confirmText="Delete Doctor"
        cancelText="Cancel"
        type="danger"
        onConfirm={() => {
          if (doctorToDelete) {
            onDelete(doctorToDelete);
            setDoctorToDelete(null);
          }
          setDeleteConfirmOpen(false);
        }}
        onCancel={() => {
          setDoctorToDelete(null);
          setDeleteConfirmOpen(false);
        }}
      />
    </div>
  );
};

export default DoctorsView;

