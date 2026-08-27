import { describe, expect, it } from 'vitest';
import { buildDoctorDirectWritePayload } from './doctorWritePayload';

describe('buildDoctorDirectWritePayload', () => {
  it('keeps profile fields and excludes secured commission fields', () => {
    const payload = buildDoctorDirectWritePayload({
      location_id: 'location-1',
      name: 'Dr Test',
      email: 'doctor@example.com',
      phone: '09123456789',
      specialization: 'General',
      password: 'secret',
      commission_type: 'percentage',
      commission_percentage: 25,
      commission_per_visit: 0
    } as any);

    expect(payload).toEqual({
      location_id: 'location-1',
      name: 'Dr Test',
      email: 'doctor@example.com',
      phone: '09123456789',
      specialization: 'General',
      password: 'secret'
    });
  });

  it('does not write an omitted password', () => {
    expect(buildDoctorDirectWritePayload({ name: 'Dr Test' }))
      .not.toHaveProperty('password');
  });
});
