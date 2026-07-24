javascript
// Netlify serverless function — keeps the Anthropic API key server-side only.
// The API key is read from an environment variable (set in Netlify dashboard),
// never from the frontend code.

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server not configured — missing API key" }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { mode, text, imageBase64, mediaType } = body;

    let content;
    if (mode === "image") {
      if (!imageBase64) {
        return { statusCode: 400, body: JSON.stringify({ error: "No image provided" }) };
      }
      content = [
        {
          type: "image",
          source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageBase64 },
        },
        {
          type: "text",
          text: `Identify the food(s) in this photo and estimate total macros for the visible portion(s). Use reasonable serving-size assumptions based on what's visible. Respond ONLY with a JSON object, no markdown fences, no preamble, in exactly this shape:
{"name": "short label for what's in the photo", "protein": number_grams, "carbs": number_grams, "fat": number_grams, "fiber": number_grams, "kcal": number}
If you cannot identify any food in the image, respond with {"error": "reason"}.`,
        },
      ];
    } else {
      if (!text || !text.trim()) {
        return { statusCode: 400, body: JSON.stringify({ error: "No food description provided" }) };
      }
      content = `Estimate macros for this food/meal description: "${text.trim()}". Use standard nutrition data and reasonable portion assumptions if amounts aren't specified (assume a typical single serving). Respond ONLY with a JSON object, no markdown fences, no preamble, in exactly this shape:
{"name": "short clean label for this food", "protein": number_grams, "carbs": number_grams, "fat": number_grams, "fiber": number_grams, "kcal": number}
If the input isn't a real food or is too vague to estimate, respond with {"error": "reason"}.`;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        messages: [{ role: "user", content }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const msg = (data && data.error && data.error.message) || `HTTP ${response.status}`;
      return { statusCode: response.status, body: JSON.stringify({ error: msg }) };
    }

    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      return { statusCode: 500, body: JSON.stringify({ error: "Empty response from model" }) };
    }

    let clean = textBlock.text.replace(/```json|```/g, "").trim();
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1) {
      return { statusCode: 500, body: JSON.stringify({ error: "No JSON in model response" }) };
    }
    clean = clean.slice(firstBrace, lastBrace + 1);

    const parsed = JSON.parse(clean);
    return { statusCode: 200, body: JSON.stringify(parsed) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || "Unknown error" }) };
  }
};
