import React, { useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, Loader2, BarChart3, Eye, TrendingDown, DollarSign, Calendar, Tag, RotateCw } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { ClinicalRecord, Expense, Location, MedicineSale } from '../types';
import { formatCurrency, Currency } from '../utils/currency';
import { exportExpensesToPDF } from '../utils/pdfExport';
import { exportExpensesToExcel } from '../utils/excelExport';
import { Modal } from './Shared';
import Pagination from './Pagination';
import ExportMenu from './ExportMenu';
import { toLocalISODate } from '../utils/auditLogFilters';

type ExpenseDateQuickFilter = 'today' | 'tomorrow' | 'all' | 'custom';

interface ExpensesViewProps {
  expenses: Expense[];
  treatmentRecords: ClinicalRecord[];
  medicineSales: MedicineSale[];
  locations: Location[];
  currentLocationId?: string;
  loading: boolean;
  currency: Currency;
  onAdd: () => void;
  onEdit: (expense: Expense) => void;
  onDelete: (id: string) => void;
  onRefresh?: () => void | Promise<void>;
}

const ExpensesView: React.FC<ExpensesViewProps> = ({
  expenses,
  treatmentRecords,
  medicineSales,
  locations,
  currentLocationId,
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
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const todayKey = useMemo(() => toLocalISODate(new Date()), []);
  const [dateFrom, setDateFrom] = useState(todayKey);
  const [dateTo, setDateTo] = useState(todayKey);
  const [dateQuickFilter, setDateQuickFilter] = useState<ExpenseDateQuickFilter>('today');
  const itemsPerPage = 10;
  const isTodayRange = dateFrom === todayKey && dateTo === todayKey;
  const tomorrowKey = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return toLocalISODate(tomorrow);
  }, []);
  const allExpenseDates = useMemo(() => expenses.map(expense => expense.date.slice(0, 10)).filter(Boolean), [expenses]);
  const allDateFrom = allExpenseDates.length ? allExpenseDates.reduce((earliest, date) => date < earliest ? date : earliest) : todayKey;
  const allDateTo = allExpenseDates.length ? allExpenseDates.reduce((latest, date) => date > latest ? date : latest) : todayKey;

  const handleDateFromChange = (value: string) => {
    setDateFrom(value);
    if (value > dateTo) setDateTo(value);
    setDateQuickFilter('custom');
    setCurrentPage(1);
  };

  const handleDateToChange = (value: string) => {
    setDateTo(value);
    if (value < dateFrom) setDateFrom(value);
    setDateQuickFilter('custom');
    setCurrentPage(1);
  };

  const applyQuickDateFilter = (filter: Exclude<ExpenseDateQuickFilter, 'custom'>) => {
    if (filter === 'all') {
      setDateFrom(allDateFrom);
      setDateTo(allDateTo);
    } else {
      const date = filter === 'today' ? todayKey : tomorrowKey;
      setDateFrom(date);
      setDateTo(date);
    }
    setDateQuickFilter(filter);
    setCurrentPage(1);
  };

  const categories = useMemo(() => {
    const unique = new Set<string>();
    expenses.forEach(expense => {
      if (expense.category) unique.add(expense.category);
    });
    return Array.from(unique).sort();
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return expenses.filter(expense => {
      const matchesTerm = !term
        || expense.description.toLowerCase().includes(term)
        || expense.category.toLowerCase().includes(term)
        || expense.date.toLowerCase().includes(term);
      const matchesCategory = categoryFilter === 'all' || expense.category === categoryFilter;
      const matchesDateRange = expense.date >= dateFrom && expense.date <= dateTo;
      return matchesTerm && matchesCategory && matchesDateRange;
    });
  }, [expenses, searchTerm, categoryFilter, dateFrom, dateTo]);

  const paginatedExpenses = useMemo(() => {
    if (showAll) return filteredExpenses;
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredExpenses.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredExpenses, currentPage, showAll]);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [expenses]);

  const selectedExpensesTotal = filteredExpenses.reduce((sum, expense) => sum + (expense.amount || 0), 0);
  const selectedTreatmentRevenue = treatmentRecords
    .filter(record => record.date >= dateFrom && record.date <= dateTo)
    .reduce((sum, record) => sum + (record.cost || 0), 0);
  const selectedMedicineRevenue = medicineSales
    .filter(sale => sale.date >= dateFrom && sale.date <= dateTo)
    .reduce((sum, sale) => sum + (sale.total_price || 0), 0);
  const selectedRevenue = selectedTreatmentRevenue + selectedMedicineRevenue;
  const selectedProfit = selectedRevenue - selectedExpensesTotal;

  const hasFinancialData = expenses.length > 0 || treatmentRecords.length > 0 || medicineSales.length > 0;

  const monthlyChartData = useMemo(() => {
    const data: { key: string; label: string; total: number }[] = [];
    const start = new Date(`${dateFrom}T00:00:00`);
    const end = new Date(`${dateTo}T00:00:00`);
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);

    while (cursor <= endMonth) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      const point = new Date(cursor);
      const label = point.toLocaleString('default', { month: 'short' });
      data.push({
        key,
        label: `${label} ${point.getFullYear()}`,
        total: 0
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    filteredExpenses.forEach(exp => {
      const entry = data.find(item => exp.date.startsWith(item.key));
      if (entry) entry.total += exp.amount || 0;
    });
    return data;
  }, [filteredExpenses, dateFrom, dateTo]);

  const categoryChartData = useMemo(() => {
    const totals = new Map<string, number>();
    filteredExpenses.forEach(exp => {
      const key = exp.category || 'Uncategorized';
      totals.set(key, (totals.get(key) || 0) + (exp.amount || 0));
    });
    return Array.from(totals.entries())
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [filteredExpenses]);

  const handleDownloadPDF = () => {
    exportExpensesToPDF(filteredExpenses, currency);
  };

  const handleDownloadExcel = async () => {
    await exportExpensesToExcel(filteredExpenses, currency);
  };

  const openDetailModal = (expense: Expense) => {
    setSelectedExpense(expense);
    setShowDetailModal(true);
  };

  const closeDetailModal = () => {
    setShowDetailModal(false);
    setSelectedExpense(null);
  };

  const getLocationName = (locationId?: string | null) => {
    const resolvedId = locationId || currentLocationId || '';
    return locations.find((location) => location.id === resolvedId)?.name || 'Current Branch';
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      'Equipment': 'bg-blue-100 text-blue-700 border-blue-200',
      'Supplies': 'bg-green-100 text-green-700 border-green-200',
      'Maintenance': 'bg-orange-100 text-orange-700 border-orange-200',
      'Utilities': 'bg-purple-100 text-purple-700 border-purple-200',
      'Rent': 'bg-red-100 text-red-700 border-red-200',
      'Salary': 'bg-indigo-100 text-indigo-700 border-indigo-200',
      'Material Cost': 'bg-cyan-100 text-cyan-700 border-cyan-200',
      'Lab Cost': 'bg-violet-100 text-violet-700 border-violet-200',
      'Special Doctor Cost': 'bg-amber-100 text-amber-700 border-amber-200',
    };
    return colors[category] || 'bg-gray-100 text-gray-700 border-gray-200';
  };

  const formatDisplayDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">              
              Expense Management
            </h2>
            <p className="mt-1 text-sm text-gray-500 ">Track and analyze clinic operating expenses</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void onRefresh?.()}
              className="refresh-action-button flex items-center gap-2 px-5 py-2.5 border rounded-xl text-sm font-bold"
            >
              <RotateCw className="refresh-action-icon w-4 h-4" />
              Refresh
            </button>
            <ExportMenu
              disabled={filteredExpenses.length === 0}
              onExportPDF={handleDownloadPDF}
              onExportExcel={handleDownloadExcel}
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-700"
            />
            <button
              onClick={onAdd}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl text-sm font-semibold hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-sm hover:shadow-md"
            >
              <Plus className="w-4 h-4" />
              Add Expense
            </button>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="relative w-full xl:w-[280px] xl:flex-none">
            <input
              type="text"
              placeholder="Search by description, category, or date..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-11 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-white min-w-[180px]"
          >
            <option value="all">All Categories</option>
            {categories.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2 sm:w-auto">
            <label className="min-w-0 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
              From
              <input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(event) => handleDateFromChange(event.target.value)}
                className="mt-1 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-800 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 sm:w-36"
              />
            </label>
            <label className="min-w-0 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
              To
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                onChange={(event) => handleDateToChange(event.target.value)}
                className="mt-1 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-800 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 sm:w-36"
              />
            </label>
          </div>
          <div className="grid w-full grid-cols-3 rounded-xl border border-slate-200 bg-slate-50 p-1 sm:w-[206px]">
            {([
              { value: 'all', label: 'All' },
              { value: 'tomorrow', label: 'Tomorrow' },
              { value: 'today', label: 'Today' }
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => applyQuickDateFilter(option.value)}
                aria-pressed={dateQuickFilter === option.value}
                className={`min-h-9 rounded-lg px-2 py-2 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                  dateQuickFilter === option.value
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      {!loading && hasFinancialData && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-5 border border-blue-200/60">
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-white rounded-lg shadow-sm">
                  <Calendar className="w-5 h-5 text-blue-600" />
                </div>
                <span className="text-xs font-semibold text-blue-600 bg-white px-2.5 py-1 rounded-full">{isTodayRange ? 'Today' : 'Selected'}</span>
              </div>
              <p className="text-lg font-bold text-gray-900">{formatCurrency(selectedExpensesTotal, currency)}</p>
              <p className="text-xs text-gray-600 mt-1">Selected-period expenses</p>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-2xl p-5 border border-purple-200/60">
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-white rounded-lg shadow-sm">
                  <Calendar className="w-5 h-5 text-purple-600" />
                </div>
                <span className="text-xs font-semibold text-purple-600 bg-white px-2.5 py-1 rounded-full">Revenue</span>
              </div>
              <p className="text-lg font-bold text-gray-900">{formatCurrency(selectedRevenue, currency)}</p>
              <p className="text-xs text-gray-600 mt-1">Treatments + medicine</p>
            </div>

            <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-2xl p-5 border border-orange-200/60">
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-white rounded-lg shadow-sm">
                  <DollarSign className="w-5 h-5 text-orange-600" />
                </div>
                <span className="text-xs font-semibold text-orange-600 bg-white px-2.5 py-1 rounded-full">Profit</span>
              </div>
              <p className={`text-lg font-bold ${selectedProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(selectedProfit, currency)}</p>
              <p className="text-xs text-gray-600 mt-1">Revenue minus expenses</p>
            </div>

            <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-5 border border-gray-200/60">
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-white rounded-lg shadow-sm">
                  <Tag className="w-5 h-5 text-gray-600" />
                </div>
                <span className="text-xs font-semibold text-gray-600 bg-white px-2.5 py-1 rounded-full">Filtered</span>
              </div>
              <p className="text-lg font-bold text-gray-900">{filteredExpenses.length}</p>
              <p className="text-xs text-gray-600 mt-1">Expense records</p>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl p-6 border border-gray-200/60 shadow-sm">
              <div className="flex items-center gap-3 mb-5">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <BarChart3 className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Expenses Trend</h3>
                  <p className="text-xs text-gray-500">Selected period, shown by month</p>
                </div>
              </div>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyChartData} margin={{ left: 10, right: 20, top: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis 
                      dataKey="label" 
                      tick={{ fill: '#6B7280', fontSize: 11 }} 
                      axisLine={{ stroke: '#E5E7EB' }} 
                      tickLine={false}
                    />
                    <YAxis 
                      tick={{ fill: '#6B7280', fontSize: 11 }} 
                      axisLine={{ stroke: '#E5E7EB' }} 
                      tickLine={false}
                      tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                    />
                    <Tooltip 
                      formatter={(value: number | undefined) => formatCurrency(value ?? 0, currency)}
                      contentStyle={{ 
                        backgroundColor: '#fff',
                        border: '1px solid #E5E7EB',
                        borderRadius: '12px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                      }}
                    />
                    <Bar dataKey="total" radius={[8, 8, 0, 0]} maxBarSize={60}>
                      {monthlyChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.total > 0 ? '#3B82F6' : '#E5E7EB'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 border border-gray-200/60 shadow-sm">
              <div className="flex items-center gap-3 mb-5">
                <div className="p-2 bg-orange-50 rounded-lg">
                  <BarChart3 className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Top Expense Categories</h3>
                  <p className="text-xs text-gray-500">Highest spending in the selected period</p>
                </div>
              </div>
              <div className="h-[260px]">
                {categoryChartData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                    No category data available
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryChartData} layout="vertical" margin={{ left: 100, right: 20, top: 10, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#E5E7EB" />
                      <XAxis 
                        type="number" 
                        hide
                      />
                      <YAxis 
                        type="category" 
                        dataKey="category" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#374151', fontSize: 12, fontWeight: 500 }}
                        width={90}
                      />
                      <Tooltip 
                        formatter={(value: number | undefined) => formatCurrency(value ?? 0, currency)}
                        contentStyle={{ 
                          backgroundColor: '#fff',
                          border: '1px solid #E5E7EB',
                          borderRadius: '12px',
                          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                        }}
                      />
                      <Bar dataKey="total" radius={[0, 8, 8, 0]} barSize={24}>
                        {categoryChartData.map((entry, index) => {
                          const colors = ['#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444', '#10B981', '#6366F1'];
                          return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Expenses Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
        {loading ? (
          <div className="p-16 flex flex-col items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--hover-600)]" />
            <p className="mt-3 text-sm text-gray-500">Loading expenses...</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Date</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Description</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Category</th>
                    <th className="px-6 py-4 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">Amount</th>
                    <th className="px-6 py-4 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <div className="p-4 bg-gray-50 rounded-full mb-3">
                            <TrendingDown className="w-8 h-8 text-gray-400" />
                          </div>
                          <p className="text-gray-500 font-medium">No expenses found</p>
                          <p className="text-sm text-gray-400 mt-1">Add your first expense to get started</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedExpenses.map(expense => (
                      <tr key={expense.id} className="hover:bg-gray-50/80 transition-colors duration-150">
                        <td className="px-6 py-4">
                          <p className="text-sm text-gray-600 font-medium">{formatDisplayDate(expense.date)}</p>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-semibold text-gray-900 max-w-md truncate">{expense.description}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold border ${getCategoryColor(expense.category)}`}>
                            {expense.category || 'Uncategorized'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <p className="text-sm font-bold text-gray-900">{formatCurrency(expense.amount, currency)}</p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openDetailModal(expense)}
                              className="p-2 text-gray-600 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-all duration-150"
                              title="View details"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            {expense.is_system_generated ? (
                              <span
                                className="rounded-lg border border-cyan-100 bg-cyan-50 px-2.5 py-1.5 text-xs font-bold text-cyan-700"
                                title="Managed from the Audit Log material-cost modal"
                              >
                                Audit linked
                              </span>
                            ) : (
                              <>
                                <button
                                  onClick={() => onEdit(expense)}
                                  className="p-2 text-gray-600 hover:bg-emerald-50 hover:text-emerald-600 rounded-lg transition-all duration-150"
                                  title="Edit expense"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => {
                                    if (confirm('Are you sure you want to delete this expense?')) {
                                      onDelete(expense.id);
                                    }
                                  }}
                                  className="p-2 text-gray-600 hover:bg-red-50 hover:text-red-600 rounded-lg transition-all duration-150"
                                  title="Delete expense"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {!showAll && filteredExpenses.length > itemsPerPage && (
              <Pagination
                totalItems={filteredExpenses.length}
                itemsPerPage={itemsPerPage}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                showAll={showAll}
                onToggleShowAll={() => setShowAll(!showAll)}
              />
            )}
          </>
        )}
      </div>

      {/* Detail Modal */}
      {showDetailModal && selectedExpense && (
        <Modal title="Expense Details" onClose={closeDetailModal}>
          <div className="space-y-5">
            {/* Description */}
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-2xl p-5">
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-2">Description</p>
              <p className="text-base font-bold text-gray-900">{selectedExpense.description}</p>
            </div>

            {/* Main Details Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-gray-500" />
                  <p className="text-xs font-semibold text-gray-600 uppercase">Date</p>
                </div>
                <p className="text-sm font-bold text-gray-900 mt-1">{formatDisplayDate(selectedExpense.date)}</p>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Tag className="w-4 h-4 text-gray-500" />
                  <p className="text-xs font-semibold text-gray-600 uppercase">Category</p>
                </div>
                <p className="text-sm font-bold text-gray-900 mt-1">{selectedExpense.category || 'Uncategorized'}</p>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-gray-500" />
                  <p className="text-xs font-semibold text-gray-600 uppercase">Amount</p>
                </div>
                <p className="text-base font-bold text-gray-900 mt-1">{formatCurrency(selectedExpense.amount || 0, currency)}</p>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Location</p>
                <p className="text-sm font-bold text-gray-900 break-words">{getLocationName(selectedExpense.location_id)}</p>
              </div>
            </div>

            {/* Metadata */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Expense ID</p>
                <p className="text-xs font-mono text-gray-700 break-all">{selectedExpense.id}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Created</p>
                  <p className="text-xs text-gray-700">{selectedExpense.created_at ? new Date(selectedExpense.created_at).toLocaleString() : 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Updated</p>
                  <p className="text-xs text-gray-700">{selectedExpense.updated_at ? new Date(selectedExpense.updated_at).toLocaleString() : 'N/A'}</p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={closeDetailModal}
                className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition-all duration-150"
              >
                Close
              </button>
              <button
                onClick={() => {
                  closeDetailModal();
                  onEdit(selectedExpense);
                }}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-all duration-150"
              >
                Edit Expense
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default ExpensesView;
