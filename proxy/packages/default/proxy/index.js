const https = require('https');

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { reject(new Error(`JSON parse failed: ${raw}`)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main(args) {
  if (args.__ow_method === 'options') {
    return { statusCode: 204, body: '' };
  }

  let model, toolName, toolDescription;
  try {
    if (args.__ow_body) {
      const decoded = Buffer.from(args.__ow_body, 'base64').toString();
      const parsed = JSON.parse(decoded);
      ({ model, toolName, toolDescription } = parsed);
    } else {
      ({ model, toolName, toolDescription } = args);
    }
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body', detail: e.message }) };
  }

  if (!model || !toolName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing model or toolName' }) };
  }

  const SYSTEM_PROMPT = `You are evaluating tools for use in a professional brand consultancy workflow.
Brand agencies work across strategy, client management, visual design, copywriting, research, and production.
Evaluate tools for their genuine usefulness within this broad workflow — not only for visual design tasks.
Be specific and accurate. Only evaluate tools you have reliable knowledge of.
If your knowledge of a tool is limited or uncertain, say so explicitly in each description.
Do not fabricate scores. Return only valid JSON.`;

  const userPrompt = `Evaluate the tool "${toolName}" for use in a professional brand consultancy.
${toolDescription ? `Context provided: "${toolDescription}"\n` : ''}
Step 1 — Classify this tool's primary category:
"image_generation" | "workflow_productivity" | "coding_assistant" | "research_writing" | "client_communication" | "design_production" | "other"

Step 2 — Score it for brand agency usefulness, judged relative to what a tool in that category can realistically offer.
If your knowledge is limited, prefix each description with "Limited knowledge:" and note uncertainties.

Return ONLY this JSON, no other text:
{
  "confidence": "high" | "low",
  "category": "image_generation" | "workflow_productivity" | "coding_assistant" | "research_writing" | "client_communication" | "design_production" | "other",
  "outputQuality": { "score": 0.0, "description": "..." },
  "control":       { "score": 0.0, "description": "..." },
  "speed":         { "score": 0.0, "description": "..." },
  "reliability":   { "score": 0.0, "description": "..." }
}

Score each criterion on a 0.0–10.0 scale (one decimal place).
Reference points: 0.0 = completely useless, 5.0 = mediocre, 8.0 = very good, 10.0 = best-in-class.
When knowledge is limited, default to 5.0, not 0.0.`;

  try {
    let resultText;

    if (model === 'gemini') {
      const key = process.env.GEMINI_KEY;
      const res = await httpsPost(
        'generativelanguage.googleapis.com',
        `/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        { 'Content-Type': 'application/json' },
        {
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: userPrompt }] }]
        }
      );
      resultText = res.body.candidates?.[0]?.content?.parts?.[0]?.text;

    } else if (model === 'claude') {
      const key = process.env.CLAUDE_KEY;
      const res = await httpsPost(
        'api.anthropic.com',
        '/v1/messages',
        { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        { model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userPrompt }] }
      );
      resultText = res.body.content?.[0]?.text;

    } else if (model === 'deepseek') {
      const key = process.env.DEEPSEEK_KEY;
      const res = await httpsPost(
        'api.deepseek.com',
        '/chat/completions',
        { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        { model: 'deepseek-chat', messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }] }
      );
      resultText = res.body.choices?.[0]?.message?.content;

    } else {
      return { statusCode: 400, body: JSON.stringify({ error: `Unknown model: ${model}` }) };
    }

    const match = resultText?.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`No JSON in response: ${resultText}`);
    const parsed = JSON.parse(match[0]);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
}

module.exports = { main };
