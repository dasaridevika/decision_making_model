/**
 * Cloudflare Worker: Clef & LLM Project Decision Engine
 * 
 * Integrated Models:
 * 1. @cf/meta/llama-3-8b-instruct    -> Generative LLM for context evaluation & entity summarization
 * 2. @cf/cloudflare/clef-flash       -> Clef Decision Model for structured decision verification
 * 3. @cf/cloudflare/clef             -> Multimodal Clef Model for image-based project analysis
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

// Universal Parser for Clef boolean/noul decision answers
function parseBoolAnswer(ans) {
  if (ans === undefined || ans === null) return false;
  if (typeof ans === "boolean") return ans;
  if (typeof ans === "number") return ans >= 0.40;
  if (typeof ans === "string") {
    const s = ans.trim().toLowerCase();
    return s === "true" || s === "yes" || s === "1";
  }
  if (typeof ans === "object") {
    if (typeof ans.value === "boolean") return ans.value;
    if (typeof ans.value === "number") return ans.value >= 0.40;
    if (typeof ans.value === "string") return ans.value.toLowerCase() === "true" || ans.value.toLowerCase() === "yes";
    if (typeof ans.choice === "string") return ans.choice.toLowerCase() === "true" || ans.choice.toLowerCase() === "yes";
    if (typeof ans.answer === "string") return ans.answer.toLowerCase() === "true" || ans.answer.toLowerCase() === "yes";
    if (typeof ans.result === "string") return ans.result.toLowerCase() === "true" || ans.result.toLowerCase() === "yes";
    if (typeof ans.result === "boolean") return ans.result;
    if (typeof ans.confidence === "number") return ans.confidence >= 0.40;
  }
  return false;
}

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
    return {};
  }
}

// Extract clean text from URL
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
          engine: "Cloudflare Clef & LLM Project Decision System",
          models: ["@cf/cloudflare/clef-flash", "@cf/cloudflare/clef", "@cf/meta/llama-3-8b-instruct"]
        }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    try {
      const body = await request.json();

      let url = body.url || body.project_url || "";
      let title = body.title || body.state?.title || "";
      let content = body.content || body.state?.content || "";
      let sector = body.matched_sector || body.state?.matched_sector || "General Industry";
      let definition = body.sector_definition || body.state?.sector_definition || "Commercial and industrial operations";
      let images = body.images || [];

      if (!url && !content) {
        return new Response(
          JSON.stringify({ error: "Missing project URL or content payload." }),
          { status: 400, headers: CORS_HEADERS }
        );
      }

      // Fetch webpage content if not provided
      if (!content && url) {
        const fetched = await fetchAndCleanUrl(url);
        title = title || fetched.title;
        content = fetched.content;
      }

      // -----------------------------------------------------------------------
      // 1. LLM Context Evaluation (@cf/meta/llama-3-8b-instruct)
      // -----------------------------------------------------------------------
      let llmIsProject = false;
      let llmSummary = "";
      try {
        const llmPrompt = `Analyze the following webpage context. Determine if it describes a real-world commercial/industrial project, facility build, power agreement (e.g. MW/GW), or infrastructure contract in the '${sector}' sector.
Title: ${title}
Content: ${content.slice(0, 2000)}

Respond in valid JSON only:
{"is_project": true, "summary": "1 sentence summary"}`;

        const llmResp = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          prompt: llmPrompt,
          max_tokens: 150,
          temperature: 0.1
        });

        const raw = llmResp.response || llmResp.text || "";
        const parsed = extractJSON(raw);
        llmIsProject = Boolean(parsed.is_project === true || parsed.is_project === "true" || parsed.is_project === "YES" || parsed.decision === "YES");
        llmSummary = parsed.summary || "";
      } catch (e) {
        llmSummary = title;
      }

      // -----------------------------------------------------------------------
      // 2. Clef Decision Evaluation (@cf/cloudflare/clef-flash / @cf/cloudflare/clef)
      // -----------------------------------------------------------------------
      const selectedClef = images.length > 0 ? "@cf/cloudflare/clef" : "@cf/cloudflare/clef-flash";
      const clefModelName = selectedClef.includes("clef-flash") ? "clef-flash" : "clef";

      let clefIsProject = false;
      let clefResult = {};
      try {
        clefResult = await env.AI.run(selectedClef, {
          model: clefModelName,
          state: {
            url: url,
            title: title,
            sector: sector,
            definition: definition,
            summary: llmSummary,
            content: (title + "\n" + content).slice(0, 2500)
          },
          questions: {
            is_project: {
              type: "noul",
              instructions: `Determine if this webpage represents a legitimate real project, deal, contract, or facility in '${sector}' (Definition: ${definition}).`,
              criteria: {
                true: `Real project, deal, capacity agreement, or facility development in ${sector}.`,
                false: "Unrelated content, celebrity news, personal blog, or non-project."
              }
            }
          },
          images: images
        });

        const answers = clefResult?.answers || clefResult || {};
        clefIsProject = parseBoolAnswer(answers.is_project);
      } catch (e) {}

      // Final decision: Verified if Clef or LLM identifies the sector project
      const finalIsProject = clefIsProject || llmIsProject;

      return new Response(
        JSON.stringify({
          success: true,
          decision: finalIsProject ? "YES" : "NO",
          is_project: finalIsProject,
          matched_sector: finalIsProject ? sector : null,
          sector_definition: finalIsProject ? definition : null,
          confidence: finalIsProject ? 0.95 : 0.85,
          title: title || "Project Analysis",
          summary: llmSummary || title,
          models_used: {
            context_evaluator: "@cf/meta/llama-3-8b-instruct",
            decision_engine: selectedClef
          },
          raw_decision: clefResult
        }),
        { status: 200, headers: CORS_HEADERS }
      );

    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: err.message || "Internal server error" }),
        { status: 500, headers: CORS_HEADERS }
      );
    }
  }
};
