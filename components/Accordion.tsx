import React, { useState } from 'react';

interface AccordionProps {
  title: string;
  icon?: string;
  badge?: string;
  badgeColor?: 'red' | 'yellow' | 'green' | 'blue';
  children: React.ReactNode;
  defaultOpen?: boolean;
  required?: boolean;
}

export default function Accordion({
  title,
  icon,
  badge,
  badgeColor = 'red',
  children,
  defaultOpen = false,
  required = false
}: AccordionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const badgeColors = {
    red: { bg: '#fef2f2', text: '#991b1b', border: '#fecaca' },
    yellow: { bg: '#fefce8', text: '#854d0e', border: '#fef08a' },
    green: { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
    blue: { bg: '#eff6ff', text: '#1e3a8a', border: '#bfdbfe' }
  };

  const colors = badgeColors[badgeColor];

  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '12px',
      border: '1px solid #e5e7eb',
      marginBottom: '16px',
      overflow: 'hidden',
      transition: 'all 0.2s'
    }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 24px',
          backgroundColor: 'white',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background-color 0.15s'
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.backgroundColor = '#f9fafb';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.backgroundColor = 'white';
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
          {icon && <span style={{ fontSize: '24px' }}>{icon}</span>}
          <div style={{ flex: 1 }}>
            <h3 style={{
              fontSize: '18px',
              fontWeight: '600',
              color: '#111827',
              margin: 0
            }}>
              {title}
              {required && <span style={{ color: '#dc2626', marginLeft: '4px' }}>*</span>}
            </h3>
          </div>
          {badge && (
            <span style={{
              backgroundColor: colors.bg,
              color: colors.text,
              border: `1px solid ${colors.border}`,
              padding: '4px 10px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: '600',
              whiteSpace: 'nowrap'
            }}>
              {badge}
            </span>
          )}
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            style={{
              transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
              flexShrink: 0,
              marginLeft: '8px'
            }}
          >
            <path
              d="M5 7.5L10 12.5L15 7.5"
              stroke="#6b7280"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </button>

      {isOpen && (
        <div style={{
          padding: '0 24px 24px 24px',
          borderTop: '1px solid #f3f4f6'
        }}>
          <div style={{ paddingTop: '20px' }}>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
