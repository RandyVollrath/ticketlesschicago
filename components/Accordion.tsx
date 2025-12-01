import React, { useState } from 'react';

// Brand Colors - Municipal Fintech
const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
};

interface AccordionProps {
  title: string;
  icon?: string;
  badge?: string;
  badgeColor?: 'red' | 'yellow' | 'green' | 'blue';
  children: React.ReactNode;
  defaultOpen?: boolean;
  required?: boolean;
  id?: string;
}

export default function Accordion({
  title,
  icon,
  badge,
  badgeColor = 'red',
  children,
  defaultOpen = false,
  required = false,
  id
}: AccordionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const badgeColors = {
    red: { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
    yellow: { bg: '#fffbeb', text: '#d97706', border: '#fde68a' },
    green: { bg: `${COLORS.signal}10`, text: '#059669', border: `${COLORS.signal}40` },
    blue: { bg: `${COLORS.regulatory}08`, text: COLORS.regulatory, border: `${COLORS.regulatory}30` }
  };

  const colors = badgeColors[badgeColor];

  return (
    <div
      id={id}
      data-accordion-title={title}
      style={{
        backgroundColor: 'white',
        borderRadius: '16px',
        border: `1px solid ${COLORS.border}`,
        marginBottom: '16px',
        overflow: 'hidden',
        transition: 'all 0.2s',
        boxShadow: isOpen ? '0 4px 12px rgba(0,0,0,0.04)' : 'none'
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
          e.currentTarget.style.backgroundColor = COLORS.concrete;
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.backgroundColor = 'white';
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1 }}>
          {icon && (
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              backgroundColor: isOpen ? `${COLORS.regulatory}10` : COLORS.concrete,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              transition: 'background-color 0.2s'
            }}>
              {icon}
            </div>
          )}
          <div style={{ flex: 1 }}>
            <h3 style={{
              fontSize: '17px',
              fontWeight: '600',
              color: COLORS.graphite,
              margin: 0,
              fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
              letterSpacing: '-0.3px'
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
              padding: '5px 12px',
              borderRadius: '100px',
              fontSize: '12px',
              fontWeight: '600',
              whiteSpace: 'nowrap'
            }}>
              {badge}
            </span>
          )}
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '8px',
            backgroundColor: isOpen ? `${COLORS.regulatory}10` : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: '4px',
            transition: 'all 0.2s'
          }}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              style={{
                transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s'
              }}
            >
              <path
                d="M5 7.5L10 12.5L15 7.5"
                stroke={isOpen ? COLORS.regulatory : COLORS.slate}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </button>

      <div style={{
        maxHeight: isOpen ? '5000px' : '0',
        overflow: 'hidden',
        transition: 'max-height 0.3s ease-in-out'
      }}>
        <div style={{
          padding: '0 24px 24px 24px',
          borderTop: `1px solid ${COLORS.border}`
        }}>
          <div style={{ paddingTop: '20px' }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
