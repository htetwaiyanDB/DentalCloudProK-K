import { describe, expect, it } from 'vitest';
import { filterAppointmentsForDoctor, resolveAppointmentQueryDoctorIds } from './appointmentQueryScope';

describe('doctor appointment query scope', () => {
  it('overrides a doctor-page filter with the authenticated doctor ID', () => {
    expect(resolveAppointmentQueryDoctorIds({
      role: 'doctor',
      doctorId: 'doctor-1',
      requestedDoctorIds: ['doctor-2']
    })).toEqual(['doctor-1']);
  });

  it('fails closed for a doctor session without a linked doctor ID', () => {
    expect(resolveAppointmentQueryDoctorIds({ role: 'doctor', doctorId: null })).toEqual([]);
    expect(filterAppointmentsForDoctor([
      { id: 'appointment-1', doctor_id: 'doctor-1' }
    ], 'doctor', null)).toEqual([]);
  });

  it('does not alter non-doctor filters or appointment results', () => {
    const appointments = [
      { id: 'appointment-1', doctor_id: 'doctor-1' },
      { id: 'appointment-2', doctor_id: 'doctor-2' }
    ];

    expect(resolveAppointmentQueryDoctorIds({
      role: 'admin',
      requestedDoctorIds: ['doctor-2']
    })).toEqual(['doctor-2']);
    expect(filterAppointmentsForDoctor(appointments, 'admin', null)).toEqual(appointments);
  });

  it('removes any unexpected appointment outside the authenticated doctor scope', () => {
    expect(filterAppointmentsForDoctor([
      { id: 'appointment-1', doctor_id: 'doctor-1' },
      { id: 'appointment-2', doctor_id: 'doctor-2' },
      { id: 'appointment-3', doctor_id: null }
    ], 'doctor', 'doctor-1')).toEqual([
      { id: 'appointment-1', doctor_id: 'doctor-1' }
    ]);
  });
});