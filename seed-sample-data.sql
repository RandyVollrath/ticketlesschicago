-- Seed sample data directly via SQL (bypasses API cache)
-- Run this in Supabase SQL Editor

-- 1. Insert sample court case outcomes
INSERT INTO court_case_outcomes (violation_code, violation_description, ticket_amount, ticket_location, ward, outcome, original_amount, final_amount, reduction_percentage, contest_grounds, evidence_submitted, attorney_represented, ticket_date, contest_filed_date, hearing_date, decision_date, days_to_decision, data_source, verified)
VALUES
  -- Street Cleaning (9-64-010) - 75% win rate
  ('9-64-010', 'Street Cleaning Violation', 60, '1500 N Clark St', '43', 'dismissed', 60, 0, 100, ARRAY['No visible signage', 'Street not actually cleaned'], '{"photos": true, "witnesses": false, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '180 days', CURRENT_DATE - INTERVAL '175 days', CURRENT_DATE - INTERVAL '165 days', CURRENT_DATE - INTERVAL '165 days', 15, 'manual', true),
  ('9-64-010', 'Street Cleaning Violation', 60, '2300 N State St', '43', 'dismissed', 60, 0, 100, ARRAY['Signs obscured by snow'], '{"photos": true, "witnesses": false, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '200 days', CURRENT_DATE - INTERVAL '195 days', CURRENT_DATE - INTERVAL '183 days', CURRENT_DATE - INTERVAL '183 days', 12, 'manual', true),
  ('9-64-010', 'Street Cleaning Violation', 60, '1800 N Michigan Ave', '2', 'reduced', 60, 30, 50, ARRAY['Vehicle moved before cleaning'], '{"photos": false, "witnesses": true, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '220 days', CURRENT_DATE - INTERVAL '215 days', CURRENT_DATE - INTERVAL '202 days', CURRENT_DATE - INTERVAL '202 days', 18, 'manual', true),
  ('9-64-010', 'Street Cleaning Violation', 60, '2100 N Wells St', '43', 'upheld', 60, 60, 0, ARRAY['Emergency situation'], '{"photos": false, "witnesses": false, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '150 days', CURRENT_DATE - INTERVAL '145 days', CURRENT_DATE - INTERVAL '130 days', CURRENT_DATE - INTERVAL '130 days', 20, 'manual', true),

  -- Residential Permit (9-64-070) - 65% win rate
  ('9-64-070', 'Residential Permit Violation', 100, '3200 N Sheffield Ave', '44', 'dismissed', 100, 0, 100, ARRAY['Valid permit displayed'], '{"photos": true, "witnesses": false, "documentation": true}'::jsonb, false, CURRENT_DATE - INTERVAL '190 days', CURRENT_DATE - INTERVAL '185 days', CURRENT_DATE - INTERVAL '180 days', CURRENT_DATE - INTERVAL '180 days', 10, 'manual', true),
  ('9-64-070', 'Residential Permit Violation', 100, '3500 N Halsted St', '44', 'dismissed', 100, 0, 100, ARRAY['Permit zone signs not posted'], '{"photos": true, "witnesses": false, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '170 days', CURRENT_DATE - INTERVAL '165 days', CURRENT_DATE - INTERVAL '156 days', CURRENT_DATE - INTERVAL '156 days', 14, 'manual', true),
  ('9-64-070', 'Residential Permit Violation', 100, '2800 N Clark St', '1', 'reduced', 100, 50, 50, ARRAY['Permit application pending'], '{"photos": false, "witnesses": false, "documentation": true}'::jsonb, false, CURRENT_DATE - INTERVAL '160 days', CURRENT_DATE - INTERVAL '155 days', CURRENT_DATE - INTERVAL '144 days', CURRENT_DATE - INTERVAL '144 days', 16, 'manual', true),
  ('9-64-070', 'Residential Permit Violation', 100, '3100 N Broadway', '44', 'upheld', 100, 100, 0, ARRAY['No permit'], '{"photos": false, "witnesses": false, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '140 days', CURRENT_DATE - INTERVAL '135 days', CURRENT_DATE - INTERVAL '118 days', CURRENT_DATE - INTERVAL '118 days', 22, 'manual', true),

  -- Expired Meter (9-64-170) - 40% win rate
  ('9-64-170', 'Expired Meter', 65, '100 N State St', '42', 'dismissed', 65, 0, 100, ARRAY['Meter malfunctioning'], '{"photos": true, "witnesses": false, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '130 days', CURRENT_DATE - INTERVAL '125 days', CURRENT_DATE - INTERVAL '117 days', CURRENT_DATE - INTERVAL '117 days', 13, 'manual', true),
  ('9-64-170', 'Expired Meter', 65, '200 E Madison St', '42', 'reduced', 65, 40, 38.5, ARRAY['Meter did not accept payment'], '{"photos": true, "witnesses": false, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '120 days', CURRENT_DATE - INTERVAL '115 days', CURRENT_DATE - INTERVAL '103 days', CURRENT_DATE - INTERVAL '103 days', 17, 'manual', true),
  ('9-64-170', 'Expired Meter', 65, '300 S Michigan Ave', '2', 'upheld', 65, 65, 0, ARRAY['Forgot to pay'], '{"photos": false, "witnesses": false, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '110 days', CURRENT_DATE - INTERVAL '105 days', CURRENT_DATE - INTERVAL '91 days', CURRENT_DATE - INTERVAL '91 days', 19, 'manual', true),
  ('9-64-170', 'Expired Meter', 65, '400 W Monroe St', '42', 'upheld', 65, 65, 0, ARRAY['Meter time expired'], '{"photos": false, "witnesses": false, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '100 days', CURRENT_DATE - INTERVAL '95 days', CURRENT_DATE - INTERVAL '79 days', CURRENT_DATE - INTERVAL '79 days', 21, 'manual', true),

  -- City Sticker (9-100-010) - 70% win rate
  ('9-100-010', 'No City Sticker', 120, '2500 N Lakeview Ave', '6', 'dismissed', 120, 0, 100, ARRAY['Non-resident vehicle'], '{"photos": false, "witnesses": false, "documentation": true}'::jsonb, false, CURRENT_DATE - INTERVAL '90 days', CURRENT_DATE - INTERVAL '85 days', CURRENT_DATE - INTERVAL '79 days', CURRENT_DATE - INTERVAL '79 days', 11, 'manual', true),
  ('9-100-010', 'No City Sticker', 120, '2700 N Pine Grove Ave', '6', 'dismissed', 120, 0, 100, ARRAY['Sticker displayed but not visible'], '{"photos": true, "witnesses": false, "documentation": true}'::jsonb, false, CURRENT_DATE - INTERVAL '80 days', CURRENT_DATE - INTERVAL '75 days', CURRENT_DATE - INTERVAL '71 days', CURRENT_DATE - INTERVAL '71 days', 9, 'manual', true),
  ('9-100-010', 'No City Sticker', 120, '3400 S Michigan Ave', '27', 'reduced', 120, 60, 50, ARRAY['Recently purchased vehicle'], '{"photos": false, "witnesses": false, "documentation": true}'::jsonb, false, CURRENT_DATE - INTERVAL '70 days', CURRENT_DATE - INTERVAL '65 days', CURRENT_DATE - INTERVAL '55 days', CURRENT_DATE - INTERVAL '55 days', 15, 'manual', true),
  ('9-100-010', 'No City Sticker', 120, '2900 N Broadway', '6', 'upheld', 120, 120, 0, ARRAY['No valid reason'], '{"photos": false, "witnesses": false, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '60 days', CURRENT_DATE - INTERVAL '55 days', CURRENT_DATE - INTERVAL '37 days', CURRENT_DATE - INTERVAL '37 days', 23, 'manual', true),

  -- Snow Route (9-64-100) - 55% win rate
  ('9-64-100', 'Snow Route Violation', 60, '1400 W Chicago Ave', '32', 'dismissed', 60, 0, 100, ARRAY['No snow route signs posted'], '{"photos": true, "witnesses": false, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '50 days', CURRENT_DATE - INTERVAL '45 days', CURRENT_DATE - INTERVAL '36 days', CURRENT_DATE - INTERVAL '36 days', 14, 'manual', true),
  ('9-64-100', 'Snow Route Violation', 60, '1600 W Division St', '32', 'reduced', 60, 30, 50, ARRAY['Snowfall less than 2 inches'], '{"photos": false, "witnesses": false, "documentation": true}'::jsonb, false, CURRENT_DATE - INTERVAL '40 days', CURRENT_DATE - INTERVAL '35 days', CURRENT_DATE - INTERVAL '24 days', CURRENT_DATE - INTERVAL '24 days', 16, 'manual', true),
  ('9-64-100', 'Snow Route Violation', 60, '2200 N Western Ave', '45', 'upheld', 60, 60, 0, ARRAY['Parked during snow ban'], '{"photos": false, "witnesses": false, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '25 days', CURRENT_DATE - INTERVAL '12 days', CURRENT_DATE - INTERVAL '12 days', 18, 'manual', true),
  ('9-64-100', 'Snow Route Violation', 60, '1800 W North Ave', '32', 'upheld', 60, 60, 0, ARRAY['Snow emergency declared'], '{"photos": false, "witnesses": false, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '20 days', CURRENT_DATE - INTERVAL '15 days', CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE - INTERVAL '5 days', 20, 'manual', true),

  -- Rush Hour (9-64-190) - 50% win rate
  ('9-64-190', 'Rush Hour Parking', 100, '100 W Adams St', '42', 'dismissed', 100, 0, 100, ARRAY['Rush hour signage not present'], '{"photos": true, "witnesses": false, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE - INTERVAL '8 days', CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE - INTERVAL '3 days', 12, 'manual', true),
  ('9-64-190', 'Rush Hour Parking', 100, '200 W Jackson Blvd', '42', 'reduced', 100, 50, 50, ARRAY['Ticket issued outside rush hour times'], '{"photos": false, "witnesses": false, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '15 days', CURRENT_DATE - INTERVAL '12 days', CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE - INTERVAL '5 days', 17, 'manual', true),
  ('9-64-190', 'Rush Hour Parking', 100, '300 S Dearborn St', '2', 'upheld', 100, 100, 0, ARRAY['Parked during rush hour'], '{"photos": false, "witnesses": false, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '25 days', CURRENT_DATE - INTERVAL '20 days', CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE - INTERVAL '6 days', 19, 'manual', true),
  ('9-64-190', 'Rush Hour Parking', 100, '400 W Monroe St', '42', 'upheld', 100, 100, 0, ARRAY['Clear violation'], '{"photos": false, "witnesses": false, "documentation": false}'::jsonb, false, CURRENT_DATE - INTERVAL '35 days', CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '14 days', CURRENT_DATE - INTERVAL '14 days', 21, 'manual', true);

-- 2. Calculate and insert win rate statistics
INSERT INTO win_rate_statistics (stat_type, stat_key, total_cases, dismissed_count, reduced_count, upheld_count, win_rate, dismissal_rate, reduction_rate, sample_size_adequate)
SELECT
  'violation_code' as stat_type,
  violation_code as stat_key,
  COUNT(*) as total_cases,
  COUNT(*) FILTER (WHERE outcome = 'dismissed') as dismissed_count,
  COUNT(*) FILTER (WHERE outcome = 'reduced') as reduced_count,
  COUNT(*) FILTER (WHERE outcome = 'upheld') as upheld_count,
  ROUND((COUNT(*) FILTER (WHERE outcome IN ('dismissed', 'reduced'))::decimal / COUNT(*) * 100), 2) as win_rate,
  ROUND((COUNT(*) FILTER (WHERE outcome = 'dismissed')::decimal / COUNT(*) * 100), 2) as dismissal_rate,
  ROUND((COUNT(*) FILTER (WHERE outcome = 'reduced')::decimal / COUNT(*) * 100), 2) as reduction_rate,
  COUNT(*) >= 30 as sample_size_adequate
FROM court_case_outcomes
GROUP BY violation_code
ON CONFLICT (stat_type, stat_key) DO UPDATE SET
  total_cases = EXCLUDED.total_cases,
  dismissed_count = EXCLUDED.dismissed_count,
  reduced_count = EXCLUDED.reduced_count,
  upheld_count = EXCLUDED.upheld_count,
  win_rate = EXCLUDED.win_rate,
  dismissal_rate = EXCLUDED.dismissal_rate,
  reduction_rate = EXCLUDED.reduction_rate,
  sample_size_adequate = EXCLUDED.sample_size_adequate,
  last_calculated = now();

-- 3. Insert sample attorneys
INSERT INTO attorneys (full_name, law_firm, email, phone, bar_number, years_experience, specializations, service_areas, accepting_cases, response_time_hours, consultation_fee, flat_fee_parking, flat_fee_traffic, pricing_model, total_cases_handled, total_cases_won, win_rate, total_reviews, average_rating, bio, verified, featured, status)
VALUES
  ('Sarah Johnson', 'Johnson & Associates', 'sarah@johnsonlaw.com', '(312) 555-0101', 'IL12345', 15, ARRAY['parking_tickets', 'traffic_violations', 'municipal_law'], ARRAY['Downtown', 'North Side', 'Loop'], true, 2, 50, 300, 500, 'flat_fee', 487, 412, 84.6, 43, 4.8, 'Experienced traffic attorney with over 15 years defending parking and traffic violations in Chicago. Former prosecutor, now dedicated to helping residents fight unfair tickets.', true, true, 'active'),
  ('Michael Chen', 'Chen Legal Group', 'michael@chenlegal.com', '(312) 555-0102', 'IL67890', 8, ARRAY['parking_tickets', 'traffic_violations'], ARRAY['South Side', 'Hyde Park', 'Bronzeville'], true, 4, 0, 250, 450, 'flat_fee', 213, 174, 81.7, 28, 4.7, 'Dedicated to providing affordable legal representation for parking and traffic violations. Free initial consultation. Serving Chicago''s South Side communities.', true, false, 'active'),
  ('Jennifer Martinez', 'Martinez Law Office', 'jennifer@martinezlaw.com', '(773) 555-0103', 'IL24680', 12, ARRAY['parking_tickets', 'municipal_law', 'administrative_hearings'], ARRAY['West Side', 'Pilsen', 'Little Village'], true, 3, 75, 350, 550, 'flat_fee', 356, 302, 84.8, 37, 4.9, 'Bilingual attorney (English/Spanish) specializing in municipal violations and administrative hearings. Known for aggressive representation and high success rates.', true, true, 'active');

-- 4. Insert attorney expertise for each attorney
DO $$
DECLARE
  attorney_rec RECORD;
  expertise_data JSONB;
BEGIN
  FOR attorney_rec IN SELECT id FROM attorneys LOOP
    INSERT INTO attorney_case_expertise (attorney_id, violation_code, cases_handled, cases_won, win_rate)
    VALUES
      (attorney_rec.id, '9-64-010', 45, 39, 86.7),
      (attorney_rec.id, '9-64-070', 32, 27, 84.4),
      (attorney_rec.id, '9-100-010', 28, 24, 85.7),
      (attorney_rec.id, '9-64-170', 18, 12, 66.7);
  END LOOP;
END $$;

-- Success message
SELECT
  'Sample data seeded successfully!' as status,
  (SELECT COUNT(*) FROM court_case_outcomes) as court_outcomes,
  (SELECT COUNT(*) FROM win_rate_statistics) as statistics,
  (SELECT COUNT(*) FROM attorneys) as attorneys,
  (SELECT COUNT(*) FROM attorney_case_expertise) as expertise_records;
