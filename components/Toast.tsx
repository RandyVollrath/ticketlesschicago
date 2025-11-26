import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

// Brand Colors - Municipal Fintech
const COLORS = {
  regulatory: '#2563EB',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
  warning: '#F59E0B',
  danger: '#EF4444',
};

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// Toast Icons
const Icons = {
  success: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  error: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  warning: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  info: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
};

const typeStyles: Record<ToastType, { bg: string; border: string; icon: string; iconBg: string }> = {
  success: {
    bg: '#f0fdf4',
    border: '#bbf7d0',
    icon: COLORS.signal,
    iconBg: '#dcfce7',
  },
  error: {
    bg: '#fef2f2',
    border: '#fecaca',
    icon: COLORS.danger,
    iconBg: '#fee2e2',
  },
  warning: {
    bg: '#fffbeb',
    border: '#fde68a',
    icon: COLORS.warning,
    iconBg: '#fef3c7',
  },
  info: {
    bg: '#eff6ff',
    border: '#bfdbfe',
    icon: COLORS.regulatory,
    iconBg: '#dbeafe',
  },
};

// Generate unique ID
const generateId = () => Math.random().toString(36).substring(2, 9);

// Toast Provider Component
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = generateId();
    const newToast = { ...toast, id };
    setToasts((prev) => [...prev, newToast]);

    // Auto-remove after duration (default 5 seconds)
    const duration = toast.duration ?? 5000;
    if (duration > 0) {
      setTimeout(() => removeToast(id), duration);
    }
  }, [removeToast]);

  const success = useCallback((message: string, title?: string) => {
    addToast({ type: 'success', message, title });
  }, [addToast]);

  const error = useCallback((message: string, title?: string) => {
    addToast({ type: 'error', message, title, duration: 8000 }); // Errors stay longer
  }, [addToast]);

  const warning = useCallback((message: string, title?: string) => {
    addToast({ type: 'warning', message, title, duration: 6000 });
  }, [addToast]);

  const info = useCallback((message: string, title?: string) => {
    addToast({ type: 'info', message, title });
  }, [addToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, warning, info }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  );
}

// Hook to use toast
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// Individual Toast Component
function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  const [isExiting, setIsExiting] = useState(false);
  const [progress, setProgress] = useState(100);
  const styles = typeStyles[toast.type];
  const duration = toast.duration ?? 5000;

  useEffect(() => {
    if (duration <= 0) return;

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [duration]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(onRemove, 200);
  };

  return (
    <div
      style={{
        backgroundColor: styles.bg,
        border: `1px solid ${styles.border}`,
        borderRadius: '12px',
        padding: '16px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.1)',
        minWidth: '320px',
        maxWidth: '420px',
        position: 'relative',
        overflow: 'hidden',
        transform: isExiting ? 'translateX(120%)' : 'translateX(0)',
        opacity: isExiting ? 0 : 1,
        transition: 'all 0.2s ease-out',
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '10px',
          backgroundColor: styles.iconBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: styles.icon,
          flexShrink: 0,
        }}
      >
        {Icons[toast.type]}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {toast.title && (
          <p
            style={{
              fontSize: '14px',
              fontWeight: '600',
              color: COLORS.graphite,
              margin: '0 0 4px 0',
            }}
          >
            {toast.title}
          </p>
        )}
        <p
          style={{
            fontSize: '14px',
            color: COLORS.slate,
            margin: 0,
            lineHeight: '1.5',
          }}
        >
          {toast.message}
        </p>
        {toast.action && (
          <button
            onClick={() => {
              toast.action?.onClick();
              handleClose();
            }}
            style={{
              marginTop: '8px',
              padding: '6px 12px',
              backgroundColor: 'transparent',
              color: styles.icon,
              border: `1px solid ${styles.border}`,
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '500',
              cursor: 'pointer',
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>

      {/* Close Button */}
      <button
        onClick={handleClose}
        style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          width: '24px',
          height: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          color: COLORS.slate,
          transition: 'background-color 0.15s',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.05)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Progress Bar */}
      {duration > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            height: '3px',
            width: `${progress}%`,
            backgroundColor: styles.icon,
            opacity: 0.5,
            transition: 'width 0.05s linear',
          }}
        />
      )}
    </div>
  );
}

// Toast Container Component
function ToastContainer({ toasts, removeToast }: { toasts: Toast[]; removeToast: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '88px', // Below the 72px nav + padding
        right: '24px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        maxHeight: 'calc(100vh - 120px)',
        overflowY: 'auto',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <div key={toast.id} style={{ pointerEvents: 'auto' }}>
          <ToastItem toast={toast} onRemove={() => removeToast(toast.id)} />
        </div>
      ))}

      {/* Animation Keyframes */}
      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(120%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

// Standalone toast function for use outside React components
// Usage: toast.success('Message') or toast.error('Message')
let toastFunctions: {
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
} | null = null;

export function setToastFunctions(fns: typeof toastFunctions) {
  toastFunctions = fns;
}

export const toast = {
  success: (message: string, title?: string) => toastFunctions?.success(message, title),
  error: (message: string, title?: string) => toastFunctions?.error(message, title),
  warning: (message: string, title?: string) => toastFunctions?.warning(message, title),
  info: (message: string, title?: string) => toastFunctions?.info(message, title),
};

// Connector component to expose toast functions globally
export function ToastConnector() {
  const { success, error, warning, info } = useToast();

  useEffect(() => {
    setToastFunctions({ success, error, warning, info });
    return () => setToastFunctions(null);
  }, [success, error, warning, info]);

  return null;
}

export default ToastProvider;
