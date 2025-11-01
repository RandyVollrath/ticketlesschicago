import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import contestKnowledge from '../../lib/ticket-contest-knowledge.json';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

interface ContestReason {
  reason: string;
  win_probability: number;
  evidence_needed: string;
  explanation: string;
}

interface ViolationData {
  violation_type: string;
  contestable_reasons: ContestReason[];
  typical_fine: number;
  contest_difficulty: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { violation_description, situation_description } = req.body;

  if (!violation_description) {
    return res.status(400).json({ error: 'Violation description is required' });
  }

  try {
    // Use OpenAI to find most relevant violation type
    const prompt = `Given this parking ticket: "${violation_description}"

Available violation types:
${contestKnowledge.map(v => `- ${v.violation_type}`).join('\n')}

Which violation type best matches? Reply with ONLY the exact violation type name, nothing else.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0
    });

    const matchedType = completion.choices[0].message.content?.trim();
    const violationData = contestKnowledge.find(v => v.violation_type === matchedType) as ViolationData | undefined;

    if (!violationData) {
      return res.status(404).json({
        error: 'Violation type not found',
        message: 'We don\'t have contest data for this violation type yet.'
      });
    }

    // If situation is provided, find best matching reason
    let recommendedReason: ContestReason | null = null;
    if (situation_description) {
      const reasonPrompt = `Given this situation: "${situation_description}"

Available contest reasons:
${violationData.contestable_reasons.map((r, i) => `${i + 1}. ${r.reason}`).join('\n')}

Which reason best matches their situation? Reply with ONLY the number (1-${violationData.contestable_reasons.length}), nothing else.`;

      const reasonCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: reasonPrompt }],
        temperature: 0
      });

      const reasonIndex = parseInt(reasonCompletion.choices[0].message.content?.trim() || '1') - 1;
      recommendedReason = violationData.contestable_reasons[reasonIndex] || violationData.contestable_reasons[0];
    }

    // Calculate potential savings
    const avgWinProbability = violationData.contestable_reasons.reduce((sum, r) => sum + r.win_probability, 0) / violationData.contestable_reasons.length;
    const expectedSavings = Math.round(violationData.typical_fine * avgWinProbability);

    return res.status(200).json({
      violation_type: violationData.violation_type,
      typical_fine: violationData.typical_fine,
      contest_difficulty: violationData.contest_difficulty,
      recommended_reason: recommendedReason,
      all_reasons: violationData.contestable_reasons,
      expected_savings: expectedSavings,
      average_win_probability: (avgWinProbability * 100).toFixed(0) + '%',
      recommendation: avgWinProbability > 0.7
        ? 'STRONGLY RECOMMEND CONTESTING - High chance of dismissal'
        : avgWinProbability > 0.5
        ? 'RECOMMEND CONTESTING - Good chance of winning'
        : 'CONSIDER CONTESTING - Moderate chance, gather strong evidence'
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
