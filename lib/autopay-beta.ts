export function parseCsvEnv(value: string | undefined | null): string[] {
  return (value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

export function getAutopayBetaConfig() {
  return {
    enabled: process.env.ENABLE_CITY_AUTOPAY === '1',
    allowlistedUserIds: parseCsvEnv(process.env.AUTOPAY_BETA_USER_IDS),
    allowlistedEmails: parseCsvEnv(process.env.AUTOPAY_BETA_EMAILS).map(v => v.toLowerCase()),
    allowlistedContestLetterIds: parseCsvEnv(process.env.AUTOPAY_BETA_CONTEST_LETTER_IDS),
    allowlistedTicketIds: parseCsvEnv(process.env.AUTOPAY_BETA_TICKET_IDS),
    singleExecutionContestLetterId: process.env.AUTOPAY_SINGLE_EXECUTION_CONTEST_LETTER_ID?.trim() || null,
    alertsTo: parseCsvEnv(process.env.AUTOPAY_ALERT_EMAILS || process.env.ADMIN_EMAIL || 'randy@autopilotamerica.com'),
  };
}

export function isAutopayBetaAllowed(params: {
  userId: string;
  userEmail?: string | null;
  contestLetterId: string;
  ticketId: string;
}): {
  allowed: boolean;
  reason: string;
} {
  const config = getAutopayBetaConfig();

  if (config.singleExecutionContestLetterId && config.singleExecutionContestLetterId !== params.contestLetterId) {
    return { allowed: false, reason: 'Single-execution guardrail enabled for a different contest letter' };
  }

  if (config.allowlistedContestLetterIds.includes(params.contestLetterId)) {
    return { allowed: true, reason: 'Contest letter is allowlisted' };
  }

  if (config.allowlistedTicketIds.includes(params.ticketId)) {
    return { allowed: true, reason: 'Ticket is allowlisted' };
  }

  if (config.allowlistedUserIds.includes(params.userId)) {
    return { allowed: true, reason: 'User ID is allowlisted' };
  }

  const normalizedEmail = (params.userEmail || '').toLowerCase();
  if (normalizedEmail && config.allowlistedEmails.includes(normalizedEmail)) {
    return { allowed: true, reason: 'User email is allowlisted' };
  }

  return { allowed: false, reason: 'User/ticket/contest letter is not in autopay beta allowlist' };
}
