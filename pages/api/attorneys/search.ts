import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      violationCode,
      specialization,
      minWinRate,
      maxPrice,
      serviceArea,
      sortBy = 'win_rate', // 'win_rate', 'price', 'rating', 'experience'
      acceptingCases = 'true'
    } = req.query;

    // Build query
    let query = supabase
      .from('attorneys')
      .select(`
        *,
        attorney_case_expertise(
          violation_code,
          cases_handled,
          win_rate
        )
      `)
      .eq('status', 'active');

    // Filter by accepting cases
    if (acceptingCases === 'true') {
      query = query.eq('accepting_cases', true);
    }

    // Filter by minimum win rate
    if (minWinRate) {
      query = query.gte('win_rate', parseFloat(minWinRate as string));
    }

    // Filter by max price (flat fee for parking)
    if (maxPrice) {
      query = query.lte('flat_fee_parking', parseFloat(maxPrice as string));
    }

    // Execute query
    const { data: attorneys, error: fetchError } = await query;

    if (fetchError) {
      console.error('Fetch error:', fetchError);
      return res.status(500).json({ error: sanitizeErrorMessage(fetchError) });
    }

    let results = attorneys || [];

    // Post-query filtering (for complex conditions)

    // Filter by specialization
    if (specialization) {
      results = results.filter(a =>
        a.specializations?.includes(specialization as string)
      );
    }

    // Filter by service area
    if (serviceArea) {
      results = results.filter(a =>
        a.service_areas?.includes(serviceArea as string)
      );
    }

    // Filter by violation code expertise
    if (violationCode) {
      results = results.map(attorney => {
        const expertise = attorney.attorney_case_expertise?.find(
          (e: any) => e.violation_code === violationCode
        );

        return {
          ...attorney,
          relevant_expertise: expertise || null,
          relevance_score: expertise ? expertise.win_rate * expertise.cases_handled : 0
        };
      }).filter(a => a.relevance_score > 0);
    }

    // Sorting
    switch (sortBy) {
      case 'win_rate':
        results.sort((a, b) => (b.win_rate || 0) - (a.win_rate || 0));
        break;
      case 'price':
        results.sort((a, b) => (a.flat_fee_parking || 999999) - (b.flat_fee_parking || 999999));
        break;
      case 'rating':
        results.sort((a, b) => (b.average_rating || 0) - (a.average_rating || 0));
        break;
      case 'experience':
        results.sort((a, b) => (b.years_experience || 0) - (a.years_experience || 0));
        break;
      case 'relevance':
        if (violationCode) {
          results.sort((a: any, b: any) => (b.relevance_score || 0) - (a.relevance_score || 0));
        }
        break;
      default:
        results.sort((a, b) => (b.win_rate || 0) - (a.win_rate || 0));
    }

    // Add recommendation badges
    results = results.map((attorney: any) => {
      const badges = [];

      if (attorney.verified) {
        badges.push('verified');
      }

      if (attorney.featured) {
        badges.push('featured');
      }

      if (attorney.win_rate && attorney.win_rate >= 80) {
        badges.push('high_win_rate');
      }

      if (attorney.total_reviews >= 10 && attorney.average_rating >= 4.5) {
        badges.push('highly_rated');
      }

      if (attorney.response_time_hours && attorney.response_time_hours <= 2) {
        badges.push('fast_response');
      }

      if (attorney.years_experience && attorney.years_experience >= 10) {
        badges.push('experienced');
      }

      return {
        ...attorney,
        badges
      };
    });

    res.status(200).json({
      success: true,
      count: results.length,
      attorneys: results
    });

  } catch (error: any) {
    console.error('Attorney search error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
