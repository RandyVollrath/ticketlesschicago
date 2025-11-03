# Video Evidence & Auto-Contest System

## Overview
Dashcam and phone video are the **best evidence** for contesting tickets. This system makes video upload easy, integrates with popular dashcam services, and provides auto-contest with deadline tracking.

---

## 🎥 Video Evidence Upload System

### Core Features

**1. Simple Upload UX**
```
┌─────────────────────────────────────────┐
│  📹 Upload Video Evidence               │
│                                          │
│  Dashcam and phone videos are the      │
│  strongest evidence for your contest.   │
│                                          │
│  [📱 Upload from Phone]                 │
│  [💾 Upload from Computer]              │
│  [☁️ Connect Dashcam Cloud Service]     │
│                                          │
│  Supported formats: MP4, MOV, AVI       │
│  Max size: 500MB per video              │
└─────────────────────────────────────────┘
```

**2. Video Processing Pipeline**
- Upload to Supabase Storage
- Generate thumbnail preview
- Extract metadata (date, time, GPS if available)
- Optional: Clip selection tool (mark relevant section)
- Compress for hearing submission

**3. Video Types**
- Dashcam footage showing incident
- Phone video of location/signage
- Phone video of street conditions
- Witness video testimony
- Vehicle repair video (equipment violations)

---

## ☁️ Dashcam Cloud Service Integration

### Supported Services

**Priority 1: Most Popular Services**

#### 1. **Nextbase** (Most popular in US)
- **API**: Nextbase Cloud API
- **Authentication**: OAuth 2.0
- **Features**:
  - Fetch videos by date/time range
  - Download specific clips
  - GPS data included
- **Integration**: Direct video import by date

#### 2. **Garmin Dash Cam** (Garmin Drive)
- **API**: Garmin Connect API
- **Authentication**: OAuth
- **Features**:
  - Cloud storage for incidents
  - GPS data and speed
  - Automatic incident detection
- **Integration**: Fetch by timestamp

#### 3. **BlackVue Cloud**
- **API**: BlackVue Cloud API
- **Authentication**: API Key
- **Features**:
  - Cloud upload for parking mode
  - GPS tracking
  - Event-triggered recording
- **Integration**: Query by location/time

#### 4. **Viofo Cloud** (Growing market)
- **API**: Limited/unofficial
- **Workaround**: Email forwarding or manual upload
- **Integration**: Phase 2

#### 5. **Thinkware Cloud**
- **API**: Thinkware Cloud Connect
- **Authentication**: OAuth
- **Features**: Auto-upload on event
- **Integration**: Phase 2

### Integration Architecture

```typescript
// pages/api/dashcam/connect.ts
interface DashcamProvider {
  provider: 'nextbase' | 'garmin' | 'blackvue' | 'viofo' | 'thinkware';
  oauth_token?: string;
  api_key?: string;
  user_id: string;
  connected_at: Date;
  auto_upload_enabled: boolean;
}

// When user connects their dashcam
POST /api/dashcam/connect
{
  "provider": "nextbase",
  "redirect_uri": "https://ticketless.vercel.app/dashcam/callback"
}

// OAuth flow → receive token → store encrypted

// Fetch videos around ticket time
POST /api/dashcam/fetch-videos
{
  "contest_id": "uuid",
  "ticket_date": "2024-03-15T14:30:00Z",
  "location": "1234 N Clark St",
  "time_range_minutes": 30  // ±30 minutes
}

// Response:
{
  "videos": [
    {
      "id": "dashcam_video_123",
      "timestamp": "2024-03-15T14:28:00Z",
      "duration_seconds": 120,
      "has_gps": true,
      "gps_location": {"lat": 41.9, "lon": -87.6},
      "download_url": "https://...",
      "thumbnail_url": "https://..."
    }
  ]
}
```

### Database Schema

```sql
-- Store dashcam connections
CREATE TABLE dashcam_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  oauth_token_encrypted TEXT, -- Encrypted with app secret
  api_key_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  auto_upload_enabled BOOLEAN DEFAULT false,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  UNIQUE(user_id, provider)
);

CREATE INDEX idx_dashcam_user ON dashcam_connections(user_id);

-- Store video evidence (extends existing system)
ALTER TABLE ticket_contests
ADD COLUMN video_evidence JSONB DEFAULT '[]'::jsonb;

-- Structure:
-- [
--   {
--     "id": "uuid",
--     "url": "https://storage.../video.mp4",
--     "thumbnail_url": "https://storage.../thumb.jpg",
--     "source": "dashcam|phone|upload",
--     "provider": "nextbase",
--     "timestamp": "2024-03-15T14:30:00Z",
--     "duration_seconds": 120,
--     "file_size": 45000000,
--     "has_gps": true,
--     "gps_location": {"lat": 41.9, "lon": -87.6},
--     "description": "Dashcam showing incident",
--     "relevant_time_start": 45,  // seconds into video
--     "relevant_time_end": 75,
--     "uploaded_at": "2024-03-20T10:00:00Z"
--   }
-- ]
```

---

## 📱 Premium: Geofencing Auto-Capture

### Concept
When user's phone detects they've parked (geofence + accelerometer), automatically capture/save dashcam footage around that time.

### User Flow

**1. Setup**
```
Enable Auto-Evidence Collection (Premium)

When your phone detects you've parked:
✓ Automatically saves last 5 minutes of dashcam
✓ Checks for nearby tickets in next 24 hours
✓ Holds footage for 30 days
✓ Auto-submits if ticket detected

[Enable Auto-Capture] - $4.99/month
```

**2. Detection Logic**
```typescript
// Mobile app or PWA with geofencing
interface ParkingEvent {
  timestamp: Date;
  location: {lat: number, lon: number};
  address: string;
  duration_minutes: number;
}

// When parking detected:
async function onParkingDetected(event: ParkingEvent) {
  // 1. Request dashcam footage for last 5 minutes
  const footage = await fetchDashcamFootage({
    timestamp: event.timestamp,
    range_minutes: 5,
    before: true
  });

  // 2. Store temporarily
  await storeTempFootage(footage, event);

  // 3. Check for tickets in next 24-48 hours
  scheduleTicketCheck(event);
}

// 24 hours later: Check if ticket issued at that location
async function checkForTicket(event: ParkingEvent) {
  const ticket = await findTicketByLocationTime(
    event.location,
    event.timestamp
  );

  if (ticket) {
    // Auto-attach footage to ticket
    await attachFootageToTicket(ticket.id, event);

    // Notify user
    await sendSMS(user.phone,
      `📹 We found dashcam footage for your ticket at ${event.address}. ` +
      `Evidence automatically attached! Contest deadline: ${ticket.deadline}`
    );
  } else {
    // No ticket - delete footage after 30 days
    scheduleFootageDeletion(event, days: 30);
  }
}
```

**3. Mobile Implementation**
- React Native app with background location
- iOS: Significant location changes + region monitoring
- Android: Geofencing API + Activity Recognition
- PWA: Geolocation API (requires app open)

---

## ⚖️ Contest Without Perfect Evidence

### Philosophy
**"File anyway - hearings are lenient"**

Many people won't have video or photos, but should still contest. Administrative hearings often consider:
- Verbal explanation of circumstances
- Timeline of events
- Weather conditions
- Street conditions
- Officer behavior
- Extenuating circumstances

### UX Changes

**Before:**
```
❌ You need photos to contest this ticket
[Upload Photos] [Cancel]
```

**After:**
```
📸 Evidence Recommendations

While photos/video improve your chances significantly,
you can still contest without perfect evidence.

✓ Photos/video (Recommended): +35% success rate
✓ Written statement: Tell your story
✓ Explanation of circumstances: Often considered

[📹 Upload Video] [📸 Upload Photos]
[✍️ Write Statement] [Contest Without Evidence]

💡 Many hearings succeed based on explanation alone,
   especially for first-time violations or unclear
   circumstances.
```

### Evidence Quality Messaging

```typescript
function getEvidenceMessage(evidenceQuality: number, violationType: string) {
  if (evidenceQuality >= 80) {
    return {
      level: 'excellent',
      message: '🎯 Excellent evidence! You have everything recommended.',
      action: null
    };
  }

  if (evidenceQuality >= 50) {
    return {
      level: 'good',
      message: '✅ Good evidence. Consider adding photos/video to strengthen your case.',
      action: 'optional_upload'
    };
  }

  if (evidenceQuality >= 20) {
    return {
      level: 'fair',
      message: '⚠️ Limited evidence. Your written statement will be important. Photos/video would significantly help.',
      action: 'recommended_upload'
    };
  }

  return {
    level: 'minimal',
    message: '📝 No physical evidence yet. You can still contest with a detailed explanation. ' +
             'Hearings often succeed based on circumstances alone. Photos/video would significantly improve chances.',
    action: 'upload_or_proceed',
    showSuccessStories: true  // Show cases that won without evidence
  };
}
```

---

## 📅 Deadline Tracking & Notification System

### Contest Deadlines

**Chicago Parking Ticket Deadlines:**
- **Contest by mail**: 21 days from ticket issue date
- **Request hearing**: 21 days from ticket issue date
- **Early payment discount**: 7 days (10% off)
- **Late payment penalty**: After 21 days (2x fine)

**Moving/Camera Ticket Deadlines:**
- **Contest**: 21 days from ticket issue date
- **Traffic court date**: Listed on ticket

### Database Schema

```sql
CREATE TABLE contest_deadlines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL REFERENCES user_tickets(id) ON DELETE CASCADE,
  contest_id UUID REFERENCES ticket_contests(id) ON DELETE SET NULL,

  -- Deadline dates
  ticket_date DATE NOT NULL,
  contest_deadline DATE NOT NULL,  -- ticket_date + 21 days
  early_payment_deadline DATE,     -- ticket_date + 7 days
  late_payment_date DATE,          -- ticket_date + 22 days

  -- Status
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending, evidence_collection, ready_to_submit, submitted, completed, missed

  -- Notifications
  reminder_sent_7days BOOLEAN DEFAULT false,
  reminder_sent_3days BOOLEAN DEFAULT false,
  reminder_sent_1day BOOLEAN DEFAULT false,
  urgent_reminder_sent BOOLEAN DEFAULT false,

  -- Evidence tracking
  has_evidence BOOLEAN DEFAULT false,
  evidence_quality_score INTEGER DEFAULT 0,
  recommended_evidence_uploaded BOOLEAN DEFAULT false,

  -- Auto-contest
  auto_contest_enabled BOOLEAN DEFAULT false,
  auto_contest_payment_captured BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deadline_user ON contest_deadlines(user_id);
CREATE INDEX idx_deadline_status ON contest_deadlines(status);
CREATE INDEX idx_deadline_date ON contest_deadlines(contest_deadline);
```

### Notification System

```typescript
// Cron job runs daily: pages/api/cron/check-contest-deadlines.ts

interface DeadlineNotification {
  user: User;
  ticket: Ticket;
  deadline: Date;
  daysRemaining: number;
  hasEvidence: boolean;
  evidenceQuality: number;
}

async function checkDeadlines() {
  const now = new Date();

  // Find tickets approaching deadline
  const { data: upcoming } = await supabase
    .from('contest_deadlines')
    .select('*, user_tickets(*), ticket_contests(*)')
    .eq('status', 'pending')
    .gte('contest_deadline', now)
    .lte('contest_deadline', addDays(now, 7));

  for (const deadline of upcoming) {
    const daysRemaining = differenceInDays(deadline.contest_deadline, now);

    // 7 days out
    if (daysRemaining === 7 && !deadline.reminder_sent_7days) {
      await sendDeadlineReminder(deadline, 7);
      await markReminderSent(deadline.id, '7days');
    }

    // 3 days out
    if (daysRemaining === 3 && !deadline.reminder_sent_3days) {
      await sendDeadlineReminder(deadline, 3);
      await markReminderSent(deadline.id, '3days');
    }

    // 1 day out - URGENT
    if (daysRemaining === 1 && !deadline.reminder_sent_1day) {
      await sendUrgentReminder(deadline);
      await markReminderSent(deadline.id, '1day');
    }
  }
}

async function sendDeadlineReminder(
  deadline: DeadlineNotification,
  daysRemaining: number
) {
  const ticket = deadline.user_tickets;
  const hasEvidence = deadline.evidence_quality_score > 20;

  // SMS notification
  const message = hasEvidence
    ? `⏰ ${daysRemaining} days left to contest your $${ticket.amount} ticket (${ticket.violation_description}). ` +
      `Your evidence is ready! Submit now: ${getContestLink(deadline.ticket_id)}`
    : `⏰ ${daysRemaining} days left to contest your $${ticket.amount} ticket (${ticket.violation_description}). ` +
      `Add evidence (recommended) or contest without it: ${getContestLink(deadline.ticket_id)}`;

  await sendSMS(deadline.user.phone, message);

  // Email notification
  await sendEmail({
    to: deadline.user.email,
    subject: `${daysRemaining} Days Left: Contest Your Chicago Ticket`,
    template: 'deadline-reminder',
    data: {
      daysRemaining,
      ticket,
      hasEvidence,
      evidenceQuality: deadline.evidence_quality_score,
      contestLink: getContestLink(deadline.ticket_id),
      evidenceLink: getEvidenceUploadLink(deadline.ticket_id)
    }
  });
}
```

### Notification Templates

**7 Days Out (Evidence Collection Phase):**
```
📸 Contest Deadline: 7 Days

Your $100 parking ticket contest is due in 7 days.

Evidence Status: Fair (40/100)
✓ Ticket photo uploaded
✗ Location photos missing (Recommended)
✗ Sign photos missing (Critical)

📹 Upload Video Evidence
📸 Add Photos
✍️ Write Statement
🚀 Contest Now

Photos increase success from 25% → 67%
Even day-late photos help!
```

**3 Days Out (Urgency Increasing):**
```
⚠️ 3 Days Left to Contest

Your $100 ticket at 1234 N Clark St

Current Evidence: Good (70/100)
✓ Location photos
✓ Sign photos
✓ Written statement

Ready to submit?
[Review & Submit Contest]

Or need more evidence:
[📹 Add Video] [📸 Add More Photos]
```

**1 Day Out (URGENT):**
```
🚨 URGENT: Last Day to Contest

Your $100 ticket deadline is TOMORROW!

Don't lose your chance - contest takes 10 minutes.

Evidence: Good (70/100) - ready to submit!

[CONTEST NOW] ← Don't miss this

Even without perfect evidence, you can still contest.
Many succeed with explanation alone.
```

---

## 🤖 Auto-Contest System

### Concept
User opts in to auto-contest with payment on file. System automatically files contest before deadline if they don't manually do it.

### User Flow

**1. Opt-In to Auto-Contest**
```
🤖 Auto-Contest Premium

Never miss a deadline again!

How it works:
1️⃣ We detect your ticket
2️⃣ We text you to upload evidence (recommended)
3️⃣ If you don't contest by 3 days before deadline,
   we automatically file for you
4️⃣ Only charged if we auto-file ($19.99)

Benefits:
✓ Never miss deadline
✓ Only pay if you forget
✓ Evidence collection reminders
✓ Best contest grounds selected automatically
✓ Professional letter generated

[Enable Auto-Contest] - $19.99 per auto-filed ticket
```

**2. Payment Setup**
```typescript
// Store payment method for auto-contest
interface AutoContestPayment {
  user_id: string;
  stripe_customer_id: string;
  stripe_payment_method_id: string;
  auto_contest_enabled: boolean;
  max_ticket_amount: number;  // Won't auto-contest above this
  notification_preferences: {
    sms: boolean;
    email: boolean;
    days_before_deadline: number[];  // [7, 3, 1]
  };
}

// When ticket detected
POST /api/auto-contest/setup
{
  "payment_method_id": "pm_...",
  "max_ticket_amount": 500,
  "enable_auto_contest": true
}
```

**3. Auto-Contest Logic**
```typescript
// Cron job: pages/api/cron/process-auto-contests.ts

async function processAutoContests() {
  const threeDaysOut = addDays(new Date(), 3);

  // Find tickets due in 3 days with auto-contest enabled
  const { data: autoContests } = await supabase
    .from('contest_deadlines')
    .select('*, user_tickets(*), users(*)')
    .eq('status', 'pending')
    .eq('auto_contest_enabled', true)
    .lte('contest_deadline', threeDaysOut);

  for (const deadline of autoContests) {
    // Check if user manually contested
    if (deadline.contest_id) {
      console.log('User manually contested, skip auto-contest');
      continue;
    }

    // Check if ticket amount within user's limit
    if (deadline.user_tickets.amount > deadline.user.max_ticket_amount) {
      await notifyAmountTooHigh(deadline);
      continue;
    }

    // Capture payment FIRST
    const payment = await captureAutoContestPayment(deadline.user_id);

    if (!payment.success) {
      await notifyPaymentFailed(deadline);
      continue;
    }

    // Create contest automatically
    const contest = await createAutoContest({
      ticket_id: deadline.ticket_id,
      user_id: deadline.user_id,
      auto_generated: true,
      evidence_quality: deadline.evidence_quality_score,
      payment_id: payment.id
    });

    // Generate letter with best available evidence
    await generateContestLetter(contest.id);

    // Submit to Chicago
    await submitContest(contest.id);

    // Notify user
    await notifyAutoContestFiled(deadline, contest, payment);
  }
}

async function createAutoContest(params) {
  const ticket = await getTicket(params.ticket_id);
  const ordinance = getOrdinanceByCode(ticket.violation_code);

  // Select best contest grounds based on available evidence
  const grounds = selectBestContestGrounds(
    ordinance,
    params.evidence_quality
  );

  return await supabase
    .from('ticket_contests')
    .insert({
      user_id: params.user_id,
      ticket_id: params.ticket_id,
      violation_code: ticket.violation_code,
      contest_grounds: grounds,
      auto_generated: true,
      auto_contest_payment_id: params.payment_id,
      status: 'submitted'
    })
    .select()
    .single();
}
```

**4. Payment Processing**
```typescript
// Stripe payment capture
async function captureAutoContestPayment(userId: string) {
  const user = await getUser(userId);

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 1999,  // $19.99
      currency: 'usd',
      customer: user.stripe_customer_id,
      payment_method: user.stripe_payment_method_id,
      off_session: true,
      confirm: true,
      description: 'Auto-Contest Service',
      metadata: {
        user_id: userId,
        service: 'auto_contest'
      }
    });

    return {
      success: true,
      id: paymentIntent.id,
      amount: paymentIntent.amount
    };
  } catch (error) {
    console.error('Payment failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
```

**5. User Notification**
```
✅ Auto-Contest Filed!

We automatically filed your contest for:
$100 Parking Ticket - Street Cleaning

Evidence Used:
✓ Ticket photo
✓ Your written statement
✗ No location photos (you didn't upload any)

Contest Grounds:
• Signage not visible
• Street not cleaned

Letter sent to: Chicago Dept of Finance
Hearing scheduled: Will notify you when set

Charged: $19.99
You saved: Missing deadline would have doubled your fine to $200!

[View Contest Details]
[Add More Evidence] ← Can still strengthen your case!
```

---

## 🔧 Implementation Plan

### Phase 1: Basic Video Upload (Week 1)
- [ ] Add video_evidence JSONB field to ticket_contests
- [ ] Video upload API with Supabase Storage
- [ ] Thumbnail generation
- [ ] Simple upload UI in TicketContester component
- [ ] Video player for review

### Phase 2: Deadline Tracking (Week 2)
- [ ] contest_deadlines table
- [ ] Cron job for deadline checks
- [ ] SMS notifications (Twilio)
- [ ] Email notifications (Resend)
- [ ] Deadline dashboard

### Phase 3: Evidence Recommendations Without Requirement (Week 2)
- [ ] Update UX to allow contest without evidence
- [ ] "Contest anyway" flow
- [ ] Success stories for minimal evidence
- [ ] Better evidence quality messaging

### Phase 4: Auto-Contest (Week 3)
- [ ] Payment method storage (Stripe)
- [ ] Auto-contest opt-in flow
- [ ] Auto-contest cron job
- [ ] Payment capture logic
- [ ] Notification templates

### Phase 5: Dashcam Integration (Week 4+)
- [ ] Nextbase API integration
- [ ] OAuth flows
- [ ] Video fetching by timestamp
- [ ] Auto-import UI

### Phase 6: Geofencing (Premium - Later)
- [ ] Mobile app with geofencing
- [ ] Parking detection logic
- [ ] Auto-footage capture
- [ ] Ticket matching algorithm

---

## 📊 Database Migrations

```sql
-- Migration 1: Video evidence
ALTER TABLE ticket_contests
ADD COLUMN IF NOT EXISTS video_evidence JSONB DEFAULT '[]'::jsonb;

-- Migration 2: Dashcam connections
-- (See schema above)

-- Migration 3: Contest deadlines
-- (See schema above)

-- Migration 4: Auto-contest settings
ALTER TABLE users
ADD COLUMN IF NOT EXISTS auto_contest_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS auto_contest_max_amount INTEGER DEFAULT 500,
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_payment_method_id TEXT;

COMMENT ON COLUMN users.auto_contest_enabled IS
'User has opted into auto-contest service ($19.99 per auto-filed contest)';
```

---

## 💰 Pricing Structure

**Free Tier:**
- Manual contest with evidence upload
- Deadline notifications (7, 3, 1 day)
- Photo evidence upload

**Premium ($4.99/month):**
- Video evidence upload (unlimited)
- Dashcam cloud service integration
- Priority evidence processing
- Advanced deadline tracking (custom reminders)

**Premium + Auto-Contest ($9.99/month + $19.99 per auto-filed ticket):**
- All Premium features
- Auto-contest service
- Payment on file
- Never miss deadline guarantee

**Geofencing (Premium add-on: +$5/month):**
- Auto-capture parking footage
- Proactive evidence collection
- Smart ticket detection
- Auto-evidence attachment

---

## 🎯 Success Metrics

**Video Evidence Impact:**
- Measure win rate with video vs without
- Track video upload rate
- Monitor evidence quality improvements

**Deadline Compliance:**
- % of users who contest before deadline
- Reduction in missed deadlines
- Notification open rates

**Auto-Contest:**
- Conversion rate (opt-in)
- Auto-contest execution rate
- User satisfaction scores
- Payment success rate

**Dashcam Integration:**
- Connection rate by provider
- Video import success rate
- Evidence quality with dashcam vs phone

This system ensures users have the best possible evidence while never missing critical deadlines!
