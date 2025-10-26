# Court Records Scraper & Attorney Marketplace

## Overview
Complete system for analyzing court outcomes, calculating win probabilities, and connecting users with traffic attorneys.

---

## System 1: Court Records & Analytics

### Database Schema

#### `court_case_outcomes` Table
Stores historical parking ticket contest outcomes for building predictive models.

**Fields:**
- Case identification (case_number, ticket_number)
- Violation details (code, description, amount)
- Location data (ticket_location, ward, court_location)
- Outcome (dismissed, reduced, upheld, withdrawn, pending)
- Financial data (original_amount, final_amount, reduction_percentage)
- Contest details (grounds, defense_strategy, evidence_submitted, attorney_represented)
- Temporal data (ticket_date, contest_filed_date, hearing_date, decision_date)
- Judicial info (judge_name, hearing_officer_name)
- Metadata (data_source, verified)

**Purpose:** Historical data to improve win probability calculations

#### `win_rate_statistics` Table
Materialized view for fast analytics queries.

**Dimensions Tracked:**
- `violation_code` - Win rates by specific violations
- `ward` - Geographic patterns
- `judge` - Judge-specific outcomes
- `contest_ground` - Success rate by reason
- `month` - Seasonal trends
- `evidence_type` - Impact of different evidence

**Statistics:**
- Total cases, dismissed/reduced/upheld counts
- Win rate, dismissal rate, reduction rate
- Average reduction percentage
- Average days to decision
- Sample size adequacy flag (>= 30 cases)

### Enhanced Win Probability API

**Endpoint:** `POST /api/court-data/win-probability-enhanced`

**Improvements Over Basic Calculator:**
1. **Historical Data Integration** - Uses actual court outcomes when available
2. **Location-Based Adjustments** - Ward-specific win rates
3. **Judicial Patterns** - Judge-specific outcomes (if available)
4. **Seasonal Trends** - Month-by-month variations
5. **Evidence Impact** - Real data on what evidence works
6. **Contest Ground Effectiveness** - Which grounds actually win

**Algorithm:**
```javascript
1. Start with base probability from court records (if available)
   - Falls back to ordinance database if < 30 cases
2. Add evidence modifiers:
   - Photos: +10%
   - Witnesses: +8%
   - Documentation: +7%
3. Add contest ground modifiers:
   - No grounds: -15%
   - 3+ grounds: +5%
   - Strong ground (>60% success rate): +12%
4. Add temporal modifier:
   - Filed within 7 days: +3%
   - Filed after 60 days: -5%
5. Add location modifier (if data available):
   - Ward-specific adjustment (±5-15%)
6. Add seasonal modifier (if data available):
   - Month-specific adjustment (±3-10%)
7. Cap at 5-95%
```

**Response:**
```json
{
  "probability": 67,
  "baseProbability": 55,
  "dataSource": "court_records",
  "confidence": "very_high",
  "sampleSize": 142,
  "recommendation": "Strong Case - High likelihood of success",
  "recommendationColor": "#10b981",
  "suggestions": ["Add photos", "File within 7 days"],
  "modifiers": {
    "photos": 10,
    "ward_specific": 2,
    "...": "..."
  },
  "ordinanceInfo": {
    "code": "9-64-010",
    "title": "Street Cleaning",
    "category": "parking"
  }
}
```

---

## System 2: Attorney Marketplace

### Database Schema

#### `attorneys` Table
Attorney profiles and performance metrics.

**Fields:**
- Basic info (name, firm, email, phone, bar_number)
- Professional (years_experience, specializations, service_areas)
- Availability (accepting_cases, response_time_hours)
- Pricing (consultation_fee, flat_fee_parking, hourly_rate, pricing_model)
- Performance (total_cases_handled, win_rate, avg_reduction_percentage)
- Reviews (total_reviews, average_rating)
- Profile (bio, photos, website, linkedin)
- Platform status (verified, featured, status)

#### `attorney_case_expertise` Table
Tracks attorney performance by specific violation codes.

**Purpose:** Show attorneys' experience with specific violations

**Fields:**
- attorney_id, violation_code
- cases_handled, cases_won, win_rate

#### `attorney_reviews` Table
Client reviews and ratings.

**Fields:**
- Rating (1-5 stars overall)
- Specific ratings (communication, professionalism, value)
- Review text
- Case outcome
- Would recommend (boolean)
- Verification status

#### `attorney_quote_requests` Table
Tracks quote requests from users to attorneys.

**Workflow:**
1. User submits request
2. Attorney receives email notification
3. Attorney views request and provides quote
4. User accepts/declines quote
5. System tracks response times for attorney ratings

---

## Attorney Search API

**Endpoint:** `GET /api/attorneys/search`

**Query Parameters:**
- `violationCode` - Find attorneys with this expertise
- `specialization` - Filter by specialty
- `minWinRate` - Minimum win percentage
- `maxPrice` - Maximum flat fee
- `serviceArea` - Geographic filter
- `sortBy` - win_rate, price, rating, experience, relevance
- `acceptingCases` - Boolean (default: true)

**Features:**
- Relevance scoring (violation-specific experience × win rate)
- Badge system (verified, featured, high_win_rate, etc.)
- Multi-dimensional sorting
- Smart filtering

**Response:**
```json
{
  "success": true,
  "count": 15,
  "attorneys": [
    {
      "id": "uuid",
      "full_name": "Jane Smith",
      "law_firm": "Smith & Associates",
      "win_rate": 85,
      "flat_fee_parking": 350,
      "average_rating": 4.8,
      "total_reviews": 47,
      "years_experience": 12,
      "badges": ["verified", "high_win_rate", "fast_response"],
      "relevant_expertise": {
        "violation_code": "9-64-010",
        "cases_handled": 156,
        "win_rate": 88
      }
    }
  ]
}
```

---

## Quote Request System

**Endpoint:** `POST /api/attorneys/request-quote`

**Flow:**
1. User submits quote request with case details
2. Creates `attorney_quote_requests` record
3. Sends email to attorney with:
   - Client details
   - Case information
   - Link to attorney dashboard
4. Sends confirmation email to user
5. Tracks response time for attorney ratings

**Email Notifications:**
- Attorney notification (with client info & case details)
- User confirmation (with attorney info & expected response time)
- Automatic reminders if attorney doesn't respond in 24h

---

## Attorney Marketplace Page

**Route:** `/attorneys`

### Features:
1. **Search & Filter Bar**
   - Violation code search
   - Min win rate slider
   - Max price input
   - Sort dropdown (win rate, price, rating, experience, relevance)

2. **Attorney Cards**
   - Name, firm, photo
   - Badge display (verified, featured, experienced, etc.)
   - Key stats (win rate, price, rating, cases handled)
   - Bio preview
   - "Request Quote" button

3. **Quote Request Modal**
   - Violation code
   - Ticket amount
   - Case description
   - Urgency level
   - Preferred contact method
   - Real-time form validation

4. **Responsive Design**
   - Mobile-optimized
   - Touch-friendly
   - Fast loading

### Badge System:
- ✓ **Verified** - Identity verified by platform
- ⭐ **Featured** - Premium attorney
- 🏆 **High Win Rate** - >= 80% success
- ⭐ **Highly Rated** - >= 4.5 stars with 10+ reviews
- ⚡ **Fast Response** - Responds within 2 hours
- 👨‍⚖️ **Experienced** - 10+ years practice

---

## Settings Integration

Added to Settings page between "Contest Ticket" and "Reimbursement":

```
👨‍⚖️ Find an Attorney
Browse experienced attorneys who specialize in contesting tickets
[Browse Attorneys]
```

Purple button (#8b5cf6) for visual distinction

---

## Data Population Strategy

### Initial Setup (No Court Data):
- System uses ordinance database win probabilities
- Shows "low confidence" indicator
- Encourages users to report outcomes

### Phase 1: Manual Entry
Create admin interface to manually enter outcomes from:
- Public court records
- User-reported outcomes
- Attorney-reported outcomes

### Phase 2: Web Scraping
Develop scrapers for:
- Chicago court case search
- FOIA requests for bulk data
- Public hearing schedules

### Phase 3: Continuous Learning
- Users report their outcomes
- Attorneys provide case data
- Automated updates to statistics tables
- Monthly recalculation of win rates

---

## Sample Data Entry Script

```sql
-- Example: Add court outcome data
INSERT INTO court_case_outcomes (
  ticket_number,
  violation_code,
  violation_description,
  ticket_amount,
  ticket_location,
  ward,
  outcome,
  original_amount,
  final_amount,
  reduction_percentage,
  contest_grounds,
  evidence_submitted,
  attorney_represented,
  ticket_date,
  contest_filed_date,
  hearing_date,
  decision_date,
  data_source,
  verified
) VALUES (
  'CHI123456',
  '9-64-010',
  'Street Cleaning Violation',
  60.00,
  '1500 N Clark St',
  '43',
  'dismissed',
  60.00,
  0.00,
  100.00,
  ARRAY['No visible signage', 'Street not actually cleaned'],
  '{"photos": true, "witnesses": false, "documentation": true}'::jsonb,
  false,
  '2024-01-15',
  '2024-01-20',
  '2024-02-10',
  '2024-02-10',
  'manual',
  true
);

-- Recalculate statistics
INSERT INTO win_rate_statistics (
  stat_type,
  stat_key,
  total_cases,
  dismissed_count,
  reduced_count,
  upheld_count,
  win_rate,
  dismissal_rate,
  reduction_rate,
  sample_size_adequate
) VALUES (
  'violation_code',
  '9-64-010',
  100,
  45,
  30,
  25,
  75.00,
  45.00,
  30.00,
  true
) ON CONFLICT (stat_type, stat_key) DO UPDATE SET
  total_cases = EXCLUDED.total_cases,
  dismissed_count = EXCLUDED.dismissed_count,
  win_rate = EXCLUDED.win_rate,
  last_calculated = now();
```

---

## Future Enhancements

### Court Records System:
1. **Automated Scraping**
   - Build scrapers for Chicago court records
   - FOIA requests for historical data
   - Real-time monitoring of new cases

2. **Advanced Analytics**
   - Judge-specific patterns
   - Time-of-day effects
   - Weather correlation (snow tickets)
   - Hearing officer patterns

3. **Machine Learning**
   - Train ML model on historical data
   - Predict outcomes with >80% accuracy
   - Factor in judge, location, time, weather

### Attorney Marketplace:
1. **Attorney Dashboard**
   - View quote requests
   - Respond to quotes
   - Track cases
   - View analytics

2. **Messaging System**
   - In-platform messaging
   - Document sharing
   - Case updates

3. **Payment Integration**
   - Book and pay through platform
   - Escrow service
   - Automatic invoicing

4. **Attorney Verification**
   - Bar association API integration
   - Case outcome verification
   - Client verification

---

## Files Created

### Database:
```
database/migrations/create_court_records_and_attorneys.sql
```

### APIs:
```
pages/api/court-data/win-probability-enhanced.ts
pages/api/attorneys/search.ts
pages/api/attorneys/request-quote.ts
```

### Pages:
```
pages/attorneys.tsx
```

### Modified:
```
pages/settings.tsx - Added attorney marketplace link
```

---

## Testing Checklist

- [ ] Run database migrations
- [ ] Add sample attorney data
- [ ] Test attorney search with filters
- [ ] Test quote request flow
- [ ] Verify email notifications work
- [ ] Test enhanced win probability API
- [ ] Add sample court outcome data
- [ ] Verify statistics calculations
- [ ] Test on mobile
- [ ] Verify all RLS policies work

---

## Cost Estimates

### Database Storage:
- Court records: ~1GB per 50,000 cases
- Attorney profiles: Minimal (<<1GB)
- **Cost: ~$0.02/GB/month**

### Email Notifications:
- Resend: Free tier (100 emails/day)
- Paid: $20/month for 10,000 emails
- **Cost: $0-20/month**

### Total: **~$20-25/month** at scale

---

## Success Metrics

### Court Records System:
- Number of outcomes tracked
- Data freshness (days since last update)
- Prediction accuracy vs actual outcomes
- User-reported outcome rate

### Attorney Marketplace:
- Active attorneys
- Quote requests per week
- Attorney response time
- Conversion rate (quote → hire)
- User satisfaction ratings

---

## Admin Tasks

### To Activate:
1. Run SQL migration
2. Add sample attorney profiles
3. Add initial court outcome data (even if just 10-20 cases)
4. Calculate initial statistics
5. Test quote request flow

### Ongoing:
1. Add new court outcomes (weekly/monthly)
2. Recalculate statistics
3. Verify attorney profiles
4. Monitor response times
5. Handle user reports/disputes
