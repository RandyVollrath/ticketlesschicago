/**
 * Admin alert recipients. Configure via ADMIN_ALERT_EMAILS env var
 * (comma-separated). Defaults to the historical single recipient so
 * behavior is unchanged when the env var is unset.
 *
 * Shared across crons so a single env var controls all admin alerts.
 */
export function getAdminAlertEmails(): string[] {
  const raw = process.env.ADMIN_ALERT_EMAILS;
  if (!raw) return ['randyvollrath@gmail.com'];
  const list = raw.split(',').map(e => e.trim()).filter(Boolean);
  return list.length > 0 ? list : ['randyvollrath@gmail.com'];
}
