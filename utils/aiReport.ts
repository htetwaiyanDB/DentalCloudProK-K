import { ClinicalRecord, Expense, Medicine, MedicineSale, PaymentRecord } from '../types';
import { Currency, formatCurrency } from './currency';
import { multiplyMoney, sumMoney } from './money';
import { dedupePaymentRecords } from './paymentTreatmentAllocation';
import { getTotalPaymentServiceFees } from './serviceFee';

export interface FinancialReport {
  today: string;
  weeklyStart: string;
  monthlyLabel: string;
  revenueDaily: number;
  revenueWeekly: number;
  revenueMonthly: number;
  expenseDaily: number;
  expenseWeekly: number;
  expenseMonthly: number;
  profitMonthly: number;
  inventoryValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  topDoctors30d: Array<{ name: string; treatments: number }>;
}

export interface AIReportPayload {
  period: {
    today: string;
    weekStart: string;
    monthLabel: string;
  };
  revenue: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  expenses: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  profit: {
    monthly: number;
  };
  inventory: {
    totalValue: number;
    lowStockCount: number;
    outOfStockCount: number;
  };
  doctors: Array<{ name: string; treatments: number }>;
  insights: string[];
}

export interface UpgradeCheckResult {
  ok: boolean;
  issues: string[];
  warnings: string[];
}

const getToday = (): string => new Date().toISOString().split('T')[0];

const formatDateKey = (year: number, monthIndex: number, day: number): string =>
  new Date(Date.UTC(year, monthIndex, day)).toISOString().split('T')[0];

const parseDateKey = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
};

const getWeeklyStart = (today: string): string => {
  const d = parseDateKey(today);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().split('T')[0];
};

const isWithinDateRange = (dateStr: string, startDate: string, endDate: string): boolean =>
  dateStr >= startDate && dateStr <= endDate;

const isSameMonth = (dateStr: string, today: Date): boolean => {
  const d = parseDateKey(dateStr);
  return d.getUTCMonth() === today.getUTCMonth() && d.getUTCFullYear() === today.getUTCFullYear();
};

const formatMonthLabel = (date: Date): string => {
  const month = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return `${month} ${date.getUTCFullYear()}`;
};

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
];

const getMonthEndDateKey = (year: number, monthIndex: number): string =>
  formatDateKey(year, monthIndex + 1, 0);

export const resolveFinancialReportAnchorDate = (message: string, currentDate: string = getToday()): string | undefined => {
  const lower = message.toLowerCase();
  const current = parseDateKey(currentDate);
  const currentYear = current.getUTCFullYear();
  const currentMonthIndex = current.getUTCMonth();

  if (/\blast\s+month\b/.test(lower)) {
    const lastMonth = new Date(Date.UTC(currentYear, currentMonthIndex - 1, 1));
    return getMonthEndDateKey(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth());
  }

  const explicitDate = lower.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (explicitDate) {
    const year = Number(explicitDate[1]);
    const month = Number(explicitDate[2]);
    const day = Number(explicitDate[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return formatDateKey(year, month - 1, day);
    }
  }

  for (let monthIndex = 0; monthIndex < MONTH_NAMES.length; monthIndex += 1) {
    const monthName = MONTH_NAMES[monthIndex];
    const shortName = monthName.slice(0, 3);
    const monthPattern = new RegExp(`\\b(${monthName}|${shortName})\\b`, 'i');
    if (!monthPattern.test(message)) continue;

    const yearNearMonth = message.match(new RegExp(`\\b(?:${monthName}|${shortName})\\s+(20\\d{2})\\b`, 'i'))
      || message.match(new RegExp(`\\b(20\\d{2})\\s+(?:${monthName}|${shortName})\\b`, 'i'));
    const year = yearNearMonth ? Number(yearNearMonth[1]) : currentYear;
    return getMonthEndDateKey(year, monthIndex);
  }

  return undefined;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const normalizeNumber = (value: number): number => {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : 0;
};

const equalsNumber = (a: number, b: number, currency: Currency): boolean => {
  const tolerance = currency === 'MMK' ? 0 : 0.0001;
  return Math.abs(a - b) <= tolerance;
};

const extractNumbers = (text: string): number[] => {
  const matches = text.match(/[-+]?\d[\d,]*(?:\.\d+)?/g) || [];
  return matches
    .map(token => Number(token.replace(/,/g, '')))
    .filter(value => Number.isFinite(value));
};

const buildAllowedNumbers = (report: FinancialReport): number[] => {
  const base = [
    report.revenueDaily,
    report.revenueWeekly,
    report.revenueMonthly,
    report.expenseDaily,
    report.expenseWeekly,
    report.expenseMonthly,
    report.profitMonthly,
    report.inventoryValue,
    report.lowStockCount,
    report.outOfStockCount,
    7,
    30
  ];

  report.topDoctors30d.forEach(item => base.push(item.treatments));
  return base.map(normalizeNumber);
};

export const buildFinancialReport = (
  treatmentRecords: ClinicalRecord[],
  expenses: Expense[],
  medicines: Medicine[],
  currency: Currency,
  todayOverride?: string,
  medicineSales: MedicineSale[] = [],
  paymentRecords: PaymentRecord[] = []
): FinancialReport => {
  const today = todayOverride || getToday();
  const weeklyStart = getWeeklyStart(today);
  const now = parseDateKey(today);

  const treatmentDaily = sumMoney(
    treatmentRecords.filter(tr => tr.date === today).map(tr => tr.cost),
    currency
  );
  const treatmentWeekly = sumMoney(
    treatmentRecords.filter(tr => isWithinDateRange(tr.date, weeklyStart, today)).map(tr => tr.cost),
    currency
  );
  const treatmentMonthly = sumMoney(
    treatmentRecords.filter(tr => isSameMonth(tr.date, now)).map(tr => tr.cost),
    currency
  );

  const medicineDaily = sumMoney(
    medicineSales.filter(sale => sale.date === today).map(sale => sale.total_price),
    currency
  );
  const medicineWeekly = sumMoney(
    medicineSales.filter(sale => isWithinDateRange(sale.date, weeklyStart, today)).map(sale => sale.total_price),
    currency
  );
  const medicineMonthly = sumMoney(
    medicineSales.filter(sale => isSameMonth(sale.date, now)).map(sale => sale.total_price),
    currency
  );

  const activePayments = dedupePaymentRecords(paymentRecords).filter(payment => !payment.voidedAt);
  const serviceFeeDaily = sumMoney([getTotalPaymentServiceFees(
    activePayments.filter(payment => payment.date === today)
  )], currency);
  const serviceFeeWeekly = sumMoney([getTotalPaymentServiceFees(
    activePayments.filter(payment => isWithinDateRange(payment.date, weeklyStart, today))
  )], currency);
  const serviceFeeMonthly = sumMoney([getTotalPaymentServiceFees(
    activePayments.filter(payment => isSameMonth(payment.date, now))
  )], currency);

  // Treatment and medicine values are already revenue. Adding the full payment
  // amount would count the same sale twice. Payments contribute only their
  // separately recorded service-fee portion here.
  const revenueDaily = sumMoney([treatmentDaily, medicineDaily, serviceFeeDaily], currency);
  const revenueWeekly = sumMoney([treatmentWeekly, medicineWeekly, serviceFeeWeekly], currency);
  const revenueMonthly = sumMoney([treatmentMonthly, medicineMonthly, serviceFeeMonthly], currency);

  const expenseDaily = sumMoney(
    expenses.filter(exp => exp.date === today).map(exp => exp.amount),
    currency
  );
  const expenseWeekly = sumMoney(
    expenses.filter(exp => isWithinDateRange(exp.date, weeklyStart, today)).map(exp => exp.amount),
    currency
  );
  const expenseMonthly = sumMoney(
    expenses.filter(exp => isSameMonth(exp.date, now)).map(exp => exp.amount),
    currency
  );

  const profitMonthly = sumMoney([revenueMonthly, -expenseMonthly], currency);

  const inventoryValue = sumMoney(
    medicines.map(med => multiplyMoney(med.price || 0, med.stock || 0, currency)),
    currency
  );

  const lowStockCount = medicines.filter(m => (m.stock || 0) <= (m.min_stock || 0)).length;
  const outOfStockCount = medicines.filter(m => (m.stock || 0) === 0).length;

  const thirtyDaysAgo = parseDateKey(today);
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 29);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
  const doctorPopularityMap = new Map<string, number>();

  treatmentRecords
    .filter(tr => isWithinDateRange(tr.date, thirtyDaysAgoStr, today))
    .forEach(tr => {
      const doctorName = tr.doctor_name?.trim() || 'Unassigned Doctor';
      doctorPopularityMap.set(doctorName, (doctorPopularityMap.get(doctorName) || 0) + 1);
    });

  const topDoctors30d = Array.from(doctorPopularityMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, treatments]) => ({ name, treatments }));

  return {
    today,
    weeklyStart,
    monthlyLabel: formatMonthLabel(now),
    revenueDaily,
    revenueWeekly,
    revenueMonthly,
    expenseDaily,
    expenseWeekly,
    expenseMonthly,
    profitMonthly,
    inventoryValue,
    lowStockCount,
    outOfStockCount,
    topDoctors30d
  };
};

export const buildAIReportPayload = (report: FinancialReport): AIReportPayload => ({
  period: {
    today: report.today,
    weekStart: report.weeklyStart,
    monthLabel: report.monthlyLabel
  },
  revenue: {
    daily: report.revenueDaily,
    weekly: report.revenueWeekly,
    monthly: report.revenueMonthly
  },
  expenses: {
    daily: report.expenseDaily,
    weekly: report.expenseWeekly,
    monthly: report.expenseMonthly
  },
  profit: {
    monthly: report.profitMonthly
  },
  inventory: {
    totalValue: report.inventoryValue,
    lowStockCount: report.lowStockCount,
    outOfStockCount: report.outOfStockCount
  },
  doctors: report.topDoctors30d.map(item => ({ name: item.name, treatments: item.treatments })),
  insights: []
});

export const payloadToReport = (payload: AIReportPayload): FinancialReport => ({
  today: payload.period.today,
  weeklyStart: payload.period.weekStart,
  monthlyLabel: payload.period.monthLabel,
  revenueDaily: payload.revenue.daily,
  revenueWeekly: payload.revenue.weekly,
  revenueMonthly: payload.revenue.monthly,
  expenseDaily: payload.expenses.daily,
  expenseWeekly: payload.expenses.weekly,
  expenseMonthly: payload.expenses.monthly,
  profitMonthly: payload.profit.monthly,
  inventoryValue: payload.inventory.totalValue,
  lowStockCount: payload.inventory.lowStockCount,
  outOfStockCount: payload.inventory.outOfStockCount,
  topDoctors30d: payload.doctors.map(item => ({ name: item.name, treatments: item.treatments }))
});

export const validateAIReportPayload = (
  payload: unknown,
  report: FinancialReport,
  currency: Currency
): UpgradeCheckResult => {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!isObject(payload)) {
    return { ok: false, issues: ['Payload is not an object.'], warnings };
  }

  const period = payload.period;
  const revenue = payload.revenue;
  const expenses = payload.expenses;
  const profit = payload.profit;
  const inventory = payload.inventory;
  const doctors = payload.doctors;
  const insights = payload.insights;

  if (!isObject(period)) {
    issues.push('Missing period section.');
  } else {
    if (period.today !== report.today) issues.push('period.today does not match.');
    if (period.weekStart !== report.weeklyStart) issues.push('period.weekStart does not match.');
    if (period.monthLabel !== report.monthlyLabel) issues.push('period.monthLabel does not match.');
  }

  if (!isObject(revenue)) {
    issues.push('Missing revenue section.');
  } else {
    if (!isFiniteNumber(revenue.daily) || !equalsNumber(revenue.daily, report.revenueDaily, currency)) {
      issues.push('revenue.daily does not match.');
    }
    if (!isFiniteNumber(revenue.weekly) || !equalsNumber(revenue.weekly, report.revenueWeekly, currency)) {
      issues.push('revenue.weekly does not match.');
    }
    if (!isFiniteNumber(revenue.monthly) || !equalsNumber(revenue.monthly, report.revenueMonthly, currency)) {
      issues.push('revenue.monthly does not match.');
    }
  }

  if (!isObject(expenses)) {
    issues.push('Missing expenses section.');
  } else {
    if (!isFiniteNumber(expenses.daily) || !equalsNumber(expenses.daily, report.expenseDaily, currency)) {
      issues.push('expenses.daily does not match.');
    }
    if (!isFiniteNumber(expenses.weekly) || !equalsNumber(expenses.weekly, report.expenseWeekly, currency)) {
      issues.push('expenses.weekly does not match.');
    }
    if (!isFiniteNumber(expenses.monthly) || !equalsNumber(expenses.monthly, report.expenseMonthly, currency)) {
      issues.push('expenses.monthly does not match.');
    }
  }

  if (!isObject(profit)) {
    issues.push('Missing profit section.');
  } else if (!isFiniteNumber(profit.monthly) || !equalsNumber(profit.monthly, report.profitMonthly, currency)) {
    issues.push('profit.monthly does not match.');
  }

  if (!isObject(inventory)) {
    issues.push('Missing inventory section.');
  } else {
    if (!isFiniteNumber(inventory.totalValue) || !equalsNumber(inventory.totalValue, report.inventoryValue, currency)) {
      issues.push('inventory.totalValue does not match.');
    }
    if (!isFiniteNumber(inventory.lowStockCount) || inventory.lowStockCount !== report.lowStockCount) {
      issues.push('inventory.lowStockCount does not match.');
    }
    if (!isFiniteNumber(inventory.outOfStockCount) || inventory.outOfStockCount !== report.outOfStockCount) {
      issues.push('inventory.outOfStockCount does not match.');
    }
  }

  if (!Array.isArray(doctors)) {
    issues.push('Missing doctors list.');
  } else if (doctors.length !== report.topDoctors30d.length) {
    issues.push('doctors length does not match.');
  } else {
    doctors.forEach((item, index) => {
      if (!isObject(item)) {
        issues.push(`doctors[${index}] is invalid.`);
        return;
      }
      const expected = report.topDoctors30d[index];
      if (item.name !== expected.name) {
        issues.push(`doctors[${index}].name does not match.`);
      }
      if (!isFiniteNumber(item.treatments) || item.treatments !== expected.treatments) {
        issues.push(`doctors[${index}].treatments does not match.`);
      }
    });
  }

  if (!Array.isArray(insights)) {
    issues.push('Missing insights list.');
  } else {
    const allowed = buildAllowedNumbers(report);
    insights.forEach((insight, index) => {
      if (typeof insight !== 'string') {
        issues.push(`insights[${index}] is not a string.`);
        return;
      }
      const numbers = extractNumbers(insight);
      numbers.forEach(value => {
        const normalized = normalizeNumber(value);
        const ok = allowed.some(allowedValue => equalsNumber(allowedValue, normalized, currency));
        if (!ok) {
          issues.push(`insights[${index}] contains unverified number.`);
        }
      });
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings
  };
};

export const renderFinancialReportMarkdown = (report: FinancialReport, currency: Currency): string => {
  const revenueTable = `| Metric | Amount |\n| --- | --- |\n| Daily Revenue | ${formatCurrency(report.revenueDaily, currency)} |\n| Weekly Revenue | ${formatCurrency(report.revenueWeekly, currency)} |\n| Monthly Revenue | ${formatCurrency(report.revenueMonthly, currency)} |`;

  const expenseTable = `| Metric | Amount |\n| --- | --- |\n| Daily Expenses | ${formatCurrency(report.expenseDaily, currency)} |\n| Weekly Expenses | ${formatCurrency(report.expenseWeekly, currency)} |\n| Monthly Expenses | ${formatCurrency(report.expenseMonthly, currency)} |`;

  const profitTable = `| Metric | Amount |\n| --- | --- |\n| Monthly Profit | ${formatCurrency(report.profitMonthly, currency)} |`;

  const inventoryTable = `| Metric | Value |\n| --- | --- |\n| Total Inventory Value | ${formatCurrency(report.inventoryValue, currency)} |\n| Low Stock Items | ${report.lowStockCount} |\n| Out Of Stock Items | ${report.outOfStockCount} |`;

  const doctorTableRows = report.topDoctors30d.length
    ? report.topDoctors30d.map(item => `| ${item.name} | ${item.treatments} |`).join('\n')
    : '| No data | 0 |';
  const doctorTable = `| Doctor | Treatments (Last 30 Days) |\n| --- | --- |\n${doctorTableRows}`;

  return [
    `**Financial Summary (${report.today})**`,
    revenueTable,
    '',
    `**Expense Summary (${report.weeklyStart} to ${report.today})**`,
    expenseTable,
    '',
    `**Profit Summary (${report.monthlyLabel})**`,
    profitTable,
    '',
    '**Inventory Summary**',
    inventoryTable,
    '',
    '**Doctor Activity (Last 30 Days)**',
    doctorTable
  ].join('\n');
};

export const buildInsightsNoNumbers = (report: FinancialReport): string[] => {
  const insights: string[] = [];

  if (report.profitMonthly > 0) {
    insights.push('Monthly revenue is higher than expenses.');
  } else if (report.profitMonthly < 0) {
    insights.push('Monthly expenses are higher than revenue.');
  } else {
    insights.push('Monthly revenue and expenses are balanced.');
  }

  if (report.lowStockCount > 0) {
    insights.push('Some medicines are below minimum stock levels.');
  }

  if (report.outOfStockCount > 0) {
    insights.push('There are medicines that are currently out of stock.');
  }

  if (report.topDoctors30d[0]) {
    insights.push(`Top performing doctor recently: ${report.topDoctors30d[0].name}.`);
  }

  return insights;
};

export const runReportUpgradeCheck = (report: FinancialReport): UpgradeCheckResult => {
  const issues: string[] = [];
  const warnings: string[] = [];

  const fieldsToCheck: Array<[string, number]> = [
    ['revenueDaily', report.revenueDaily],
    ['revenueWeekly', report.revenueWeekly],
    ['revenueMonthly', report.revenueMonthly],
    ['expenseDaily', report.expenseDaily],
    ['expenseWeekly', report.expenseWeekly],
    ['expenseMonthly', report.expenseMonthly],
    ['profitMonthly', report.profitMonthly],
    ['inventoryValue', report.inventoryValue]
  ];

  fieldsToCheck.forEach(([label, value]) => {
    if (!Number.isFinite(value)) {
      issues.push(`${label} is not a valid number.`);
    }
  });

  if (report.revenueDaily < 0 || report.revenueWeekly < 0 || report.revenueMonthly < 0) {
    warnings.push('Revenue contains negative values.');
  }

  if (report.expenseDaily < 0 || report.expenseWeekly < 0 || report.expenseMonthly < 0) {
    warnings.push('Expenses contain negative values.');
  }

  if (report.lowStockCount < 0 || report.outOfStockCount < 0) {
    warnings.push('Inventory counts contain negative values.');
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings
  };
};
