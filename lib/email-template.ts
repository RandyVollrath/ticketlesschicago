/**
 * Shared Email Template System for Autopilot America
 *
 * Every outbound email uses this module for consistent, professional design.
 * Table-based layout for maximum email client compatibility (Gmail, Outlook, Apple Mail, Yahoo).
 *
 * Design: Clean navy header, white body, subtle footer. No gradients (Outlook strips them).
 */

// Simple HTML escape for email templates — prevents XSS from user-supplied values
function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------
const C = {
  // Brand
  navy: '#0F172A',
  navyLight: '#1E293B',
  white: '#FFFFFF',

  // Primary action
  blue: '#2563EB',
  blueDark: '#1D4ED8',
  blueLight: '#EFF6FF',
  blueBorder: '#BFDBFE',
  blueText: '#1E40AF',

  // Success / positive
  green: '#059669',
  greenLight: '#ECFDF5',
  greenBorder: '#A7F3D0',
  greenText: '#065F46',

  // Warning
  amber: '#D97706',
  amberLight: '#FFFBEB',
  amberBorder: '#FDE68A',
  amberText: '#92400E',

  // Danger / urgent
  red: '#DC2626',
  redLight: '#FEF2F2',
  redBorder: '#FECACA',
  redText: '#991B1B',

  // Neutral
  gray50: '#F9FAFB',
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
  gray300: '#D1D5DB',
  gray500: '#6B7280',
  gray700: '#374151',
  gray900: '#111827',
} as const;

// ---------------------------------------------------------------------------
// Layout primitives (table-based for email client compat)
// ---------------------------------------------------------------------------

/**
 * Full email wrapper — centers content at 600px max, sets bg color.
 * Every email calls: `emailLayout(header(...) + body(...) + footer(...))`
 */
export function emailLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Autopilot America</title>
<!--[if mso]>
<style>table,td{font-family:Arial,Helvetica,sans-serif !important;}</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${C.gray100};-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.gray100};">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
${content}
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export interface HeaderOptions {
  title?: string;
  subtitle?: string;
  preheader?: string;
}

export function emailHeader(opts: HeaderOptions = {}): string {
  const preheaderHtml = opts.preheader
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(opts.preheader)}</div>`
    : '';

  return `${preheaderHtml}
<tr><td style="background-color:${C.navy};padding:32px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td>
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:${C.blue};margin-bottom:${opts.title ? '12px' : '0'};">AUTOPILOT AMERICA</div>
  ${opts.title ? `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;color:${C.white};line-height:1.3;">${opts.title}</div>` : ''}
  ${opts.subtitle ? `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:rgba(255,255,255,0.7);margin-top:6px;">${opts.subtitle}</div>` : ''}
</td></tr>
</table>
</td></tr>`;
}

// ---------------------------------------------------------------------------
// Body wrapper
// ---------------------------------------------------------------------------

export function emailBody(content: string): string {
  return `<tr><td style="background-color:${C.white};padding:32px 40px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${C.gray700};">
${content}
</td></tr>`;
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

export interface FooterOptions {
  includeUnsubscribe?: boolean;
  unsubscribeUrl?: string;
}

export function emailFooter(opts: FooterOptions = {}): string {
  const unsubLink = opts.includeUnsubscribe && opts.unsubscribeUrl
    ? `<tr><td style="padding-top:12px;"><a href="${opts.unsubscribeUrl}" style="color:${C.gray500};font-size:12px;text-decoration:underline;">Unsubscribe</a></td></tr>`
    : '';

  return `<tr><td style="background-color:${C.gray50};padding:24px 40px;border-top:1px solid ${C.gray200};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${C.gray500};text-align:center;line-height:1.6;">
  <strong style="color:${C.gray700};">Autopilot America</strong><br>
  Questions? <a href="mailto:support@autopilotamerica.com" style="color:${C.blue};text-decoration:none;">support@autopilotamerica.com</a>
</td></tr>
${unsubLink}
</table>
</td></tr>`;
}

// ---------------------------------------------------------------------------
// Content blocks — compose these inside emailBody()
// ---------------------------------------------------------------------------

/** Paragraph text */
export function p(text: string, opts?: { size?: string; color?: string; bold?: boolean; center?: boolean }): string {
  const style = [
    `margin:0 0 16px`,
    `font-size:${opts?.size || '15px'}`,
    `line-height:1.6`,
    `color:${opts?.color || C.gray700}`,
    opts?.bold ? 'font-weight:600' : '',
    opts?.center ? 'text-align:center' : '',
  ].filter(Boolean).join(';');
  return `<p style="${style}">${text}</p>`;
}

/** Greeting line: "Hi Name," */
export function greeting(name?: string): string {
  return p(`Hi ${name ? esc(name) : 'there'},`);
}

/** Heading inside body */
export function h2(text: string, opts?: { color?: string }): string {
  return `<h2 style="margin:0 0 12px;font-size:18px;font-weight:700;color:${opts?.color || C.gray900};line-height:1.3;">${text}</h2>`;
}

export function h3(text: string, opts?: { color?: string }): string {
  return `<h3 style="margin:0 0 8px;font-size:16px;font-weight:600;color:${opts?.color || C.gray900};line-height:1.3;">${text}</h3>`;
}

/** Colored callout box */
export type CalloutType = 'info' | 'success' | 'warning' | 'danger';

export function callout(type: CalloutType, title: string, body: string): string {
  const styles: Record<CalloutType, { bg: string; border: string; titleColor: string; textColor: string }> = {
    info:    { bg: C.blueLight,  border: C.blue,  titleColor: C.blueText,  textColor: C.blueText },
    success: { bg: C.greenLight, border: C.green, titleColor: C.greenText, textColor: C.greenText },
    warning: { bg: C.amberLight, border: C.amber, titleColor: C.amberText, textColor: C.amberText },
    danger:  { bg: C.redLight,   border: C.red,   titleColor: C.redText,   textColor: C.redText },
  };
  const s = styles[type];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
<tr><td style="background-color:${s.bg};border-left:4px solid ${s.border};border-radius:4px;padding:16px 20px;">
  <div style="font-size:15px;font-weight:700;color:${s.titleColor};margin-bottom:6px;">${title}</div>
  <div style="font-size:14px;line-height:1.6;color:${s.textColor};">${body}</div>
</td></tr>
</table>`;
}

/** Stat card — big number with label. Use inside a statRow(). */
export function stat(value: string, label: string, opts?: { bg?: string; color?: string }): string {
  const bg = opts?.bg || C.gray50;
  const color = opts?.color || C.gray900;
  return `<td style="background-color:${bg};border-radius:6px;padding:16px;text-align:center;width:50%;" valign="top">
  <div style="font-size:28px;font-weight:800;color:${color};line-height:1.2;">${value}</div>
  <div style="font-size:12px;color:${C.gray500};margin-top:4px;text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
</td>`;
}

/** Row of stat cards (wraps 2 stat() calls) */
export function statRow(...stats: string[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
<tr>${stats.map(s => s).join('<td style="width:12px;"></td>')}</tr>
</table>`;
}

/** Primary CTA button */
export function button(text: string, url: string, opts?: { color?: string; fullWidth?: boolean }): string {
  const bg = opts?.color || C.blue;
  const width = opts?.fullWidth ? 'width:100%;' : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px;${opts?.fullWidth ? 'width:100%;' : ''}">
<tr><td align="center" style="background-color:${bg};border-radius:6px;">
  <a href="${url}" target="_blank" style="display:inline-block;${width}padding:14px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:${C.white};text-decoration:none;text-align:center;box-sizing:border-box;">${text}</a>
</td></tr>
</table>`;
}

/** Secondary / outline button */
export function buttonOutline(text: string, url: string, opts?: { color?: string }): string {
  const color = opts?.color || C.blue;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px;">
<tr><td align="center" style="border:2px solid ${color};border-radius:6px;">
  <a href="${url}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:${color};text-decoration:none;">${text}</a>
</td></tr>
</table>`;
}

/** Horizontal divider */
export function divider(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td style="border-top:1px solid ${C.gray200};"></td></tr></table>`;
}

/** Spacer */
export function spacer(px: number = 16): string {
  return `<div style="height:${px}px;line-height:${px}px;font-size:1px;">&nbsp;</div>`;
}

/** Bullet list */
export function bulletList(items: string[], opts?: { color?: string }): string {
  const color = opts?.color || C.gray700;
  return `<ul style="margin:0 0 16px;padding-left:20px;color:${color};font-size:14px;line-height:1.8;">${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
}

/** Numbered list */
export function numberedList(items: string[], opts?: { color?: string }): string {
  const color = opts?.color || C.gray700;
  return `<ol style="margin:0 0 16px;padding-left:20px;color:${color};font-size:14px;line-height:1.8;">${items.map(i => `<li style="margin-bottom:4px;">${i}</li>`).join('')}</ol>`;
}

/** Key-value detail row (like "License Plate: IL ABC123") */
export function detailRow(label: string, value: string): string {
  return `<tr>
<td style="padding:8px 0;border-bottom:1px solid ${C.gray100};font-size:13px;color:${C.gray500};width:40%;">${label}</td>
<td style="padding:8px 0;border-bottom:1px solid ${C.gray100};font-size:14px;font-weight:600;color:${C.gray900};">${value}</td>
</tr>`;
}

/** Detail table — wraps multiple detailRow() calls */
export function detailTable(rows: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">${rows}</table>`;
}

/** Section with light background and optional title */
export function section(title: string, content: string, opts?: { bg?: string; borderColor?: string }): string {
  const bg = opts?.bg || C.gray50;
  const border = opts?.borderColor || C.gray200;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
<tr><td style="background-color:${bg};border:1px solid ${border};border-radius:6px;padding:20px;">
  ${title ? `<div style="font-size:15px;font-weight:700;color:${C.gray900};margin-bottom:12px;">${title}</div>` : ''}
  <div style="font-size:14px;line-height:1.6;color:${C.gray700};">${content}</div>
</td></tr>
</table>`;
}

/** Steps list — numbered with circles */
export function steps(items: string[]): string {
  return items.map((item, i) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
<tr>
  <td style="width:32px;vertical-align:top;">
    <div style="width:24px;height:24px;border-radius:12px;background-color:${C.blue};color:${C.white};font-size:12px;font-weight:700;text-align:center;line-height:24px;">${i + 1}</div>
  </td>
  <td style="padding-left:12px;font-size:14px;line-height:1.5;color:${C.gray700};">${item}</td>
</tr>
</table>`).join('');
}

/** Signature block — "Talk soon, Randy" */
export function signature(name: string = 'Randy', title: string = 'Founder, Autopilot America'): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
<tr><td style="font-size:14px;line-height:1.5;color:${C.gray700};">
  Talk soon,<br>
  <strong>${esc(name)}</strong><br>
  <span style="font-size:13px;color:${C.gray500};">${esc(title)}</span>
</td></tr>
</table>`;
}

// ---------------------------------------------------------------------------
// Convenience: build a complete email in one call
// ---------------------------------------------------------------------------

export interface QuickEmailOptions {
  preheader?: string;
  headerTitle?: string;
  headerSubtitle?: string;
  body: string;
  includeUnsubscribe?: boolean;
  unsubscribeEmail?: string;
}

/**
 * Build a complete email with header, body, and footer in one call.
 *
 * ```ts
 * const html = quickEmail({
 *   headerTitle: 'Your FOIA Request Is In',
 *   headerSubtitle: 'We're pulling your ticket history',
 *   body: greeting('Randy') + p('We submitted your request...') + button('View Status', url),
 * });
 * ```
 */
export function quickEmail(opts: QuickEmailOptions): string {
  const unsub = opts.includeUnsubscribe && opts.unsubscribeEmail
    ? `https://autopilotamerica.com/unsubscribe?email=${encodeURIComponent(opts.unsubscribeEmail)}`
    : undefined;

  return emailLayout(
    emailHeader({
      title: opts.headerTitle,
      subtitle: opts.headerSubtitle,
      preheader: opts.preheader,
    }) +
    emailBody(opts.body) +
    emailFooter({
      includeUnsubscribe: opts.includeUnsubscribe,
      unsubscribeUrl: unsub,
    })
  );
}

// Re-export esc for templates that need to escape user content
export { esc };
