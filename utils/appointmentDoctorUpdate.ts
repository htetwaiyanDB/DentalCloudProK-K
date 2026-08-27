const normalizeDoctorId = (value: unknown): string | null => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

// Standard appointment edits must never write doctor_id. Doctor reassignment
// is an audited operation handled by the administrator Correct Doctor workflow.
export const excludeProtectedDoctorChange = <T extends Record<string, unknown>>(
  data: T,
  existingDoctorId: unknown
): Omit<T, 'doctor_id'> => {
  const hasDoctorId = Object.prototype.hasOwnProperty.call(data, 'doctor_id');
  if (hasDoctorId && normalizeDoctorId(data.doctor_id) !== normalizeDoctorId(existingDoctorId)) {
    throw new Error('To change the assigned doctor, use Correct Doctor from the appointment actions.');
  }

  const { doctor_id: _doctorId, ...safeData } = data;
  return safeData;
};
