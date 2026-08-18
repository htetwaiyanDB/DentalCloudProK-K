export interface AppointmentQueryScopeInput {
  role?: string | null;
  doctorId?: string | null;
  requestedDoctorIds?: string[];
}

/**
 * A doctor may only request their own appointments. UI-provided filters must
 * never broaden that scope.
 */
export const resolveAppointmentQueryDoctorIds = ({
  role,
  doctorId,
  requestedDoctorIds
}: AppointmentQueryScopeInput): string[] | undefined => {
  if (role !== 'doctor') return requestedDoctorIds;

  const normalizedDoctorId = doctorId?.trim();
  return normalizedDoctorId ? [normalizedDoctorId] : [];
};

export const filterAppointmentsForDoctor = <T extends { doctor_id?: string | null }>(
  appointments: T[],
  role?: string | null,
  doctorId?: string | null
): T[] => {
  if (role !== 'doctor') return appointments;

  const normalizedDoctorId = doctorId?.trim();
  if (!normalizedDoctorId) return [];

  return appointments.filter((appointment) => appointment.doctor_id === normalizedDoctorId);
};