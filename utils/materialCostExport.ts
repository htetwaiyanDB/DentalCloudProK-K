export interface MaterialCostExportRow {
  date: string;
  patientId: string;
  patientName: string;
  clinician: string;
  treatments: string;
  appliedToTreatment: number;
  collectedPayment: number;
  materialCost: number;
  labCost: number;
  specialDoctorCost: number;
  mlsTotal: number;
  doctorEarned: number;
  netProfit: number;
  patientBalance: number;
}

export const materialCostExportFilename = (extension: 'pdf' | 'xlsx'): string => (
  `mls-costs-${new Date().toISOString().split('T')[0]}.${extension}`
);
