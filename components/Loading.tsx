import React from 'react';

// Brand Colors - Municipal Fintech
const COLORS = {
  regulatory: '#2563EB',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
};

interface LoadingProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
  color?: 'regulatory' | 'signal' | 'white' | 'slate';
  fullPage?: boolean;
}

interface LoadingButtonProps {
  loading: boolean;
  loadingText?: string;
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  fullWidth?: boolean;
  style?: React.CSSProperties;
}

// Spinner SVG component
const Spinner = ({ size, color }: { size: number; color: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    style={{ animation: 'spin 1s linear infinite' }}
  >
    <circle
      cx="12"
      cy="12"
      r="10"
      stroke={color}
      strokeWidth="3"
      strokeOpacity="0.25"
    />
    <path
      d="M12 2a10 10 0 0 1 10 10"
      stroke={color}
      strokeWidth="3"
      strokeLinecap="round"
    />
    <style>{`
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `}</style>
  </svg>
);

// Main Loading component for page/section loading states
export function Loading({
  size = 'md',
  text = 'Loading...',
  color = 'regulatory',
  fullPage = false
}: LoadingProps) {
  const sizeMap = {
    sm: { spinner: 16, text: '13px', gap: '8px' },
    md: { spinner: 24, text: '15px', gap: '12px' },
    lg: { spinner: 40, text: '17px', gap: '16px' },
  };

  const colorMap = {
    regulatory: COLORS.regulatory,
    signal: COLORS.signal,
    white: '#ffffff',
    slate: COLORS.slate,
  };

  const content = (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: sizeMap[size].gap,
    }}>
      <Spinner size={sizeMap[size].spinner} color={colorMap[color]} />
      {text && (
        <span style={{
          fontSize: sizeMap[size].text,
          color: color === 'white' ? '#ffffff' : COLORS.slate,
          fontWeight: '500',
        }}>
          {text}
        </span>
      )}
    </div>
  );

  if (fullPage) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F8FAFC',
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        {content}
      </div>
    );
  }

  return (
    <div style={{
      padding: '40px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {content}
    </div>
  );
}

// LoadingButton component for form buttons with loading states
export function LoadingButton({
  loading,
  loadingText,
  children,
  onClick,
  type = 'button',
  disabled = false,
  variant = 'primary',
  fullWidth = false,
  style = {},
}: LoadingButtonProps) {
  const variantStyles: Record<string, { bg: string; bgHover: string; text: string }> = {
    primary: {
      bg: COLORS.regulatory,
      bgHover: '#1d4ed8',
      text: '#ffffff',
    },
    secondary: {
      bg: '#ffffff',
      bgHover: '#f8fafc',
      text: COLORS.graphite,
    },
    danger: {
      bg: '#dc2626',
      bgHover: '#b91c1c',
      text: '#ffffff',
    },
  };

  const currentVariant = variantStyles[variant];
  const isDisabled = loading || disabled;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        backgroundColor: isDisabled ? COLORS.slate : currentVariant.bg,
        color: currentVariant.text,
        border: variant === 'secondary' ? `1px solid ${COLORS.border}` : 'none',
        borderRadius: '10px',
        padding: '14px 28px',
        fontSize: '15px',
        fontWeight: '600',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.7 : 1,
        transition: 'all 0.2s',
        width: fullWidth ? '100%' : 'auto',
        fontFamily: 'inherit',
        ...style,
      }}
      onMouseOver={(e) => {
        if (!isDisabled) {
          e.currentTarget.style.backgroundColor = currentVariant.bgHover;
        }
      }}
      onMouseOut={(e) => {
        if (!isDisabled) {
          e.currentTarget.style.backgroundColor = currentVariant.bg;
        }
      }}
    >
      {loading && <Spinner size={18} color={currentVariant.text} />}
      {loading ? (loadingText || children) : children}
    </button>
  );
}

// Inline loading spinner (for use within text or small areas)
export function InlineSpinner({
  size = 16,
  color = 'regulatory'
}: {
  size?: number;
  color?: 'regulatory' | 'signal' | 'white' | 'slate';
}) {
  const colorMap = {
    regulatory: COLORS.regulatory,
    signal: COLORS.signal,
    white: '#ffffff',
    slate: COLORS.slate,
  };

  return <Spinner size={size} color={colorMap[color]} />;
}

// Skeleton loader for content placeholders
export function Skeleton({
  width = '100%',
  height = '20px',
  borderRadius = '6px',
}: {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        backgroundColor: COLORS.border,
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    >
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

// Card skeleton for loading card content
export function CardSkeleton() {
  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '16px',
      border: `1px solid ${COLORS.border}`,
      padding: '24px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Skeleton width={48} height={48} borderRadius="12px" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Skeleton width="60%" height="18px" />
          <Skeleton width="40%" height="14px" />
        </div>
      </div>
      <Skeleton height="14px" />
      <Skeleton width="80%" height="14px" />
    </div>
  );
}

export default Loading;
