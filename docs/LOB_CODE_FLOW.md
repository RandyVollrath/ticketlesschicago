# Lob Integration - Complete Code Flow

## File Structure

```
pages/
├── api/
│   ├── admin/autopilot/
│   │   └── upload-results.ts          ← Entry point: VA uploads CSV
│   └── cron/
│       ├── autopilot-generate-letters.ts  ← Letter generation (separate)
│       └── autopilot-mail-letters.ts      ← Main mailing cron
lib/
└── lob-service.ts                     ← Lob API integration
```

---

## 1. Entry Point: upload-results.ts

**Endpoint**: `POST /api/admin/autopilot/upload-results`

### Execution Flow

```typescript
handler(req: NextApiRequest, res: NextApiResponse) {
  // 1. Parse uploaded CSV file
  const form = formidable({ maxFileSize: 10MB })
  const [fields, files] = form.parse(req)
  const file = files.file[0]
  const content = fs.readFileSync(file.filepath, 'utf-8')
  
  // 2. Parse CSV content
  const tickets = parseCSV(content)
  // Returns: Array<ParsedTicket>
  //   - Only rows with ticket_number filled
  //   - Normalized violation_type
  
  // 3. For each ticket
  for (const ticket of tickets) {
    // 3a. Verify monitored plate exists
    const plate = await supabase
      .from('monitored_plates')
      .select('id, user_id')
      .eq('plate', ticket.plate.toUpperCase())
      .eq('state', ticket.state.toUpperCase())
      .eq('status', 'active')
      .single()
    
    if (!plate) continue  // Skip if no active plate
    
    // 3b. Check for duplicate ticket
    const existingTicket = await supabase
      .from('detected_tickets')
      .select('id')
      .eq('ticket_number', ticket.ticket_number)
      .single()
    
    if (existingTicket) continue  // Skip if already exists
    
    // 3c. Create ticket record
    const newTicket = await supabase
      .from('detected_tickets')
      .insert({
        user_id: plate.user_id,
        plate_id: plate.id,
        ticket_number: ticket.ticket_number,
        violation_type: normalizeViolationType(ticket.violation_type),
        status: 'pending_evidence',
        evidence_deadline: NOW + 72 hours,
        source: 'va_upload',
        // ... other fields
      })
    
    // 3d. Generate letter
    const template = DEFENSE_TEMPLATES[ticket.violation_type]
    const letterContent = generateLetterContent(
      ticketData,
      userProfile,
      template
    )
    
    await supabase
      .from('contest_letters')
      .insert({
        ticket_id: newTicket.id,
        user_id: plate.user_id,
        letter_content: letterContent,
        letter_text: letterContent,
        defense_type: template.type,
        status: 'pending_evidence',
      })
    
    // 3e. Send evidence request email
    const emailSent = await sendTicketDetectedEmail(
      userEmail,
      userName,
      ticket.ticket_number,
      violationType,
      violationDate,
      amount,
      location,
      plate,
      evidenceDeadline
    )
    
    // 3f. Log to audit
    await supabase
      .from('ticket_audit_log')
      .insert({
        ticket_id: newTicket.id,
        user_id: plate.user_id,
        action: 'ticket_detected',
        details: { evidence_deadline, email_sent: !!userEmail },
        performed_by: 'va_upload',
      })
  }
  
  // 4. Log VA upload record
  await supabase.from('va_uploads').insert({
    original_filename: file.originalFilename,
    row_count: tickets.length,
    tickets_created: results.ticketsCreated,
    letters_generated: results.lettersGenerated,
    errors: results.errors.length > 0 ? results.errors : null,
    status: results.ticketsCreated > 0 ? 'complete' : 'no_tickets',
  })
  
  // 5. Send admin notification if issues
  await sendAdminUploadNotification(
    file.originalFilename,
    results
  )
  
  return res.status(200).json(results)
}
```

---

## 2. Letter Mailing: autopilot-mail-letters.ts

**Endpoint**: `GET /api/cron/autopilot-mail-letters`
**Trigger**: Vercel cron (daily at 3:00 PM UTC)

### Execution Flow

```typescript
handler(req: NextApiRequest, res: NextApiResponse) {
  // 1. Verify authorization
  const isVercelCron = req.headers['x-vercel-cron'] === '1'
  const isAuthorized = authHeader === `Bearer ${CRON_SECRET}`
  
  if (!isVercelCron && !isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  
  // 2. Check LOB_API_KEY configured
  if (!process.env.LOB_API_KEY) {
    return res.status(500).json({
      success: false,
      error: 'Lob API key not configured'
    })
  }
  
  // 3. Check kill switches
  const killSwitches = await supabase
    .from('autopilot_admin_settings')
    .select('key, value')
    .in('key', ['pause_all_mail', 'pause_ticket_processing'])
  
  for (const setting of killSwitches || []) {
    if (setting.key === 'pause_all_mail' && setting.value?.enabled) {
      return res.status(200).json({
        success: true,
        message: 'Kill switch active: mailing disabled',
        skipped: true
      })
    }
  }
  
  // 4. Get ALL letters with mailable statuses
  const letters = await supabase
    .from('contest_letters')
    .select(`
      id, ticket_id, user_id, letter_content, letter_text, defense_type,
      detected_tickets!inner(
        id, ticket_number, status, evidence_deadline, is_test
      )
    `)
    .or(`status.eq.pending_evidence,status.eq.approved,status.eq.draft`)
    .order('created_at', { ascending: true })
    .limit(20)  // Process in batches
  
  // 5. Filter to ready letters
  const readyLetters = letters.filter(letter => {
    const ticket = letter.detected_tickets
    if (!ticket) return false
    
    // Skip test tickets
    if (ticket.is_test) {
      console.log(`Skipping test ticket ${ticket.ticket_number}`)
      return false
    }
    
    // Only mail if evidence deadline has passed
    if (ticket.evidence_deadline) {
      const deadline = new Date(ticket.evidence_deadline)
      if (deadline <= new Date()) {
        return true
      }
    }
    
    return false
  })
  
  if (readyLetters.length === 0) {
    return res.status(200).json({
      success: true,
      message: 'No letters ready (waiting for evidence deadlines)',
      lettersMailed: 0,
      pendingEvidence: letters.length
    })
  }
  
  // 6. Process each ready letter
  let lettersMailed = 0
  let errors = 0
  
  for (const letter of readyLetters) {
    // 6a. Get user profile for mailing address
    const profile = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', letter.user_id)
      .single()
    
    if (!profile || !profile.mailing_address) {
      console.log(`Skipping letter: Missing profile/address`)
      errors++
      continue
    }
    
    // 6b. Build sender info
    if (!profile.full_name) {
      profile.full_name = `${profile.first_name || ''} ${profile.last_name || ''}`
      .trim()
    }
    
    // 6c. Mail letter
    const result = await mailLetter(
      letter,
      profile,
      letter.detected_tickets.ticket_number
    )
    
    if (result.success) {
      lettersMailed++
      
      // 6d. Send letter mailed notification email
      await sendLetterMailedNotification(
        letter.user_id,
        letter.detected_tickets.ticket_number,
        result.expectedDelivery || null,
        result.pdfUrl || null
      )
      
      // 6e. Increment letter count
      const countResult = await incrementLetterCount(letter.user_id)
      if (countResult.exceeded) {
        console.log(`User exceeded included letters (${countResult.count})`)
        // TODO: Charge for additional letter via Stripe
      }
    } else {
      errors++
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  return res.status(200).json({
    success: true,
    lettersMailed,
    errors,
    timestamp: new Date().toISOString()
  })
}

// Helper: Mail a single letter
async function mailLetter(
  letter: LetterToMail,
  profile: UserProfile,
  ticketNumber: string
): Promise<{ success: boolean; lobId?: string; expectedDelivery?: string; ... }> {
  try {
    // 1. Build sender address
    const senderName = profile.full_name ||
      `${profile.first_name || ''} ${profile.last_name || ''}`.trim() ||
      'Vehicle Owner'
    
    const fromAddress = {
      name: senderName,
      address: profile.mailing_address,
      city: profile.mailing_city,
      state: profile.mailing_state,
      zip: profile.mailing_zip,
    }
    
    // 2. Get letter content
    const letterText = letter.letter_content || letter.letter_text
    if (!letterText) {
      throw new Error('No letter content found')
    }
    
    // 3. Format as HTML
    const htmlContent = formatLetterAsHTML(letterText)
    
    // 4. Send via Lob
    const result = await sendLetter({
      from: fromAddress,
      to: CHICAGO_PARKING_CONTEST_ADDRESS,
      letterContent: htmlContent,
      description: `Contest letter for ticket ${ticketNumber}`,
      metadata: {
        ticket_id: letter.ticket_id,
        letter_id: letter.id,
        user_id: letter.user_id,
      },
    })
    
    // 5. Update letter record
    await supabase
      .from('contest_letters')
      .update({
        status: 'mailed',
        lob_letter_id: result.id,
        letter_pdf_url: result.url,
        tracking_number: result.tracking_number || null,
        mailed_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
      })
      .eq('id', letter.id)
    
    // 6. Update ticket status
    await supabase
      .from('detected_tickets')
      .update({ status: 'mailed' })
      .eq('id', letter.ticket_id)
    
    // 7. Log to audit
    await supabase
      .from('ticket_audit_log')
      .insert({
        ticket_id: letter.ticket_id,
        user_id: letter.user_id,
        action: 'letter_mailed',
        details: {
          lob_letter_id: result.id,
          tracking_number: result.tracking_number,
          expected_delivery: result.expected_delivery_date,
        },
        performed_by: 'autopilot_cron',
      })
    
    return {
      success: true,
      lobId: result.id,
      expectedDelivery: result.expected_delivery_date || null,
      pdfUrl: result.url || null,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Error mailing letter: ${errorMessage}`)
    
    // Update letter status to failed
    await supabase
      .from('contest_letters')
      .update({ status: 'failed' })
      .eq('id', letter.id)
    
    // Log error
    await supabase
      .from('ticket_audit_log')
      .insert({
        ticket_id: letter.ticket_id,
        user_id: letter.user_id,
        action: 'letter_mail_failed',
        details: { error: errorMessage },
        performed_by: 'autopilot_cron',
      })
    
    return { success: false, error: errorMessage }
  }
}

// Helper: Send letter mailed notification email
async function sendLetterMailedNotification(
  userId: string,
  ticketNumber: string,
  expectedDeliveryDate: string | null,
  pdfUrl: string | null
): Promise<void> {
  // Get user settings
  const settings = await supabase
    .from('autopilot_settings')
    .select('email_on_letter_sent')
    .eq('user_id', userId)
    .single()
  
  // Default to true if setting doesn't exist
  if (settings && settings.email_on_letter_sent === false) {
    console.log(`User has email_on_letter_sent disabled, skipping`)
    return
  }
  
  // Get user email and profile
  const userData = await supabase.auth.admin.getUserById(userId)
  if (!userData?.user?.email) {
    console.log(`User has no email, skipping notification`)
    return
  }
  
  const profile = await supabase
    .from('user_profiles')
    .select('first_name')
    .eq('user_id', userId)
    .single()
  
  const firstName = profile?.first_name || 'there'
  const email = userData.user.email
  
  // Format expected delivery date
  let deliveryText = ''
  if (expectedDeliveryDate) {
    const deliveryDate = new Date(expectedDeliveryDate)
    deliveryText = deliveryDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }
  
  // Build HTML email
  const html = `... (professional email template) ...`
  
  // Send via Resend
  const response = await resend.emails.send({
    from: 'Autopilot America <alerts@autopilotamerica.com>',
    to: [email],
    subject: `✉️ Contest Letter Mailed - Ticket #${ticketNumber}`,
    html,
  })
  
  console.log(`Sent letter mailed notification to ${email}`)
}

// Helper: Increment letter count
async function incrementLetterCount(userId: string): Promise<{ exceeded: boolean; count: number }> {
  const sub = await supabase
    .from('autopilot_subscriptions')
    .select('letters_used_this_period, letters_included')
    .eq('user_id', userId)
    .single()
  
  if (!sub) {
    return { exceeded: false, count: 0 }
  }
  
  const newCount = (sub.letters_used_this_period || 0) + 1
  
  await supabase
    .from('autopilot_subscriptions')
    .update({ letters_used_this_period: newCount })
    .eq('user_id', userId)
  
  return {
    exceeded: newCount > (sub.letters_included || 1),
    count: newCount,
  }
}
```

---

## 3. Lob Service: lob-service.ts

**Purpose**: Lob.com API integration

### Execution Flow

```typescript
/**
 * Send letter via Lob.com
 * from = User's address (appears as sender)
 * to = City department (recipient)
 */
export async function sendLetter(params: SendLetterParams): Promise<LobMailResponse> {
  const { from, to, letterContent, description, metadata } = params
  
  // 1. Check API key configured
  if (!process.env.LOB_API_KEY) {
    throw new Error('LOB_API_KEY not configured')
  }
  
  // 2. Prepare authentication
  const lobApiKey = process.env.LOB_API_KEY
  const authHeader = 'Basic ' + Buffer.from(lobApiKey + ':').toString('base64')
  
  // 3. Make API request
  const response = await fetch('https://api.lob.com/v1/letters', {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      description: description || 'Contest letter mailing',
      
      // Recipient (City of Chicago)
      to: {
        name: to.name,
        address_line1: to.address,
        address_city: to.city,
        address_state: to.state,
        address_zip: to.zip,
        address_country: 'US'
      },
      
      // Sender (User)
      from: {
        name: from.name,
        address_line1: from.address,
        address_city: from.city,
        address_state: from.state,
        address_zip: from.zip,
        address_country: 'US'
      },
      
      // Letter content and settings
      file: letterContent,        // HTML string
      color: false,               // B&W printing (cheaper)
      double_sided: false,        // Single-sided
      metadata: metadata || {}
    })
  })
  
  // 4. Handle response
  if (!response.ok) {
    const errorData = await response.json()
    console.error('Lob API error:', errorData)
    throw new Error(`Lob API error: ${errorData.error?.message || 'Unknown error'}`)
  }
  
  // 5. Parse and return response
  const data = await response.json()
  
  return {
    id: data.id,
    url: data.url,
    tracking_number: data.tracking_number,
    expected_delivery_date: data.expected_delivery_date
  }
}

/**
 * Convert plain text letter to HTML format for Lob
 */
export function formatLetterAsHTML(letterText: string, signatureImage?: string): string {
  // 1. Escape HTML entities
  const escaped = letterText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  
  // 2. Convert line breaks
  const withBreaks = escaped.replace(/\n/g, '<br>')
  
  // 3. Add signature if provided
  const signatureHTML = signatureImage
    ? `<div style="margin-top: 30px;">
         <p style="margin-bottom: 10px;">Signature:</p>
         <img src="${signatureImage}" alt="Signature" style="max-width: 300px;" />
       </div>`
    : ''
  
  // 4. Return full HTML
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: Arial, sans-serif;
      font-size: 12pt;
      line-height: 1.5;
      margin: 1in;
    }
  </style>
</head>
<body>
  ${withBreaks}
  ${signatureHTML}
</body>
</html>
  `.trim()
}
```

---

## Key Constants & Configuration

### Chicago Mailing Address (Target)

```typescript
const CHICAGO_PARKING_CONTEST_ADDRESS = {
  name: 'City of Chicago - Department of Finance',
  address: 'PO Box 88292',
  city: 'Chicago',
  state: 'IL',
  zip: '60680-1292'
}
```

### Defense Templates (By Violation Type)

```typescript
const DEFENSE_TEMPLATES: Record<string, { type: string; template: string }> = {
  expired_plates: {
    type: 'registration_renewed',
    template: `I am writing to contest parking ticket #{ticket_number}...`
  },
  no_city_sticker: {
    type: 'sticker_purchased',
    template: `I am writing to contest parking ticket #{ticket_number}...`
  },
  // ... more templates
  other_unknown: {
    type: 'general_contest',
    template: `I am writing to contest parking ticket #{ticket_number}...`
  }
}
```

---

## Database State Changes

### After CSV Upload

```
detected_tickets:
  id: [generated UUID]
  ticket_number: [from CSV]
  status: 'pending_evidence'
  evidence_deadline: NOW + 72 hours
  is_test: false
  source: 'va_upload'

contest_letters:
  id: [generated UUID]
  ticket_id: [reference to detected_tickets.id]
  status: 'pending_evidence'
  letter_content: [generated from template]
  defense_type: [from template]

ticket_audit_log:
  action: 'ticket_detected'
  performed_by: 'va_upload'
```

### After Mailing

```
contest_letters:
  status: 'mailed'
  lob_letter_id: [from Lob response]
  letter_pdf_url: [from Lob response]
  tracking_number: [from Lob response]
  mailed_at: NOW
  sent_at: NOW

detected_tickets:
  status: 'mailed'

ticket_audit_log:
  action: 'letter_mailed'
  details: { lob_letter_id, tracking_number, expected_delivery }
  performed_by: 'autopilot_cron'

autopilot_subscriptions:
  letters_used_this_period: [incremented]
```

---

## Error Handling Patterns

### In upload-results.ts

```typescript
try {
  // Process ticket
} catch (err: any) {
  results.errors.push(`Error processing ${ticket.ticket_number}: ${err.message}`)
  // Continue processing next ticket
}

// After all tickets:
if (results.errors.length > 0) {
  await sendAdminUploadNotification(filename, results)
}
```

### In autopilot-mail-letters.ts

```typescript
try {
  const result = await sendLetter(...)
  
  if (result.success) {
    lettersMailed++
    // Update database
  } else {
    errors++
  }
} catch (error) {
  // Letter status → 'failed'
  // Audit log with error
  errors++
  // Continue with next letter
}

return res.status(200).json({
  success: true,
  lettersMailed,
  errors  // Count of failures
})
```

---

## Environment Variables Required

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://[project].supabase.co
SUPABASE_SERVICE_ROLE_KEY=[secret key]

# Lob.com
LOB_API_KEY=[lob api key]

# Email
RESEND_API_KEY=[resend api key]

# Security
CRON_SECRET=[secret for cron verification]
```

---

## Testing Notes

### To prevent real mailing during testing:

1. **Set is_test = true on detected_tickets** (most granular)
   ```sql
   UPDATE detected_tickets SET is_test = true WHERE ...
   ```

2. **Enable pause_all_mail kill switch** (entire system)
   ```sql
   INSERT INTO autopilot_admin_settings
   VALUES ('pause_all_mail', { "enabled": true })
   ```

3. **Don't set evidence_deadline** (manual approach)
   ```sql
   UPDATE detected_tickets SET evidence_deadline = NULL WHERE ...
   ```

### To verify mailing works:

```sql
-- Check letter was created
SELECT * FROM contest_letters
WHERE ticket_id = '[ticket_id]'

-- Check Lob letter ID was set
SELECT status, lob_letter_id, letter_pdf_url, mailed_at
FROM contest_letters
WHERE ticket_id = '[ticket_id]'

-- Check audit trail
SELECT * FROM ticket_audit_log
WHERE ticket_id = '[ticket_id]'
AND action = 'letter_mailed'

-- Check subscription count
SELECT letters_used_this_period, letters_included
FROM autopilot_subscriptions
WHERE user_id = '[user_id]'
```

