import React from 'react';

interface SnowBanSettingsProps {
  onSnowRoute: boolean;
  snowRouteStreet: string | null;
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
      background: 'white',
      padding: '24px',
      borderRadius: '8px',
      border: '1px solid #e5e7eb',
      marginBottom: '24px'
    }}>
      <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: '600' }}>
        ❄️ Two-Inch Snow Ban Alerts
      </h3>

      {onSnowRoute && snowRouteStreet && (
        <div style={{
          background: '#dbeafe',
          border: '1px solid #3b82f6',
          borderRadius: '6px',
          padding: '12px',
          marginBottom: '16px'
        }}>
          <p style={{ margin: '0', fontSize: '14px', color: '#1e40af' }}>
            <strong>✓ Your street cleaning address is on a 2-inch snow ban route:</strong><br />
            {snowRouteStreet}
          </p>
        </div>
      )}

      {!onSnowRoute && (
        <div style={{
          background: '#f3f4f6',
          border: '1px solid #d1d5db',
          borderRadius: '6px',
          padding: '12px',
          marginBottom: '16px'
        }}>
          <p style={{ margin: '0', fontSize: '14px', color: '#6b7280' }}>
            Your street cleaning address is not on a 2-inch snow ban route. You can still opt in to forecast alerts.
          </p>
        </div>
      )}

      <p style={{ margin: '0 0 20px', fontSize: '14px', color: '#6b7280' }}>
        Manage notifications for Chicago's 2-inch snow parking ban. Choose when and how you want to be notified.
      </p>

      {/* Forecast Alerts Section */}
      <div style={{
        padding: '16px',
        background: '#fefce8',
        border: '1px solid #fde047',
        borderRadius: '6px',
        marginBottom: '16px'
      }}>
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '15px', fontWeight: '500' }}>
            <input
              type="checkbox"
              checked={notifySnowForecast}
              onChange={(e) => onUpdate('notify_snow_forecast', e.target.checked)}
              style={{ marginRight: '10px', width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <span>🌤️ Forecast Alerts (when 2+ inches predicted)</span>
          </label>
          <p style={{ margin: '6px 0 0 28px', fontSize: '13px', color: '#6b7280' }}>
            Get advance notice when 2+ inches of snow is forecasted. Includes parking ban rules and preparation tips.
          </p>
        </div>

        {notifySnowForecast && (
          <div style={{ marginLeft: '28px', marginTop: '12px' }}>
            <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '500', color: '#4b5563' }}>
              Receive forecast alerts via:
            </p>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '14px', marginBottom: '6px' }}>
              <input
                type="checkbox"
                checked={notifySnowForecastEmail}
                onChange={(e) => onUpdate('notify_snow_forecast_email', e.target.checked)}
                style={{ marginRight: '8px', width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <span>📧 Email</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '14px' }}>
              <input
                type="checkbox"
                checked={notifySnowForecastSms}
                onChange={(e) => onUpdate('notify_snow_forecast_sms', e.target.checked)}
                style={{ marginRight: '8px', width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <span>💬 Text Message (SMS)</span>
            </label>
          </div>
        )}
      </div>

      {/* Confirmation Alerts Section */}
      <div style={{
        padding: '16px',
        background: '#fee2e2',
        border: '1px solid #f87171',
        borderRadius: '6px'
      }}>
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '15px', fontWeight: '500' }}>
            <input
              type="checkbox"
              checked={notifySnowConfirmation}
              onChange={(e) => onUpdate('notify_snow_confirmation', e.target.checked)}
              style={{ marginRight: '10px', width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <span>🚨 Confirmation Alerts (when 2+ inches has fallen)</span>
          </label>
          <p style={{ margin: '6px 0 0 28px', fontSize: '13px', color: '#6b7280' }}>
            {onSnowRoute
              ? 'Alert when ban is active and you need to move your car. Auto-enabled for snow route addresses.'
              : 'Alert when ban is active. Only relevant if you park on snow ban streets.'
            }
          </p>
        </div>

        {notifySnowConfirmation && (
          <div style={{ marginLeft: '28px', marginTop: '12px' }}>
            <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '500', color: '#4b5563' }}>
              Receive confirmation alerts via:
            </p>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '14px', marginBottom: '6px' }}>
              <input
                type="checkbox"
                checked={notifySnowConfirmationEmail}
                onChange={(e) => onUpdate('notify_snow_confirmation_email', e.target.checked)}
                style={{ marginRight: '8px', width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <span>📧 Email</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '14px' }}>
              <input
                type="checkbox"
                checked={notifySnowConfirmationSms}
                onChange={(e) => onUpdate('notify_snow_confirmation_sms', e.target.checked)}
                style={{ marginRight: '8px', width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <span>💬 Text Message (SMS)</span>
            </label>
          </div>
        )}
      </div>

      <div style={{
        marginTop: '16px',
        padding: '12px',
        background: '#f9fafb',
        borderRadius: '6px',
        fontSize: '13px',
        color: '#6b7280'
      }}>
        <p style={{ margin: '0 0 8px', fontWeight: '500', color: '#4b5563' }}>About the 2-inch snow ban:</p>
        <ul style={{ margin: '0', paddingLeft: '20px' }}>
          <li>Applies to 500 miles of main streets in Chicago</li>
          <li>Activates when 2+ inches of snow has fallen (any time, any day)</li>
          <li>Violations: $150 towing + $60 ticket + $25/day storage = $235+ total</li>
          <li>Remains in effect until snow removal is complete (typically 24-48 hours)</li>
        </ul>
      </div>
    </div>
  );
}
