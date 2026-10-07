/**
 * Cloudflare Worker: LLM Decision Engine for Project Verification & Sector Alignment
 * Primary LLM: @cf/meta/llama-3-8b-instruct
 * Fallback: @cf/cloudflare/clef-flash
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

// Helper: Extract JSON from LLM text output safely
function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {}
    }
    throw new Error("Could not parse JSON from model response: " + text.slice(0, 200));
  }
}

// Helper: Extract text from URL inside Worker if needed
async function fetchAndCleanUrl(url) {
  try {
    let target = url.trim();
    if (!target.startsWith("http://") && !target.startsWith("https://")) {
      target = "https://" + target;
    }
    const resp = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    if (!resp.ok) {
      return { title: "", content: `HTTP ${resp.status}` };
    }
    const html = await resp.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";
    const cleanText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ")
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ")
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { title, content: cleanText.slice(0, 3500) };
  } catch (e) {
    return { title: "", content: "" };
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === "GET") {
      return new Response(
        JSON.stringify({
          status: "online",
          engine: "Cloudflare LLM Decision Engine",
          active_models: ["@cf/meta/llama-3-8b-instruct", "@cf/cloudflare/clef-flash"]
        }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    try {
      const body = await request.json();

      let url = body.url || body.project_url || "";
      let title = body.title || body.state?.title || "";
      let content = body.content || body.state?.content || "";
      let sector = body.matched_sector || body.state?.matched_sector || "General Infrastructure";
      let definition = body.sector_definition || body.state?.sector_definition || "Commercial and industrial operations";

      // If text context wasn't provided, fetch directly from URL
      if (!content && url) {
        const fetched = await fetchAndCleanUrl(url);
        title = title || fetched.title;
        content = fetched.content;
      }

      // =======================================================================
      // STEP 1: Execute LLM Context Evaluation & Verification
      // Model: @cf/meta/llama-3-8b-instruct
      // =======================================================================
      try {
        const systemPrompt = `You are an expert industrial project classifier and decision engine.
Analyze the provided webpage context (URL, title, content) and determine:
1. Does this describe an actual, real-world commercial/industrial project, facility development, capacity agreement (e.g. MW/GW/tons), power contract, or infrastructure construction? (NOT general gossip, movie news, generic tutorials, or e-commerce).
2. Does it align with the candidate industry sector '${sector}' (Definition: ${definition})?

Respond with STRICT JSON ONLY matching this format (no markdown fences, no extra text):
{
  "is_project": true,
  "decision": "YES",
  "matched_sector": "${sector}",
  "sector_definition": "${definition}",
  "confidence": 0.95,
  "project_summary": "1-2 sentence factual summary of the project, partner, location, and capacity.",
  "reasoning": "Clear explanation of how the project aligns with the sector."
}`;

        const userPrompt = `URL: ${url}
Title: ${title}
Candidate Sector: ${sector}
Sector Definition: ${definition}

Webpage Content:
${(title + "\n" + content).slice(0, 3000)}`;

        const aiResp = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: 512,
          temperature: 0.1
        });

        const rawText = aiResp.response || aiResp.text || JSON.stringify(aiResp);
        const parsedResult = extractJSON(rawText);

        const isProj = Boolean(parsedResult.is_project);
        const confidenceVal = typeof parsedResult.confidence === "number" ? parsedResult.confidence : (isProj ? 0.95 : 0.85);

        return new Response(
          JSON.stringify({
            success: true,
            is_project: isProj,
            decision: isProj ? "YES" : "NO",
            matched_sector: parsedResult.matched_sector || sector,
            sector_definition: parsedResult.sector_definition || definition,
            confidence: confidenceVal,
            summary: parsedResult.project_summary || parsedResult.summary || title,
            reasoning: parsedResult.reasoning || "",
            model_used: "@cf/meta/llama-3-8b-instruct",
            raw_response: parsedResult
          }),
          { status: 200, headers: CORS_HEADERS }
        );

      } catch (llmErr) {
        // =======================================================================
        // STEP 2: Secondary Fallback to Clef Decision Model
        // Model: @cf/cloudflare/clef-flash
        // =======================================================================
        const clefResult = await env.AI.run("@cf/cloudflare/clef-flash", {
          model: "clef-flash",
          state: {
            url: url,
            page_title: title,
            matched_sector: sector,
            sector_definition: definition,
            content_sample: (title + "\n" + content).slice(0, 2500)
          },
          questions: {
            is_sector_project: {
              type: "noul",
              instructions: `Determine if this webpage represents a legitimate project, deal, contract, or facility in '${sector}'.`,
              criteria: {
                true: `Real project or commercial facility deal in ${sector}.`,
                false: "Unrelated content, non-project, or entertainment."
              }
            }
          }
        });

        const answers = clefResult?.answers || clefResult || {};
        let isProj = false;
        if (typeof answers.is_sector_project === "boolean") isProj = answers.is_sector_project;
        else if (typeof answers.is_sector_project === "number") isProj = answers.is_sector_project >= 0.45;
        else if (answers.is_sector_project?.choice) isProj = answers.is_sector_project.choice === "true";

        return new Response(
          JSON.stringify({
            success: true,
            is_project: isProj,
            decision: isProj ? "YES" : "NO",
            matched_sector: sector,
            sector_definition: definition,
            confidence: isProj ? 0.92 : 0.85,
            summary: title,
            model_used: "@cf/cloudflare/clef-flash",
            raw_response: clefResult
          }),
          { status: 200, headers: CORS_HEADERS }
        );
      }

    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: err.message || "Internal server error" }),
        { status: 500, headers: CORS_HEADERS }
      );
    }
  }
};
