import { describe, expect, it } from 'vitest';
import { excludeProtectedDoctorChange } from './appointmentDoctorUpdate';

describe('excludeProtectedDoctorChange', () => {
  it('omits an unchanged doctor from a standard appointment update', () => {
    expect(excludeProtectedDoctorChange({ doctor_id: 'doctor-1', date: '2026-08-28' }, 'doctor-1'))
      .toEqual({ date: '2026-08-28' });
  });

  it('treats blank and null doctor assignments as unchanged', () => {
    expect(excludeProtectedDoctorChange({ doctor_id: '', time: '13:00' }, null))
      .toEqual({ time: '13:00' });
  });

  it('rejects doctor reassignment through the standard edit workflow', () => {
    expect(() => excludeProtectedDoctorChange({ doctor_id: 'doctor-2' }, 'doctor-1'))
      .toThrow('Correct Doctor');
  });
});
