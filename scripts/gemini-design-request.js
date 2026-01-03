const https = require('https');

const GEMINI_API_KEY = "AIzaSyBwPsbev7qiSY4t9VpiCc9mzdagXtmMc4M";

const currentLandingPageCode = `// Current Landing Page - pages/index.tsx
// Uses COLORS object with primary: '#0066FF', green: '#00C853', etc.
// Sections: Nav, Hero with badge, How it works (4 cards), Dismissal rates, Pricing card, FAQ accordion, CTA, Footer
// Current hero: "Stop Paying Unfair Chicago Parking Tickets" with stats 1.2M+ tickets, 54% dismissal, $24/year
`;

const currentProfilePageCode = `// Current Profile Page - pages/profile.tsx
// Uses DashboardLayout wrapper
// Sections: Header with subscription badge, Setup warning, Name fields (required), License plate input,
// Expandable sections: Mailing Address, Letter Preferences with toggles, Notifications, Subscription info
// Color scheme: primary blue, success green, warning amber, danger red
`;

const prompt = `I need you to redesign two pages for my product "Autopilot America" - a service that automatically monitors Chicago license plates for parking tickets and contests them by mail.

**Product Vibe:**
- Takes a frustrating, bureaucratic problem (parking tickets) and makes it completely hands-off
- "Set it and forget it" automation - user adds plate, we handle everything
- Data-driven confidence: 1.2M tickets analyzed, 54% average dismissal rate
- Affordable protection: $24/year for unlimited contest letters
- Feels like having a personal assistant fighting city hall for you
- Should feel empowering, like you're fighting back against unfair fines
- Relief and peace of mind - this stressful thing is now handled

**Target User:**
- Chicago drivers tired of unexpected tickets
- People who've had tickets dismissed but never took the time to contest
- Busy professionals who value automation and peace of mind

**Current Design Problems:**
- Too generic/corporate looking - needs more personality
- Doesn't convey the "relief" and "empowerment" feeling
- Landing page doesn't create urgency or emotional connection
- Profile page is functional but uninspiring

**Design Constraints:**
- Must work on mobile and desktop
- React with inline styles (no Tailwind, no external CSS files)
- Keep the same functionality/sections, just redesign the look
- Must be production-ready code

---

**PAGE 1: Landing Page**

Current sections to keep:
1. Navigation (logo, links, auth buttons)
2. Hero with headline, subheadline, CTA, social proof stats
3. How it works (4 steps with icons)
4. Dismissal rates by ticket type (progress bars)
5. Pricing ($24/year single plan)
6. FAQ accordion
7. Final CTA section
8. Footer

**PAGE 2: Profile/Settings Page**

Current sections to keep:
1. Header with subscription status badge
2. Setup progress warning (shown if profile incomplete)
3. Name fields (first/last) - REQUIRED, always visible
4. License plate input with state dropdown - REQUIRED, always visible
5. Mailing address (expandable section)
6. Letter preferences - auto-mail toggles, ticket type checkboxes (expandable)
7. Notifications - email toggles (expandable)
8. Subscription info display (expandable)

---

**REDESIGN REQUEST:**

Create a bold, confident design that:

1. **Reflects the emotional value:**
   - Relief from ticket stress
   - Fighting back against unfair city fines
   - Satisfaction of automation handling bureaucracy
   - Peace of mind that you're protected

2. **Uses modern design principles:**
   - Clear visual hierarchy with bold typography
   - Generous whitespace
   - Subtle depth with shadows
   - Mobile-first responsive considerations
   - Accessible color contrast (WCAG AA)

3. **Creates urgency and trust:**
   - Prominent social proof
   - Trust indicators
   - Compelling CTAs that drive action
   - Data visualization that builds confidence

4. **Has distinct personality:**
   - NOT generic SaaS blue
   - Bold, confident color choices
   - Maybe slight irreverence toward city bureaucracy
   - Could use gradients, interesting typography, or visual motifs
   - Think: Premium automation service, not boring government form

**PROVIDE:**

1. **Color Palette** - Complete hex codes for:
   - Primary and secondary colors
   - Background colors
   - Text colors (heading, body, muted)
   - Success, warning, danger states
   - Accent/highlight colors

2. **Typography** - Recommendations for:
   - Heading font (Google Fonts preferred)
   - Body font
   - Font sizes and weights for hierarchy

3. **Complete React Code** for BOTH pages:
   - Full pages/index.tsx with all inline styles
   - Full pages/profile.tsx with all inline styles
   - Include the COLORS constant at top
   - Include all icons as inline SVGs
   - Include responsive considerations

Make this design memorable. Think about successful "autopilot" product designs - the feeling of something running smoothly in the background while you can relax.`;

const requestBody = JSON.stringify({
  contents: [{
    parts: [{
      text: prompt
    }]
  }],
  generationConfig: {
    temperature: 0.9,
    topK: 64,
    topP: 0.95,
    maxOutputTokens: 65536,
  }
});

const options = {
  hostname: 'generativelanguage.googleapis.com',
  path: `/v1beta/models/gemini-3-pro-preview:generateContent?key=${GEMINI_API_KEY}`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  }
};

console.log('Calling Gemini 2.5 Pro for design recommendations...\n');

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      if (response.candidates && response.candidates[0]?.content?.parts) {
        const text = response.candidates[0].content.parts.map(p => p.text).join('\n');
        console.log(text);
      } else if (response.error) {
        console.error('API Error:', response.error.message);
      } else {
        console.log('Full response:', JSON.stringify(response, null, 2));
      }
    } catch (e) {
      console.error('Parse error:', e.message);
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

req.write(requestBody);
req.end();
