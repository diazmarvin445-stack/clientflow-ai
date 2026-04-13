# ClientFlow AI Functions

## generateCampaign

HTTP Cloud Function that securely calls OpenAI and returns a structured campaign JSON.

### Required secrets

Set secrets before deploy:

```bash
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set ALLOWED_ORIGINS
```

- `OPENAI_API_KEY`: OpenAI server key.
- `ALLOWED_ORIGINS`: comma-separated allowed origins (example: `https://clientflow-ai-7eb08.web.app,http://localhost:5000`).

### Deploy

```bash
cd functions
npm install
firebase deploy --only functions:generateCampaign
```

### Request payload (POST)

```json
{
  "businessType": "Landscaping",
  "services": ["Lawn care", "Tree trimming"],
  "location": "Miami, FL",
  "audience": "Homeowners 30-60",
  "branding": "Premium, reliable, fast response",
  "budget": 450,
  "campaignGoal": "Generate qualified leads"
}
```

### Response shape

```json
{
  "headline": "",
  "description": "",
  "cta": "",
  "recommendedPlatform": "",
  "recommendedBudget": "",
  "strategy": "",
  "visualIdeas": [],
  "photoSuggestions": [],
  "videoSuggestions": [],
  "estimatedLeads": "",
  "estimatedReach": ""
}
```

The function validates required inputs, sanitizes AI output, and returns:
- `400` for invalid payload
- `502` for AI/provider failures
- `500` for server configuration issues
