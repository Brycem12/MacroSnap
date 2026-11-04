export default async (request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": request.headers.get("origin") || "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Macrosnap-Access-Code",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Use POST to analyze a meal photo." }, { status: 405, headers: corsHeaders });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const accessCode = process.env.MACROSNAP_ACCESS_CODE;
  if (!apiKey) {
    return Response.json({ error: "The Gemini API key is not configured on the server yet." }, { status: 500, headers: corsHeaders });
  }
  if (accessCode && request.headers.get("x-macrosnap-access-code") !== accessCode) {
    return Response.json({ error: "Access code is missing or incorrect. Open Settings and enter your MacroSnap access code." }, { status: 401, headers: corsHeaders });
  }

  try {
    const form = await request.formData();
    const photo = form.get("photo");
    if (!photo || typeof photo.arrayBuffer !== "function") {
      return Response.json({ error: "No meal photo was received." }, { status: 400, headers: corsHeaders });
    }
    if (!photo.type?.startsWith("image/")) {
      return Response.json({ error: "Please upload an image file." }, { status: 400, headers: corsHeaders });
    }
    if (photo.size > 4 * 1024 * 1024) {
      return Response.json({ error: "Please use a photo smaller than 4 MB." }, { status: 413, headers: corsHeaders });
    }

    const bytes = Buffer.from(await photo.arrayBuffer());
    const base64 = bytes.toString("base64");
    const mimeType = photo.type || "image/jpeg";

    const prompt = `You are a careful nutrition-estimation assistant. Inspect this meal photo.
Identify visible foods and estimate realistic serving sizes in grams or common portions. Estimate total calories, protein grams, carbohydrate grams, and fat grams for the entire visible meal.
Do not claim exact accuracy. If portion size or ingredients are uncertain, make a reasonable estimate and mention the uncertainty in notes. Include likely cooking oils/sauces only when visually plausible; state assumptions.
Return only the requested JSON fields. Calories and macros must be non-negative numbers. The meal name should be short and descriptive.`;

    const schema = {
      type: "OBJECT",
      properties: {
        name: { type: "STRING" },
        calories: { type: "NUMBER" },
        proteinGrams: { type: "NUMBER" },
        carbsGrams: { type: "NUMBER" },
        fatGrams: { type: "NUMBER" },
        confidence: { type: "NUMBER" },
        notes: { type: "STRING" }
      },
      required: ["name", "calories", "proteinGrams", "carbsGrams", "fatGrams", "confidence", "notes"]
    };

    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64 } }
            ]
          }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: schema
          }
        })
      }
    );

    const payload = await geminiResponse.json();
    if (!geminiResponse.ok) {
      const detail = payload?.error?.message || "Gemini could not analyze this photo.";
      return Response.json({ error: detail }, { status: 502, headers: corsHeaders });
    }

    const text = payload?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("");
    if (!text) {
      return Response.json({ error: "Gemini returned no nutrition estimate. Try another photo." }, { status: 502, headers: corsHeaders });
    }
    const result = JSON.parse(text);
    for (const field of ["calories", "proteinGrams", "carbsGrams", "fatGrams"]) {
      if (!Number.isFinite(Number(result[field])) || Number(result[field]) < 0) {
        throw new Error("The AI returned invalid nutrition values. Please try again.");
      }
      result[field] = Number(result[field]);
    }
    result.name = String(result.name || "Meal estimate").slice(0, 100);
    result.notes = String(result.notes || "AI estimate from meal photo.").slice(0, 500);
    result.confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0.5));

    return Response.json(result, { status: 200, headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error.message || "Meal analysis failed. Please try again." }, { status: 500, headers: corsHeaders });
  }
};
