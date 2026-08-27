import React, { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { createPortal } from 'react-dom';

type ModalProps = {
  title: string;
  children?: React.ReactNode;
  onClose: () => void;
  maxWidthClassName?: string;
  closeDisabled?: boolean;
};

export const Modal = ({ title, children, onClose, maxWidthClassName = 'max-w-lg', closeDisabled = false }: ModalProps) => {
  const titleId = React.useId();
  // Use portal to render modal at document body level for full viewport coverage
  if (typeof document === 'undefined') return null;
  
  return createPortal(
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md z-[9999] flex items-center justify-center p-3 sm:p-6 animate-fade-in">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className={`bg-white rounded-3xl sm:rounded-[2.5rem] shadow-2xl ${maxWidthClassName} w-full max-h-[94vh] sm:max-h-[90vh] flex flex-col relative animate-scale-up`}>
        <div className="flex-shrink-0 p-5 pb-4 border-b border-gray-100 relative sm:p-10 sm:pb-6">
          <button type="button" onClick={onClose} disabled={closeDisabled} aria-label="Close dialog" className="absolute right-5 top-5 text-gray-300 transition-colors hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 sm:right-8 sm:top-8">
            <X size={24} />
          </button>
          <h3 id={titleId} className="pr-12 text-xl font-black tracking-tight text-gray-900 sm:text-2xl">{title}</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-5 pt-4 sm:p-10 sm:pt-6">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};

// Confirmation Dialog Component
interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'danger',
  onConfirm,
  onCancel,
  isLoading = false
}) => {
  if (!isOpen) return null;

  const typeConfig = {
    danger: {
      icon: <AlertTriangle className="w-6 h-6 text-red-600" />,
      iconBg: 'bg-red-100',
      confirmBg: 'bg-red-600 hover:bg-red-700',
      confirmShadow: 'shadow-red-600/20'
    },
    warning: {
      icon: <AlertTriangle className="w-6 h-6 text-amber-600" />,
      iconBg: 'bg-amber-100',
      confirmBg: 'bg-amber-600 hover:bg-amber-700',
      confirmShadow: 'shadow-amber-600/20'
    },
    info: {
      icon: <Info className="w-6 h-6 text-blue-600" />,
      iconBg: 'bg-blue-100',
      confirmBg: 'bg-blue-600 hover:bg-blue-700',
      confirmShadow: 'shadow-blue-600/20'
    }
  };

  const config = typeConfig[type];

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full relative animate-scale-up">
        <button 
          onClick={onCancel} 
          className="absolute top-6 right-6 text-gray-300 hover:text-gray-600 transition-colors"
          disabled={isLoading}
        >
          <X size={20} />
        </button>
        
        <div className="p-8">
          <div className="flex items-start gap-4 mb-6">
            <div className={`flex-shrink-0 w-12 h-12 rounded-2xl ${config.iconBg} flex items-center justify-center`}>
              {config.icon}
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-black text-gray-900 mb-2">{title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{message}</p>
            </div>
          </div>
          
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              disabled={isLoading}
              className="flex-1 px-6 py-3 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              disabled={isLoading}
              className={`flex-1 px-6 py-3 rounded-xl font-bold text-white ${config.confirmBg} ${config.confirmShadow} shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Processing...
                </>
              ) : (
                confirmText
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export const Input = ({ label, ...props }: InputProps) => (
  <div>
    {label && (
      <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">{label}</label>
    )}
    <input 
      {...props} 
      className="w-full border-gray-200 border rounded-xl p-3 text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder:text-gray-300" 
    />
  </div>
);

type Meridiem = 'AM' | 'PM';

const TIME_VALUE_PATTERN = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

const normalizeStoredTime = (value: string): string => {
  const match = value.trim().match(TIME_VALUE_PATTERN);
  if (!match) return value;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return value;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const toTwentyFourHourTime = (hours: number, minutes: number, meridiem: Meridiem) => {
  if (minutes > 59) return null;
  if (hours < 1 || hours > 12) return null;

  const normalizedHours = meridiem === 'PM'
    ? (hours === 12 ? 12 : hours + 12)
    : (hours === 12 ? 0 : hours);

  return `${String(normalizedHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const getMeridiemFromValue = (value: string): Meridiem => {
  const match = normalizeStoredTime(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 'AM';

  return Number(match[1]) >= 12 ? 'PM' : 'AM';
};

const getDisplayTimeValue = (value: string) => {
  const normalizedValue = normalizeStoredTime(value);
  const match = normalizedValue.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return value.replace(/\s*([ap])\.?m?\.?$/i, '').trim();

  const hours = Number(match[1]);
  const displayHours = hours % 12 || 12;
  return `${String(displayHours).padStart(2, '0')}:${match[2]}`;
};

export const formatTypedTime = (rawValue: string, meridiem: Meridiem, completeOnly = false) => {
  const raw = rawValue.trim();
  if (!raw) return '';

  const explicitMeridiemMatch = raw.match(/\b([ap])\.?m?\.?$/i);
  const effectiveMeridiem = explicitMeridiemMatch
    ? (explicitMeridiemMatch[1].toUpperCase() === 'P' ? 'PM' : 'AM')
    : meridiem;
  const sanitized = raw.replace(/[^\d:]/g, '');
  const colonMatch = sanitized.match(/^(\d{1,2}):(\d{1,2})$/);

  if (!completeOnly && sanitized.includes(':') && !colonMatch) {
    return sanitized;
  }

  if (!completeOnly && colonMatch && colonMatch[2].length < 2) {
    return sanitized;
  }

  if (colonMatch && (colonMatch[2].length === 2 || completeOnly)) {
    const hours = Number(colonMatch[1]);
    const minutes = Number(colonMatch[2].padEnd(2, '0'));
    if (hours > 12 && hours <= 23 && minutes <= 59) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    const formatted = toTwentyFourHourTime(hours, minutes, effectiveMeridiem);
    if (formatted) return formatted;
  }

  const digitsOnly = sanitized.replace(/\D/g, '');
  if (/^\d{3,4}$/.test(digitsOnly)) {
    const hours = digitsOnly.length === 3 ? digitsOnly.slice(0, 1) : digitsOnly.slice(0, 2);
    const minutes = digitsOnly.slice(-2);
    const numericHours = Number(hours);
    const numericMinutes = Number(minutes);
    if (numericHours > 12 && numericHours <= 23 && numericMinutes <= 59) {
      return `${String(numericHours).padStart(2, '0')}:${String(numericMinutes).padStart(2, '0')}`;
    }
    const formatted = toTwentyFourHourTime(numericHours, numericMinutes, effectiveMeridiem);
    if (formatted) return formatted;
  }

  if (completeOnly && /^\d{1,2}$/.test(digitsOnly)) {
    const numericHours = Number(digitsOnly);
    if (numericHours > 12 && numericHours <= 23) {
      return `${String(numericHours).padStart(2, '0')}:00`;
    }
    const formatted = toTwentyFourHourTime(numericHours, 0, effectiveMeridiem);
    if (formatted) return formatted;
  }

  return sanitized;
};

type TimeInputProps = Omit<InputProps, 'type' | 'value' | 'onChange'> & {
  value?: string;
  onChange: (value: string) => void;
};

export const TimeInput = ({ value = '', onChange, onBlur, placeholder = 'HH:MM', label, ...props }: TimeInputProps) => {
  const [meridiem, setMeridiem] = React.useState<Meridiem>(() => getMeridiemFromValue(value));

  React.useEffect(() => {
    if (TIME_VALUE_PATTERN.test(value)) {
      setMeridiem(getMeridiemFromValue(value));
    }
  }, [value]);

  const displayValue = getDisplayTimeValue(value);

  return (
    <div>
      {label && (
        <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">{label}</label>
      )}
      <div className="flex rounded-xl border border-gray-200 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent transition-all overflow-hidden">
        <input
          {...props}
          type="text"
          inputMode="numeric"
          placeholder={placeholder}
          pattern="^((0?[1-9]|1[0-2]):[0-5][0-9]|(0?[1-9]|1[0-2])[0-5][0-9]|(0?[1-9]|1[0-2])\\s*([aApP]\\.?[mM]?\\.?)?)$"
          maxLength={8}
          value={displayValue}
          onChange={(e) => {
            const explicitMeridiemMatch = e.target.value.match(/\b([ap])\.?m?\.?$/i);
            if (explicitMeridiemMatch) {
              setMeridiem(explicitMeridiemMatch[1].toUpperCase() === 'P' ? 'PM' : 'AM');
            }
            onChange(formatTypedTime(e.target.value, meridiem));
          }}
          onBlur={(e) => {
            onChange(formatTypedTime(e.target.value, meridiem, true));
            onBlur?.(e);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const formatted = formatTypedTime(e.currentTarget.value, meridiem, true);
              if (formatted) onChange(formatted);
            }
            props.onKeyDown?.(e);
          }}
          className="min-w-0 flex-1 border-0 p-3 text-sm font-medium outline-none placeholder:text-gray-300"
        />
        <select
          value={meridiem}
          onChange={(e) => {
            const nextMeridiem = e.target.value as Meridiem;
            setMeridiem(nextMeridiem);
            const formatted = formatTypedTime(displayValue, nextMeridiem, true);
            if (formatted) onChange(formatted);
          }}
          disabled={props.disabled}
          className="w-20 border-l border-gray-200 bg-gray-50 px-2 text-sm font-bold text-gray-700 outline-none"
          aria-label={`${label || 'Time'} period`}
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    </div>
  );
};

export const NavItem = ({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) => (
  <button 
    onClick={onClick}
    className={`theme-hover-icon w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl text-sm font-bold transition-all ${
      active ? 'theme-active-bg text-white shadow-lg theme-active-shadow' : 'text-gray-400 theme-hover-bg theme-hover-text'
    }`}
  >
    <span className="theme-hover-icon-target shrink-0 text-current">{icon}</span>
    {label}
  </button>
);

export const StatsCard = ({ title, value, icon, trend }: { title: string, value: string, icon: React.ReactNode, trend: string }) => {
  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 group hover:border-indigo-200 transition-colors">
      <div className="flex justify-between items-start mb-6">
        <div className="p-3 bg-gray-50 rounded-xl group-hover:bg-indigo-50 transition-colors">{icon}</div>
        <span className="text-[10px] font-black px-2 py-1 rounded-full bg-green-50 text-green-700 uppercase tracking-wider">
          {trend}
        </span>
      </div>
      <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">{title}</p>
      <h3 className="text-xl font-black text-gray-900 tracking-tight">{value}</h3>
    </div>
  );
};

// Toast Notification Component
interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  onClose: () => void;
  duration?: number;
}

export const Toast: React.FC<ToastProps> = ({ message, type = 'success', onClose, duration = 4500 }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  if (typeof document === 'undefined') return null;

  const icons = {
    success: <CheckCircle className="h-7 w-7 text-green-600" />,
    error: <AlertCircle className="h-7 w-7 text-red-600" />,
    info: <Info className="h-7 w-7 text-blue-600" />
  };

  const labels = {
    success: 'Success',
    error: 'Attention',
    info: 'Notice'
  };

  const bgColors = {
    success: 'border-green-200 bg-green-50/95',
    error: 'border-red-200 bg-red-50/95',
    info: 'border-blue-200 bg-blue-50/95'
  };

  const iconShellColors = {
    success: 'bg-green-100',
    error: 'bg-red-100',
    info: 'bg-blue-100'
  };

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[9999] flex justify-center px-4 pt-6">
      <div className={`pointer-events-auto w-full max-w-2xl rounded-[2rem] border-2 shadow-2xl backdrop-blur-md animate-scale-up ${bgColors[type]}`}>
        <div className="flex items-start gap-4 px-5 py-5 sm:px-7 sm:py-6">
          <div className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl ${iconShellColors[type]}`}>
            {icons[type]}
          </div>
          <div className="min-w-0 flex-1 pr-2">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-gray-500">{labels[type]}</p>
            <p className="mt-1 text-base font-semibold leading-7 text-gray-900 sm:text-lg">{message}</p>
          </div>
          <button
            onClick={onClose}
            className="mt-1 rounded-full p-2 text-gray-400 transition-colors hover:bg-white/70 hover:text-gray-700"
            aria-label="Close notification"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
