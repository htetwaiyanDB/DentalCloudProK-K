import React, { useEffect, useState } from 'react';
import { Doctor } from '../types';
import { DOCTOR_SPECIALIZATIONS } from '../utils/doctorCommission';

interface DoctorProfileViewProps {
  doctor: Doctor | null;
  loading: boolean;
  onSave: (data: Partial<Doctor>) => Promise<void>;
  hoverTheme: 'blue' | 'green' | 'yellow' | 'brown' | 'dark';
}

const DoctorProfileView: React.FC<DoctorProfileViewProps> = ({
  doctor,
  loading,
  onSave,
  hoverTheme
}) => {
  const [formData, setFormData] = useState<Partial<Doctor>>({
    name: '',
    email: '',
    phone: '',
    specialization: '',
    password: ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setFormData({
      name: doctor?.name || '',
      email: doctor?.email || '',
      phone: doctor?.phone || '',
      specialization: doctor?.specialization || 'General',
      password: ''
    });
  }, [doctor]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doctor || saving) return;

    setSaving(true);
    setError('');
    try {
      await onSave({
        name: formData.name?.trim(),
        email: formData.email?.trim(),
        phone: formData.phone?.trim(),
        specialization: formData.specialization?.trim() || 'General',
        password: formData.password?.trim() || undefined
      });
      setFormData((prev) => ({ ...prev, password: '' }));
    } catch (err: any) {
      setError(err.message || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-500">
        Loading profile...
      </div>
    );
  }

  if (!doctor) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-8 text-center text-red-700">
        Doctor profile could not be loaded for this account.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden animate-fade-in">
      <div className="p-6 border-b border-gray-100 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Doctor Profile</h2>
          <p className="text-sm text-gray-500">Update your account details and login password.</p>
        </div>
        <span className="theme-accent-soft-bg theme-accent-text rounded-lg px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap">
          Theme: {hoverTheme}
        </span>
      </div>
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5">Name</label>
          <input
            required
            className="w-full border-gray-200 border rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            value={formData.name || ''}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5">Email (Login Username)</label>
            <input
              type="email"
              required
              className="w-full border-gray-200 border rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              value={formData.email || ''}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5">Phone</label>
            <input
              className="w-full border-gray-200 border rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              value={formData.phone || ''}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label htmlFor="profile-specialization" className="block text-[10px] font-black text-gray-500 uppercase mb-1.5">Specialization</label>
          <input
            id="profile-specialization"
            type="text"
            maxLength={255}
            list="doctor-profile-specialization-options"
            className="w-full border-gray-200 border rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
            value={formData.specialization || 'General'}
            onChange={(e) => setFormData({ ...formData, specialization: e.target.value })}
            placeholder="e.g., Pediatric Dentistry"
          />
          <datalist id="doctor-profile-specialization-options">
            {DOCTOR_SPECIALIZATIONS.map((specialization) => (
              <option key={specialization} value={specialization}>{specialization}</option>
            ))}
          </datalist>
        </div>
        <div>
          <label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5">New Password (Optional)</label>
          <input
            type="password"
            className="w-full border-gray-200 border rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            value={formData.password || ''}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            placeholder="Leave blank to keep current password"
          />
        </div>
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={saving}
          className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-indigo-600/20 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </form>
    </div>
  );
};

export default DoctorProfileView;
