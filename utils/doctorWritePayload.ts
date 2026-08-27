// Commission fields are intentionally excluded here. The database only allows
// those fields to be changed by the authenticated configure_doctor_commission RPC.
export const buildDoctorDirectWritePayload = (data: {
  location_id?: string | null;
  name?: string;
  email?: string | null;
  phone?: string;
  specialization?: string;
  password?: string | null;
}) => ({
  location_id: data.location_id,
  name: data.name,
  email: data.email,
  phone: data.phone,
  specialization: data.specialization,
  ...(data.password !== undefined ? { password: data.password } : {})
});
