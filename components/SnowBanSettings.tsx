import React from 'react';

interface SnowBanSettingsProps {
  onSnowRoute: boolean;
  snowRouteStreet: string | null;
  onWinterBanStreet: boolean;
  winterBanStreet: string | null;
  notifySnowForecast: boolean;
  notifySnowForecastEmail: boolean;
  notifySnowForecastSms: boolean;
  notifySnowConfirmation: boolean;
  notifySnowConfirmationEmail: boolean;
  notifySnowConfirmationSms: boolean;
  onUpdate: (field: string, value: boolean) => void;
}

export default function SnowBanSettings({
  onSnowRoute,
  snowRouteStreet,
  onWinterBanStreet,
  winterBanStreet,
  notifySnowForecast,
  notifySnowForecastEmail,
  notifySnowForecastSms,
  notifySnowConfirmation,
  notifySnowConfirmationEmail,
  notifySnowConfirmationSms,
  onUpdate
}: SnowBanSettingsProps) {
  return (
    <div style={{
      background: '#fafafa',
      padding: '32px',
      borderRadius: '16px',
      marginBottom: '24px'
    }}>
      <h3 style={{
        margin: '0 0 12px',
        fontSize: '24px',
        fontWeight: '600',
        color: '#000'
      }}>
        2-Inch Snow Ban Alerts
      </h3>
      <p style={{
        margin: '0 0 32px',
        fontSize: '16px',
        color: '#6b7280',
        lineHeight: '1.6'
      }}>
        Get notified when Chicago's 2-inch snow parking ban is forecasted or activated. Never get towed or ticketed again.
      </p>

      {/* Winter Overnight Parking Ban Notice (if applicable) */}
      {onWinterBanStreet && winterBanStreet && (
        <div style={{
          background: 'white',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '24px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{
              fontSize: '28px',
              lineHeight: '1',
              marginTop: '2px'
            }}>🌙</div>
            <div style={{ flex: 1 }}>
              <h5 style={{
                margin: '0 0 6px',
                fontSize: '16px',
                fontWeight: '600',
                color: '#000'
              }}>
                Winter Overnight Parking Ban
              </h5>
              <p style={{
                margin: '0 0 4px',
                fontSize: '14px',
                color: '#6b7280',
                lineHeight: '1.5'
              }}>
                <strong style={{ color: '#000' }}>{winterBanStreet}</strong>
              </p>
              <p style={{
                margin: '0',
                fontSize: '13px',
                color: '#9ca3af'
              }}>
                No parking 3:00 AM - 7:00 AM every night from December 1 - April 1. You'll receive a one-time reminder on November 30th.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 2-Inch Snow Ban Status */}
      {onSnowRoute && snowRouteStreet && (
        <div style={{
          background: 'white',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '24px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{
              fontSize: '28px',
              lineHeight: '1',
              marginTop: '2px'
            }}>❄️</div>
            <div style={{ flex: 1 }}>
              <h5 style={{
                margin: '0 0 6px',
                fontSize: '16px',
                fontWeight: '600',
                color: '#000'
              }}>
                Your Address is on a 2-Inch Snow Ban Route
              </h5>
              <p style={{
                margin: '0 0 4px',
                fontSize: '14px',
                color: '#6b7280',
                lineHeight: '1.5'
              }}>
                <strong style={{ color: '#000' }}>{snowRouteStreet}</strong>
              </p>
              <p style={{
                margin: '0',
                fontSize: '13px',
                color: '#9ca3af'
              }}>
                No parking when 2+ inches of snow falls until streets are cleared. We highly recommend enabling both alert types below.
              </p>
            </div>
          </div>
        </div>
      )}

      {!onSnowRoute && (
        <div style={{
          background: 'white',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '24px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
        }}>
          <p style={{ margin: '0', fontSize: '14px', color: '#6b7280', lineHeight: '1.6' }}>
            Your street cleaning address is not on a 2-inch snow ban route. You can still opt in to alerts below if you park on other streets affected by the ban.
          </p>
        </div>
      )}

      {/* Notification Preferences */}
      <h4 style={{
        margin: '0 0 16px',
        fontSize: '14px',
        fontWeight: '600',
        color: '#374151',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
      }}>
        Notification Preferences
      </h4>

      {/* Forecast Alerts Card */}
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '24px',
        marginBottom: '12px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
      }}>
        <div style={{ marginBottom: '20px' }}>
          <label style={{
            display: 'flex',
            alignItems: 'flex-start',
            cursor: 'pointer',
            gap: '12px'
          }}>
            <input
              type="checkbox"
              checked={notifySnowForecast}
              onChange={(e) => onUpdate('notify_snow_forecast', e.target.checked)}
              style={{
                marginTop: '2px',
                width: '20px',
                height: '20px',
                cursor: 'pointer',
                accentColor: '#000'
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: '16px',
                fontWeight: '600',
                color: '#000',
                marginBottom: '4px'
              }}>
                🌤️ Forecast Alerts
              </div>
              <div style={{
                fontSize: '14px',
                color: '#6b7280',
                lineHeight: '1.5'
              }}>
                Get advance notice when 2+ inches of snow is forecasted. We'll send parking ban rules and preparation tips.
              </div>
            </div>
          </label>
        </div>

        {notifySnowForecast && (
          <div style={{
            paddingLeft: '32px',
            paddingTop: '12px',
            borderTop: '1px solid #f3f4f6'
          }}>
            <p style={{
              margin: '0 0 12px',
              fontSize: '13px',
              fontWeight: '600',
              color: '#374151',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Send via
            </p>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              fontSize: '14px',
              marginBottom: '10px',
              color: '#374151'
            }}>
              <input
                type="checkbox"
                checked={notifySnowForecastEmail}
                onChange={(e) => onUpdate('notify_snow_forecast_email', e.target.checked)}
                style={{
                  marginRight: '10px',
                  width: '18px',
                  height: '18px',
                  cursor: 'pointer',
                  accentColor: '#000'
                }}
              />
              <span>📧 Email</span>
            </label>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              fontSize: '14px',
              color: '#374151'
            }}>
              <input
                type="checkbox"
                checked={notifySnowForecastSms}
                onChange={(e) => onUpdate('notify_snow_forecast_sms', e.target.checked)}
                style={{
                  marginRight: '10px',
                  width: '18px',
                  height: '18px',
                  cursor: 'pointer',
                  accentColor: '#000'
                }}
              />
              <span>💬 Text Message</span>
            </label>
          </div>
        )}
      </div>

      {/* Confirmation Alerts Card */}
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '24px',
        marginBottom: '24px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
      }}>
        <div style={{ marginBottom: '20px' }}>
          <label style={{
            display: 'flex',
            alignItems: 'flex-start',
            cursor: 'pointer',
            gap: '12px'
          }}>
            <input
              type="checkbox"
              checked={notifySnowConfirmation || onSnowRoute}
              onChange={(e) => onUpdate('notify_snow_confirmation', e.target.checked)}
              disabled={onSnowRoute}
              style={{
                marginTop: '2px',
                width: '20px',
                height: '20px',
                cursor: onSnowRoute ? 'not-allowed' : 'pointer',
                accentColor: '#000',
                opacity: onSnowRoute ? 0.6 : 1
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: '16px',
                fontWeight: '600',
                color: '#000',
                marginBottom: '4px'
              }}>
                🚨 Confirmation Alerts {onSnowRoute && <span style={{ fontSize: '13px', fontWeight: '500', color: '#10b981' }}>(Required)</span>}
              </div>
              <div style={{
                fontSize: '14px',
                color: '#6b7280',
                lineHeight: '1.5'
              }}>
                {onSnowRoute
                  ? 'Immediate alert when 2+ inches has fallen and the parking ban is now active. You need to move your car ASAP. Auto-enabled for your safety.'
                  : 'Alert when 2+ inches has fallen and the ban is active. Only useful if you park on 2-inch snow ban streets.'
                }
              </div>
            </div>
          </label>
        </div>

        {(notifySnowConfirmation || onSnowRoute) && (
          <div style={{
            paddingLeft: '32px',
            paddingTop: '12px',
            borderTop: '1px solid #f3f4f6'
          }}>
            <p style={{
              margin: '0 0 12px',
              fontSize: '13px',
              fontWeight: '600',
              color: '#374151',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Send via
            </p>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              fontSize: '14px',
              marginBottom: '10px',
              color: '#374151'
            }}>
              <input
                type="checkbox"
                checked={notifySnowConfirmationEmail}
                onChange={(e) => onUpdate('notify_snow_confirmation_email', e.target.checked)}
                style={{
                  marginRight: '10px',
                  width: '18px',
                  height: '18px',
                  cursor: 'pointer',
                  accentColor: '#000'
                }}
              />
              <span>📧 Email</span>
            </label>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              fontSize: '14px',
              color: '#374151'
            }}>
              <input
                type="checkbox"
                checked={notifySnowConfirmationSms}
                onChange={(e) => onUpdate('notify_snow_confirmation_sms', e.target.checked)}
                style={{
                  marginRight: '10px',
                  width: '18px',
                  height: '18px',
                  cursor: 'pointer',
                  accentColor: '#000'
                }}
              />
              <span>💬 Text Message</span>
            </label>
          </div>
        )}
      </div>

      {/* Info Card */}
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '20px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
      }}>
        <p style={{
          margin: '0 0 12px',
          fontSize: '14px',
          fontWeight: '600',
          color: '#000'
        }}>
          About the 2-inch snow ban
        </p>
        <ul style={{
          margin: '0',
          paddingLeft: '20px',
          fontSize: '13px',
          color: '#6b7280',
          lineHeight: '1.8'
        }}>
          <li>Applies to 500 miles of main streets in Chicago</li>
          <li>Activates when 2+ inches of snow has fallen (any time, any day)</li>
          <li>Violations: $150 towing + $60 ticket + $25/day storage = $235+ total</li>
          <li>Remains in effect until snow removal is complete (typically 24-48 hours)</li>
        </ul>
      </div>
    </div>
  );
}
