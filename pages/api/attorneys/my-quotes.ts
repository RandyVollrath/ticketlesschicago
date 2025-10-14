import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Get user from auth
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if user is an attorney
    const { data: attorney, error: attorneyError } = await supabase
      .from('attorneys')
      .select('id')
      .eq('email', user.email)
      .single();

    if (attorneyError || !attorney) {
      return res.status(403).json({ error: 'Not registered as an attorney' });
    }

    if (req.method === 'GET') {
      // Get all quote requests for this attorney
      const { status } = req.query;

      let query = supabase
        .from('attorney_quote_requests')
        .select('*')
        .eq('attorney_id', attorney.id)
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      const { data: quotes, error: quotesError } = await query;

      if (quotesError) {
        console.error('Error fetching quotes:', quotesError);
        return res.status(500).json({ error: 'Failed to fetch quotes' });
      }

      res.status(200).json({
        success: true,
        quotes: quotes || []
      });

    } else if (req.method === 'PATCH') {
      // Update quote request (respond to quote)
      const { quoteId, status, responseMessage, quoteAmount, estimatedDuration } = req.body;

      if (!quoteId) {
        return res.status(400).json({ error: 'Quote ID required' });
      }

      // Verify this quote belongs to this attorney
      const { data: quote, error: verifyError } = await supabase
        .from('attorney_quote_requests')
        .select('*')
        .eq('id', quoteId)
        .eq('attorney_id', attorney.id)
        .single();

      if (verifyError || !quote) {
        return res.status(404).json({ error: 'Quote not found' });
      }

      const updateData: any = {};
      if (status) updateData.status = status;
      if (responseMessage !== undefined) updateData.attorney_response = responseMessage;
      if (quoteAmount !== undefined) updateData.quote_amount = quoteAmount;
      if (estimatedDuration !== undefined) updateData.estimated_duration = estimatedDuration;
      if (status === 'responded' || status === 'accepted') {
        updateData.responded_at = new Date().toISOString();
      }

      const { data: updatedQuote, error: updateError } = await supabase
        .from('attorney_quote_requests')
        .update(updateData)
        .eq('id', quoteId)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating quote:', updateError);
        return res.status(500).json({ error: 'Failed to update quote' });
      }

      // TODO: Send email notification to user about attorney response

      res.status(200).json({
        success: true,
        quote: updatedQuote
      });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error: any) {
    console.error('Attorney quotes error:', error);
    res.status(500).json({ error: error.message });
  }
}
