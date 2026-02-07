/**
 * Centralized Message Templates for Autopilot America
 *
 * This file consolidates all SMS, Email, and Voice message templates
 * to ensure consistency and make updates easy.
 */

import { EMAIL, URLS, BRAND, FEATURES } from './config';

// =============================================================================
// TYPES
// =============================================================================

export type UrgencyLevel = 'critical' | 'urgent' | 'warning' | 'normal';
export type RenewalType = 'City Sticker' | 'License Plate' | 'Emissions Test';
export type ButtonColor = 'primary' | 'success' | 'warning' | 'danger' | 'secondary';

export interface RenewalContext {
  renewalType: RenewalType;
  daysUntil: number;
  dueDate: Date;
  hasProtection: boolean;
  profileConfirmed?: boolean;
  actuallyPurchased?: boolean;
  needsPermitDocs?: boolean;
  blocksLicensePlate?: boolean;
}

export interface UserContext {
  firstName?: string;
  email?: string;
  phone?: string;
  licensePlate?: string;
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Get urgency level based on days until due
 */
export function getUrgencyLevel(daysUntil: number): UrgencyLevel {
  if (daysUntil <= 1) return 'critical';
  if (daysUntil <= 7) return 'urgent';
  if (daysUntil <= 14) return 'warning';
  return 'normal';
}

/**
 * Format days until as human-readable text
 */
export function formatDaysText(daysUntil: number): string {
  if (daysUntil === 0) return 'TODAY';
  if (daysUntil === 1) return 'TOMORROW';
  return `${daysUntil} days`;
}

/**
 * Format date for display
 */
export function formatDate(date: Date, style: 'short' | 'long' = 'short'): string {
  if (style === 'long') {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Calculate purchase date (30 days before expiry)
 */
export function getPurchaseDate(dueDate: Date): Date {
  return new Date(dueDate.getTime() - 30 * 24 * 60 * 60 * 1000);
}

function getRenewalLink(renewalType: RenewalType): string | null {
  if (renewalType === 'City Sticker') return URLS.CITY_STICKER_RENEWAL;
  if (renewalType === 'License Plate') return URLS.LICENSE_PLATE_RENEWAL;
  return null;
}

function getTicketWarning(renewalType: RenewalType, daysUntil: number): string {
  if (daysUntil > 30) return '';
  if (renewalType === 'City Sticker') return ` You're ${daysUntil} days from a possible $200 ticket.`;
  if (renewalType === 'License Plate') return ` You're ${daysUntil} days from a possible $90 ticket.`;
  return '';
}

// =============================================================================
// SMS TEMPLATES
// =============================================================================

export const sms = {
  /**
   * Renewal reminder for free users (no auto-purchase)
   */
  renewalFree(ctx: RenewalContext): string {
    const { renewalType, daysUntil, blocksLicensePlate } = ctx;
    const urgentPrefix = blocksLicensePlate ? 'URGENT: ' : '';
    const plateWarning = blocksLicensePlate ? ' Required for license plate renewal!' : '';
    const renewalLink = getRenewalLink(renewalType);
    const ticketWarning = getTicketWarning(renewalType, daysUntil);

    const isEmissions = renewalType === 'Emissions Test';
    const actionText = isEmissions
      ? 'Find test locations at airteam.app'
      : renewalLink
      ? `Renew now: ${renewalLink}`
      : "Don't forget to renew!";

    if (daysUntil === 0) {
      return `Autopilot: ${urgentPrefix}Your ${renewalType} is due TODAY.${plateWarning}${ticketWarning} ${isEmissions ? 'Complete your test now at airteam.app' : actionText}. Reply STOP to opt out.`;
    }
    if (daysUntil === 1) {
      return `Autopilot: ${urgentPrefix}Your ${renewalType} is due TOMORROW.${plateWarning}${ticketWarning} ${isEmissions ? 'Complete your test today' : actionText}. Reply STOP to opt out.`;
    }
    if (daysUntil <= 7) {
      return `Autopilot: ${urgentPrefix}Your ${renewalType} is due in ${daysUntil} days.${plateWarning}${ticketWarning} ${actionText}. Reply STOP to opt out.`;
    }
    return `Autopilot: ${urgentPrefix}Your ${renewalType} is due in ${daysUntil} days (${formatDate(ctx.dueDate)}).${plateWarning}${ticketWarning}${isEmissions ? ' You must complete this test to renew your license plate.' : renewalLink ? ` Renew here: ${renewalLink}.` : ''} Reply STOP to opt out.`;
  },

  /**
   * Renewal reminder for Protection users (auto-purchase enabled)
   */
  renewalProtection(ctx: RenewalContext): string {
    if (!FEATURES.REGISTRATION_AUTOMATION) {
      return sms.renewalFree({ ...ctx, hasProtection: false });
    }

    const { renewalType, daysUntil, dueDate, profileConfirmed, actuallyPurchased, needsPermitDocs } = ctx;
    const purchaseDate = getPurchaseDate(dueDate);
    const purchaseDateStr = formatDate(purchaseDate);
    const renewalLink = getRenewalLink(renewalType);
    const ticketWarning = getTicketWarning(renewalType, daysUntil);

    let message = '';

    if (daysUntil === 30) {
      // Charge day
      message = `Autopilot: We're charging your card TODAY for your ${renewalType} renewal (expires in 30 days).${ticketWarning} Reply NOW if you have: New VIN (new car), new plate number, or new address. This is your final reminder before we process payment.`;
    } else if (daysUntil === 37) {
      // 1 week before charge
      message = `Autopilot: Your ${renewalType} expires in ${daysUntil} days. We'll charge your card in 7 days (on ${purchaseDateStr}). Please update your profile NOW if you have: New VIN (new car), new plate number, or new address. This is your last reminder before charge day.`;
    } else if (daysUntil > 37) {
      // Before purchase window
      if (!profileConfirmed) {
        message = `Autopilot: Your ${renewalType} expires in ${daysUntil} days.${ticketWarning} We'll charge your card on ${purchaseDateStr}. Reply CONFIRM if your profile info is current (VIN, plate, address). Or visit ${URLS.SETTINGS} to update.`;
      } else {
        message = `Autopilot: Your ${renewalType} expires in ${daysUntil} days.${ticketWarning} We'll charge your card on ${purchaseDateStr} (30 days before expiration). Your profile is confirmed. Reply if you need to update anything!`;
      }
    } else if (daysUntil >= 14) {
      // Post-purchase, waiting for delivery
      if (actuallyPurchased) {
        message = `Autopilot: Good news! We already purchased your ${renewalType}. Your sticker will arrive by mail within 10-14 days. No action needed from you!`;
      } else {
        message = `Autopilot: Your ${renewalType} expires in ${daysUntil} days. We're processing your renewal purchase and will update you when it's confirmed. Your profile is confirmed.`;
      }
    } else {
      // Delivery window
      if (actuallyPurchased) {
        message = `Autopilot: Your ${renewalType} sticker should arrive soon (if it hasn't already). We purchased it on ${purchaseDateStr} and it typically takes 10-14 days to arrive. Contact us if you haven't received it.`;
      } else {
        message = `Autopilot: Your ${renewalType} expires in ${daysUntil} days.${ticketWarning} We're working on your renewal. Please contact support if you have questions.`;
      }
    }

    if (renewalLink && daysUntil <= 30) {
      message += ` If needed, renew directly here: ${renewalLink}.`;
    }

    // Add permit zone docs request if needed
    if (needsPermitDocs) {
      message += ` URGENT: Text or email permit zone documents (ID front/back + proof of residency) to ${EMAIL.DOCUMENTS}`;
    }

    message += ' Reply STOP to opt out.';
    return message;
  },

  /**
   * Emissions test reminder (specialized for emissions)
   */
  emissionsReminder(daysUntil: number, _hasProtection: boolean, blocksPlate: boolean): string {
    const urgencyPrefix = blocksPlate ? '🚨 URGENT: ' : '';
    const plateWarning = blocksPlate ? " We can't renew your license plate without it!" : '';

    if (daysUntil <= 1) {
      return `${urgencyPrefix}Emissions test due ${daysUntil === 0 ? 'TODAY' : 'TOMORROW'}! Without it, you can't renew your license plate.${plateWarning} Find locations: airteam.app Reply STOP to opt out.`;
    }
    return `Autopilot: Your emissions test is due in ${daysUntil} days. You need to complete this to renew your license plate.${plateWarning} Find locations: airteam.app Reply STOP to opt out.`;
  },

  /**
   * Sticker purchased notification
   */
  stickerPurchased(plate: string): string {
    return `Autopilot: Great news! Your Chicago City Sticker for ${plate} has been purchased! It will be mailed to you and should arrive in 10-14 days. Reply STOP to opt out.`;
  },

  /**
   * Sticker delivery reminder (day 10)
   */
  stickerDelivery(plate: string): string {
    return `Autopilot: Your city sticker for ${plate} should arrive soon! Check your mailbox over the next few days. Contact us if you don't receive it within a week. Reply STOP to opt out.`;
  },

  /**
   * Sticker apply check (day 14)
   */
  stickerApplyCheck(plate: string): string {
    return `Autopilot: Quick check - did you receive and apply your city sticker for ${plate}? Reply YES if all set, or NO if you need help. Reply STOP to opt out.`;
  },

  /**
   * Permit zone documents request
   */
  permitDocsRequest(): string {
    return `Autopilot: To get your residential parking permit, we need 2 photos: 1) Driver's license (front & back) 2) Proof of address (utility bill, lease, etc). Text them to this number OR email to ${EMAIL.DOCUMENTS}. Reply STOP to opt out.`;
  },

  /**
   * Winter ban alert
   */
  winterBanAlert(streetName: string): string {
    return `❄️ IMPORTANT: ${streetName} has ACTIVE Winter Parking Ban. Move your vehicle NOW to avoid towing. Check safe parking at ${URLS.DASHBOARD}. Reply STOP to opt out.`;
  },

  /**
   * Profile incomplete reminder
   */
  profileIncomplete(missingFields: string[]): string {
    const fieldList = missingFields.join(', ');
    return `Autopilot: Your profile is incomplete! Missing: ${fieldList}. Complete it at ${URLS.SETTINGS} to get full protection. Reply STOP to opt out.`;
  }
};

// =============================================================================
// EMAIL COMPONENTS (Reusable HTML builders)
// =============================================================================

const COLORS = {
  primary: '#2563eb',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  secondary: '#6b7280',
  background: '#f3f4f6',
  text: '#374151',
  textLight: '#6b7280'
};

export const emailComponents = {
  /**
   * Email wrapper with consistent styling
   */
  wrapper(content: string): string {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: white;">
        ${content}
      </div>
    `;
  },

  /**
   * Blue gradient header
   */
  header(title?: string, subtitle?: string): string {
    return `
      <div style="background: ${COLORS.primary}; color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px; font-weight: 600;">${BRAND.NAME}</h1>
        <p style="margin: 8px 0 0; font-size: 16px; opacity: 0.9;">${subtitle || BRAND.TAGLINE}</p>
      </div>
    `;
  },

  /**
   * Alert/info box with colored left border
   */
  alertBox(type: 'info' | 'success' | 'warning' | 'danger', title: string, content: string): string {
    const colors = {
      info: { bg: '#eff6ff', border: COLORS.primary, text: '#1e40af' },
      success: { bg: '#d1fae5', border: COLORS.success, text: '#065f46' },
      warning: { bg: '#fef3c7', border: COLORS.warning, text: '#92400e' },
      danger: { bg: '#fef2f2', border: COLORS.danger, text: '#991b1b' }
    };
    const c = colors[type];

    return `
      <div style="background: ${c.bg}; border-left: 4px solid ${c.border}; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
        <h2 style="margin: 0 0 12px; color: ${c.text}; font-size: 20px;">${title}</h2>
        <div style="color: ${c.text}; font-size: 16px; line-height: 1.5;">${content}</div>
      </div>
    `;
  },

  /**
   * CTA Button
   */
  button(text: string, url: string, color: ButtonColor = 'primary'): string {
    const bgColor = COLORS[color] || COLORS.primary;
    return `
      <a href="${url}" style="background: ${bgColor}; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">
        ${text}
      </a>
    `;
  },

  /**
   * Section with background
   */
  section(content: string, bgColor: string = '#f0f9ff', borderColor: string = '#0ea5e9'): string {
    return `
      <div style="background: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 8px; padding: 20px; margin: 24px 0;">
        ${content}
      </div>
    `;
  },

  /**
   * Standard footer
   */
  footer(): string {
    return `
      <div style="padding: 20px; background: ${COLORS.background}; text-align: center; color: ${COLORS.textLight}; font-size: 14px; border-radius: 0 0 8px 8px;">
        <div style="margin-bottom: 12px;">
          <strong style="color: ${COLORS.text};">${BRAND.NAME}</strong><br>
          ${BRAND.TRUSTED_TAGLINE}
        </div>
        <p style="margin: 0;">Questions? Contact us at ${EMAIL.SUPPORT}</p>
      </div>
    `;
  },

  /**
   * Body wrapper with padding
   */
  body(content: string): string {
    return `<div style="padding: 32px 24px; background: #ffffff;">${content}</div>`;
  }
};

// =============================================================================
// EMAIL TEMPLATES
// =============================================================================

export const email = {
  /**
   * Renewal reminder email for free users
   */
  renewalFree(ctx: RenewalContext): { subject: string; html: string; text: string } {
    const { renewalType, daysUntil, dueDate, blocksLicensePlate } = ctx;
    const dueDateFormatted = formatDate(dueDate, 'long');
    const timeText = formatDaysText(daysUntil);
    const isEmissions = renewalType === 'Emissions Test';
    const renewalLink = getRenewalLink(renewalType);
    const ticketWarning = getTicketWarning(renewalType, daysUntil);

    const subject = daysUntil <= 1
      ? `${renewalType} Renewal Reminder - Due ${timeText === 'TODAY' ? 'Today' : 'Tomorrow'}`
      : `${renewalType} - Due in ${daysUntil} days`;

    const urgencyBox = daysUntil <= 1 ? emailComponents.alertBox(
      'warning',
      `⏰ ${isEmissions ? 'Test' : 'Renewal'} Due ${timeText}`,
      `We recommend ${isEmissions ? 'completing your test' : 'renewing'} today to stay compliant and avoid any potential issues.`
    ) : '';

    const blocksPlateWarning = blocksLicensePlate ? emailComponents.alertBox(
      'danger',
      '🚨 URGENT: Required for License Plate Renewal',
      `<strong>Illinois requires a valid emissions test to renew your license plate.</strong> Your license plate renewal is also coming up, and you won't be able to complete it until your emissions test is done.`
    ) : '';

    const howToContent = isEmissions
      ? `<strong>Step 1:</strong> Find a testing location at <a href="${URLS.EMISSIONS_LOCATOR}" style="color: ${COLORS.primary};">airteam.app</a><br>
         <strong>Step 2:</strong> Bring your vehicle and registration<br>
         <strong>Step 3:</strong> Complete the test (takes about 10-15 minutes)<br>
         <strong>Step 4:</strong> Results are sent electronically to the state`
      : renewalType === 'City Sticker'
      ? `Renew online at <a href="${URLS.CITY_STICKER_RENEWAL}" style="color: ${COLORS.primary};">City Clerk EZBuy</a> or visit any Currency Exchange location. Bring your registration and proof of insurance.`
      : `Renew online at <a href="${URLS.LICENSE_PLATE_RENEWAL}" style="color: ${COLORS.primary};">Illinois Secretary of State Online Renewals</a> or visit your local Secretary of State facility.`;

    const ticketRiskBox = ticketWarning
      ? emailComponents.alertBox('danger', '⚠️ Ticket Risk Window', ticketWarning.trim())
      : '';

    const html = emailComponents.wrapper(`
      ${emailComponents.header()}
      ${emailComponents.body(`
        ${emailComponents.alertBox('info', `📋 ${renewalType} Reminder`, `
          <strong>Due Date:</strong> ${dueDateFormatted}<br>
          <strong>Days Remaining:</strong> ${daysUntil === 0 ? 'Due today' : daysUntil === 1 ? '1 day' : `${daysUntil} days`}
        `)}
        ${urgencyBox}
        ${ticketRiskBox}
        ${blocksPlateWarning}
        ${emailComponents.section(`
          <h3 style="color: #0c4a6e; margin: 0 0 16px; font-size: 18px;">How to ${isEmissions ? 'Complete Your Test' : 'Renew'}:</h3>
          <div style="color: #0369a1; font-size: 15px; line-height: 1.6; margin-bottom: 16px;">${howToContent}</div>
          <div style="text-align: center; margin: 20px 0;">
            ${isEmissions ? emailComponents.button('Find Testing Locations', URLS.EMISSIONS_LOCATOR) : ''}
            ${!isEmissions && renewalLink ? emailComponents.button('Renew Now', renewalLink, 'warning') : ''}
            ${emailComponents.button('View Dashboard', URLS.DASHBOARD, isEmissions ? 'secondary' : 'primary')}
          </div>
        `)}
      `)}
      ${emailComponents.footer()}
    `);

    const text = `
${BRAND.NAME} - ${renewalType} Reminder

Due Date: ${dueDateFormatted}
Days Remaining: ${daysUntil === 0 ? 'Due today' : daysUntil === 1 ? '1 day' : `${daysUntil} days`}

${daysUntil <= 1 ? `We recommend ${isEmissions ? 'completing your test' : 'renewing'} today to stay compliant.\n` : ''}
${ticketWarning ? `${ticketWarning.trim()}\n` : ''}
${renewalLink ? `Renew online: ${renewalLink}\n` : ''}
View your dashboard: ${URLS.DASHBOARD}

Questions? Reply to ${EMAIL.SUPPORT}
    `.trim();

    return { subject, html, text };
  },

  /**
   * Renewal reminder email for Protection users
   */
  renewalProtection(ctx: RenewalContext, user: UserContext): { subject: string; html: string; text: string } {
    if (!FEATURES.REGISTRATION_AUTOMATION) {
      return email.renewalFree({ ...ctx, hasProtection: false });
    }

    const { renewalType, daysUntil, dueDate, actuallyPurchased, needsPermitDocs } = ctx;
    const dueDateFormatted = formatDate(dueDate, 'long');
    const purchaseDate = getPurchaseDate(dueDate);
    const purchaseDateStr = formatDate(purchaseDate);
    const renewalLink = getRenewalLink(renewalType);
    const ticketWarning = getTicketWarning(renewalType, daysUntil);

    // Subject varies by stage
    let subject: string;
    if (daysUntil === 30) {
      subject = `${renewalType} Renewal - Charging your card today!`;
    } else if (daysUntil === 37) {
      subject = `${renewalType} Renewal - Charging in 7 days - confirm your info`;
    } else if (daysUntil > 37) {
      subject = `${renewalType} Renewal - Confirm your info`;
    } else {
      subject = `${renewalType} Renewal - Sticker arriving soon`;
    }

    // Status message varies by stage
    let statusMessage: string;
    if (daysUntil === 30) {
      statusMessage = `We're <strong>charging your card today</strong> for your ${renewalType} renewal (expires in 30 days). ${ticketWarning ? `<strong>${ticketWarning.trim()}</strong> ` : ''}The sticker will be mailed to you and should arrive within 10-14 days!`;
    } else if (daysUntil === 37) {
      statusMessage = `Your ${renewalType} expires in ${daysUntil} days. We'll <strong>charge your card in 7 days</strong> (on ${purchaseDateStr}). Please update your profile now if you have any changes. This is your last reminder before charge day!`;
    } else if (daysUntil > 37) {
      statusMessage = `We'll automatically charge your card on <strong>${purchaseDateStr}</strong> (30 days before expiration) for your ${renewalType} renewal.${ticketWarning ? ` <strong>${ticketWarning.trim()}</strong>` : ''} You have time to update your info if needed!`;
    } else if (daysUntil >= 14 && actuallyPurchased) {
      statusMessage = `Good news! We already purchased your ${renewalType} renewal. Your sticker is in the mail and should arrive within 10-14 days. No action needed from you!`;
    } else if (daysUntil >= 14) {
      statusMessage = `Your ${renewalType} expires in ${daysUntil} days. We're processing your renewal purchase and will update you when it's confirmed.`;
    } else if (actuallyPurchased) {
      statusMessage = `Your ${renewalType} sticker should arrive soon (if it hasn't already). We purchased it on ${purchaseDateStr} and it typically takes 10-14 days to arrive.`;
    } else {
      statusMessage = `Your ${renewalType} expires in ${daysUntil} days.${ticketWarning} We're working on your renewal. Please contact support if you have questions.`;
    }

    const confirmInfoSection = daysUntil > 30 ? emailComponents.section(`
      <h3 style="color: #0c4a6e; margin: 0 0 12px; font-size: 18px;">📝 Please Confirm Your Information</h3>
      <p style="color: #0369a1; margin: 0 0 16px; line-height: 1.6;">
        Before we charge your card on <strong>${purchaseDateStr}</strong>, please verify your profile is up-to-date:
      </p>
      <ul style="color: #0369a1; margin: 0 0 16px; padding-left: 20px; line-height: 1.8;">
        <li>VIN (if you got a new vehicle)</li>
        <li>License plate number</li>
        <li>Mailing address (where we'll send your sticker)</li>
      </ul>
      <div style="text-align: center; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
        ${emailComponents.button('✅ Confirm Profile is Current', URLS.SETTINGS)}
        ${emailComponents.button('Update My Profile', URLS.SETTINGS, 'warning')}
      </div>
    `) : '';

    const permitDocsSection = needsPermitDocs ? emailComponents.alertBox(
      'danger',
      '📄 Permit Zone Documents Required',
      `<strong>ACTION NEEDED:</strong> Your address is in a residential permit parking zone. We need:<br><br>
      <ul style="margin: 0; padding-left: 20px;">
        <li><strong>Driver's License:</strong> Front and back (clear photos)</li>
        <li><strong>Proof of Residency:</strong> Utility bill, lease agreement, mortgage statement, or property tax bill</li>
      </ul><br>
      <strong>Submit to:</strong> ${EMAIL.DOCUMENTS} or upload at ${URLS.DASHBOARD}`
    ) : '';

    const html = emailComponents.wrapper(`
      ${emailComponents.header()}
      ${emailComponents.body(`
        ${emailComponents.alertBox('info', `📋 ${renewalType} Reminder`, `
          <strong>Due Date:</strong> ${dueDateFormatted}<br>
          <strong>Days Remaining:</strong> ${daysUntil} days
        `)}
        ${renewalLink ? emailComponents.alertBox('info', '🔗 Direct Renewal Link', `Renew directly here if needed: <a href="${renewalLink}" style="color: ${COLORS.primary};">${renewalLink}</a>`) : ''}
        ${emailComponents.alertBox('success', '✅ We\'re Handling This For You', statusMessage)}
        ${confirmInfoSection}
        ${permitDocsSection}
      `)}
      ${emailComponents.footer()}
    `);

    const text = `
${BRAND.NAME} - ${renewalType} Reminder

Due Date: ${dueDateFormatted}
Days Remaining: ${daysUntil} days

WE'RE HANDLING THIS FOR YOU
${statusMessage.replace(/<[^>]*>/g, '')}
${renewalLink ? `\nDirect renewal link (if needed): ${renewalLink}` : ''}

${daysUntil > 30 ? `Please confirm your profile is current: ${URLS.SETTINGS}` : ''}

${needsPermitDocs ? `PERMIT ZONE DOCUMENTS REQUIRED - Email to: ${EMAIL.DOCUMENTS}` : ''}

Questions? Reply to ${EMAIL.SUPPORT}
    `.trim();

    return { subject, html, text };
  },

  /**
   * Emissions test reminder email
   */
  emissionsReminder(
    user: UserContext & { vehicleYear?: string; vehicleMake?: string; vehicleModel?: string },
    daysUntil: number,
    emissionsDate: Date,
    hasProtection: boolean
  ): { subject: string; html: string; text: string } {
    const urgency = getUrgencyLevel(daysUntil);
    const dateStr = formatDate(emissionsDate, 'long');
    const timeText = daysUntil === 0 ? 'TODAY' : daysUntil === 1 ? 'TOMORROW' : `in ${daysUntil} days`;

    const urgencyStyles: Record<string, { type: 'info' | 'success' | 'warning' | 'danger'; emoji: string }> = {
      critical: { type: 'danger', emoji: '🚨' },
      urgent: { type: 'warning', emoji: '⚠️' },
      warning: { type: 'info', emoji: '📋' },
      normal: { type: 'success', emoji: '🔔' },
    };

    const style = urgencyStyles[urgency];

    let subject: string;
    let headerText: string;
    let bodyText: string;

    switch (urgency) {
      case 'critical':
        subject = `${style.emoji} URGENT: Emissions Test Due ${daysUntil === 0 ? 'TODAY' : 'TOMORROW'}`;
        headerText = `Your Emissions Test is Due ${daysUntil === 0 ? 'TODAY' : 'TOMORROW'}!`;
        bodyText = `This is your final reminder. Without a valid emissions test, you cannot renew your license plate. Please complete your test immediately.`;
        break;
      case 'urgent':
        subject = `${style.emoji} Emissions Test Due in ${daysUntil} Days - Action Required`;
        headerText = `Emissions Test Due in ${daysUntil} Days`;
        bodyText = `Your emissions test deadline is approaching quickly. Schedule your test now to avoid delays with your license plate renewal.`;
        break;
      case 'warning':
        subject = `${style.emoji} Emissions Test Reminder - ${daysUntil} Days Left`;
        headerText = `Emissions Test Due in ${daysUntil} Days`;
        bodyText = `Don't forget - you need to complete your emissions test before you can renew your license plate. Schedule it soon to avoid the last-minute rush.`;
        break;
      default:
        subject = `${style.emoji} Emissions Test Coming Up - ${daysUntil} Days`;
        headerText = `Emissions Test Due in ${daysUntil} Days`;
        bodyText = `This is a friendly reminder that your emissions test is coming up. You have time, but it's good to plan ahead!`;
    }

    const vehicleInfo = [user.vehicleYear, user.vehicleMake, user.vehicleModel].filter(Boolean).join(' ');

    const protectionSection = hasProtection ? emailComponents.section(`
      <h3 style="color: #1e40af; margin: 0 0 8px; font-size: 16px;">Why This Matters:</h3>
      <p style="color: #1e40af; margin: 0; line-height: 1.6;">
        Illinois requires a valid emissions test before license plate renewal can be completed.
        Finishing your test early helps you avoid delays.
      </p>
    `, '#eff6ff', '#3b82f6') : '';

    const html = emailComponents.wrapper(`
      ${emailComponents.header()}
      ${emailComponents.body(`
        ${emailComponents.alertBox(style.type, headerText, bodyText)}
        <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <div style="margin-bottom: 8px;">
            <strong>Vehicle:</strong> ${vehicleInfo} (${user.licensePlate})
          </div>
          <div>
            <strong>Emissions Test Deadline:</strong> ${dateStr}
          </div>
        </div>
        <h3 style="color: #374151; margin-bottom: 12px;">How to Get Your Emissions Test:</h3>
        <ol style="color: #4b5563; line-height: 1.8; padding-left: 20px;">
          <li>Find a testing location at <a href="${URLS.EMISSIONS_LOCATOR}" style="color: #2563eb;">airteam.app</a></li>
          <li>Bring your vehicle registration</li>
          <li>The test takes about 10-15 minutes</li>
        </ol>
        ${protectionSection}
        <div style="margin-top: 24px; text-align: center;">
          ${emailComponents.button('Find Testing Locations', URLS.EMISSIONS_LOCATOR)}
        </div>
        <p style="color: #6b7280; font-size: 14px; margin-top: 24px; text-align: center;">
          Questions? Reply to this email or contact ${EMAIL.SUPPORT}
        </p>
      `)}
      ${emailComponents.footer()}
    `);

    const text = `
${BRAND.NAME} - Emissions Test Reminder

${headerText}
${bodyText}

Vehicle: ${vehicleInfo} (${user.licensePlate})
Emissions Test Deadline: ${dateStr}

How to Get Your Emissions Test:
1. Find a testing location at airteam.app
2. Bring your vehicle registration
3. The test takes about 10-15 minutes

${hasProtection ? 'Reminder: Illinois requires a valid emissions test before license plate renewal can be completed.' : ''}

Questions? ${EMAIL.SUPPORT}
    `.trim();

    return { subject, html, text };
  },

  /**
   * Sticker purchased notification
   */
  stickerPurchased(user: UserContext, purchaseDate: Date): { subject: string; html: string; text: string } {
    const expectedDelivery = new Date(purchaseDate.getTime() + 14 * 24 * 60 * 60 * 1000);

    const subject = `Great news! Your Chicago City Sticker has been purchased`;

    const html = emailComponents.wrapper(`
      ${emailComponents.header()}
      ${emailComponents.body(`
        ${emailComponents.alertBox('success', '🎉 City Sticker Purchased!', `
          Your Chicago City Sticker for <strong>${user.licensePlate}</strong> has been successfully purchased!
        `)}
        ${emailComponents.section(`
          <h3 style="color: #0c4a6e; margin: 0 0 16px; font-size: 18px;">What's Next?</h3>
          <ul style="color: #0369a1; margin: 0; padding-left: 20px; line-height: 1.8;">
            <li>Your sticker will be mailed to your address on file</li>
            <li>Expected delivery: ${formatDate(expectedDelivery, 'long')}</li>
            <li>Apply it to your windshield as soon as you receive it</li>
          </ul>
        `)}
        <p style="text-align: center; color: ${COLORS.textLight};">
          Questions? Reply to this email or contact ${EMAIL.SUPPORT}
        </p>
      `)}
      ${emailComponents.footer()}
    `);

    const text = `
${BRAND.NAME} - City Sticker Purchased!

Great news! Your Chicago City Sticker for ${user.licensePlate} has been purchased.

What's Next:
- Your sticker will be mailed to your address
- Expected delivery: ${formatDate(expectedDelivery, 'long')}
- Apply it to your windshield when you receive it

Questions? ${EMAIL.SUPPORT}
    `.trim();

    return { subject, html, text };
  },

  /**
   * Sticker delivery reminder
   */
  stickerDelivery(user: UserContext): { subject: string; html: string; text: string } {
    const subject = `Your city sticker should arrive soon!`;

    const html = emailComponents.wrapper(`
      ${emailComponents.header()}
      ${emailComponents.body(`
        ${emailComponents.alertBox('info', '📬 Check Your Mailbox!', `
          Your city sticker for <strong>${user.licensePlate}</strong> should be arriving soon.
        `)}
        <p style="color: ${COLORS.text}; line-height: 1.6;">
          Most stickers arrive within 10-14 days of purchase. If you don't receive it within the next week,
          please contact us and we'll help track it down.
        </p>
        <div style="text-align: center; margin: 24px 0;">
          ${emailComponents.button('Contact Support', `mailto:${EMAIL.SUPPORT}`)}
        </div>
      `)}
      ${emailComponents.footer()}
    `);

    const text = `
Your city sticker for ${user.licensePlate} should arrive soon!

Most stickers arrive within 10-14 days. If you don't receive it within a week, contact us at ${EMAIL.SUPPORT}.
    `.trim();

    return { subject, html, text };
  },

  /**
   * Sticker apply check
   */
  stickerApplyCheck(user: UserContext): { subject: string; html: string; text: string } {
    const subject = `Quick check - did you receive your city sticker?`;

    const html = emailComponents.wrapper(`
      ${emailComponents.header()}
      ${emailComponents.body(`
        <h2 style="color: ${COLORS.text}; margin: 0 0 16px;">Did you receive your sticker?</h2>
        <p style="color: ${COLORS.text}; line-height: 1.6; margin-bottom: 24px;">
          Your city sticker for <strong>${user.licensePlate}</strong> should have arrived by now.
          Let us know if you received it!
        </p>
        <div style="text-align: center; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
          ${emailComponents.button('✅ Yes, I received it', `${URLS.SETTINGS}?sticker_applied=yes`, 'success')}
          ${emailComponents.button('❌ No, I haven\'t', `${URLS.SETTINGS}?sticker_applied=no`, 'danger')}
        </div>
      `)}
      ${emailComponents.footer()}
    `);

    const text = `
Did you receive your city sticker for ${user.licensePlate}?

Let us know:
- Yes: ${URLS.SETTINGS}?sticker_applied=yes
- No: ${URLS.SETTINGS}?sticker_applied=no

Questions? ${EMAIL.SUPPORT}
    `.trim();

    return { subject, html, text };
  }
};

// =============================================================================
// VOICE TEMPLATES
// =============================================================================

export const voice = {
  /**
   * Generic renewal reminder voice call
   */
  renewalReminder(renewalType: RenewalType, daysUntil: number, dueDate: Date): string {
    const dueDateStr = dueDate.toLocaleDateString();
    const dayText = daysUntil === 1 ? 'day' : 'days';
    const ticketWarning = getTicketWarning(renewalType, daysUntil);

    if (renewalType === 'City Sticker' && daysUntil <= 30) {
      return `Hello from ${BRAND.NAME}. Your ${renewalType} expires in ${daysUntil} ${dayText} on ${dueDateStr}.${ticketWarning} Renew now at EZ buy dot chi city clerk dot com slash vehicle stickers.`;
    }
    if (renewalType === 'License Plate' && daysUntil <= 30) {
      return `Hello from ${BRAND.NAME}. Your ${renewalType} expires in ${daysUntil} ${dayText} on ${dueDateStr}.${ticketWarning} Renew now at I L S O S dot gov slash online renewals.`;
    }
    return `Hello from ${BRAND.NAME}. This is a reminder that your ${renewalType} expires in ${daysUntil} ${dayText} on ${dueDateStr}. Please renew promptly to avoid penalties.`;
  },

  /**
   * Emissions test voice reminder
   */
  emissionsReminder(daysUntil: number, hasProtection: boolean): string {
    const timeframe = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
    const urgentPrefix = daysUntil <= 1 ? 'This is an urgent reminder that' : 'This is a reminder that';

    if (hasProtection) {
      if (daysUntil <= 1) {
        return `Hello from ${BRAND.NAME}. ${urgentPrefix} your emissions test is due ${timeframe}. We cannot renew your license plate until you complete this test. Please visit a testing location as soon as possible.`;
      }
      return `Hello from ${BRAND.NAME}. ${urgentPrefix} your emissions test is due ${timeframe}. Please complete your test soon so we can process your license plate renewal on your behalf.`;
    } else {
      if (daysUntil <= 1) {
        return `Hello from ${BRAND.NAME}. ${urgentPrefix} your emissions test is due ${timeframe}. Without a valid emissions test, you cannot renew your license plate. Please visit a testing location as soon as possible.`;
      }
      return `Hello from ${BRAND.NAME}. ${urgentPrefix} your emissions test is due ${timeframe}. You need to complete your test before you can renew your license plate.`;
    }
  }
};
