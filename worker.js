/**
 * Cloudflare Worker: Multi-Model Project & Sector Alignment Decision Engine
 * 
 * Integrated Models:
 * 1. @cf/meta/llama-3-8b-instruct    -> Generative LLM for in-depth text context evaluation & entity extraction
 * 2. @cf/cloudflare/clef-flash       -> Fast Clef Decision Model for strict YES/NO binary decision
 * 3. @cf/cloudflare/clef             -> Multimodal Clef Decision Model for image & complex multi-modal evaluation
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
  if (typeof ans === "number") return ans >= 0.45;
  if (typeof ans === "string") {
    const s = ans.trim().toLowerCase();
    return s === "true" || s === "yes" || s === "1";
  }
  if (typeof ans === "object") {
    if (typeof ans.value === "boolean") return ans.value;
    if (typeof ans.value === "number") return ans.value >= 0.45;
    if (typeof ans.value === "string") return ans.value.toLowerCase() === "true" || ans.value.toLowerCase() === "yes";
    if (typeof ans.choice === "string") return ans.choice.toLowerCase() === "true" || ans.choice.toLowerCase() === "yes";
    if (typeof ans.answer === "string") return ans.answer.toLowerCase() === "true" || ans.answer.toLowerCase() === "yes";
    if (typeof ans.result === "string") return ans.result.toLowerCase() === "true" || ans.result.toLowerCase() === "yes";
    if (typeof ans.result === "boolean") return ans.result;
    if (typeof ans.confidence === "number") return ans.confidence >= 0.45;
  }
  return false;
}

// Helper: Extract clean text from URL using standard Browser User-Agent header
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
          models: {
            llm: "@cf/meta/llama-3-8b-instruct",
            clef_flash: "@cf/cloudflare/clef-flash",
            clef_multimodal: "@cf/cloudflare/clef"
          }
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

      // If webpage text is not provided, fetch and extract visible HTML text
      if (!content && url) {
        const fetched = await fetchAndCleanUrl(url);
        title = title || fetched.title;
        content = fetched.content;
      }

      // -----------------------------------------------------------------------
      // STAGE 1: LLM Context Evaluation (@cf/meta/llama-3-8b-instruct)
      // Evaluates text context, extracts project activities, and summarizes key scope
      // -----------------------------------------------------------------------
      let evaluatedSummary = "";
      try {
        const llmPrompt = `Analyze the following webpage text. In 1-2 concise sentences, summarize whether this describes a real-world commercial/industrial project, facility build, deal, or capacity expansion in the sector '${sector}':
Title: ${title}
Content: ${content.slice(0, 2000)}`;

        const llmResponse = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          prompt: llmPrompt,
          max_tokens: 150,
          temperature: 0.1
        });
        evaluatedSummary = llmResponse.response || llmResponse.text || "";
      } catch (e) {
        evaluatedSummary = title || "Webpage context extracted for evaluation.";
      }

      // -----------------------------------------------------------------------
      // STAGE 2: Clef Decision Engine
      // Model selection:
      // - @cf/cloudflare/clef (Multimodal) when images are present
      // - @cf/cloudflare/clef-flash (Fast) for text-only decision evaluation
      // -----------------------------------------------------------------------
      const selectedClefModel = images.length > 0 ? "@cf/cloudflare/clef" : "@cf/cloudflare/clef-flash";
      const clefModelName = selectedClefModel.includes("clef-flash") ? "clef-flash" : "clef";

      const clefQuestions = {
        is_project: {
          type: "noul",
          instructions: `Determine whether the webpage content represents a real-world commercial/industrial project, facility development, capacity deal (e.g. MW/GW/tons), power contract, or infrastructure construction in the '${sector}' sector (Definition: ${definition}).`,
          criteria: {
            true: `The text explicitly describes a real project, facility, capacity deal, power agreement, construction, or operational development related to the ${sector} sector.`,
            false: "The text is an unrelated article, entertainment news, personal blog, general discussion, or does not describe a real sector project."
          }
        }
      };

      const clefResponse = await env.AI.run(selectedClefModel, {
        model: clefModelName,
        state: {
          url: url,
          title: title,
          sector: sector,
          definition: definition,
          llm_evaluated_summary: evaluatedSummary,
          webpage_content: (title + "\n" + content).slice(0, 2500)
        },
        questions: clefQuestions,
        images: images
      });

      const answers = clefResponse?.answers || clefResponse || {};
      const isProject = parseBoolAnswer(answers.is_project);

      // Return unified decision response
      return new Response(
        JSON.stringify({
          success: true,
          decision: isProject ? "YES" : "NO",
          is_project: isProject,
          matched_sector: isProject ? sector : null,
          sector_definition: isProject ? definition : null,
          confidence: isProject ? 0.95 : 0.85,
          title: title || "Project Analysis",
          summary: evaluatedSummary || title,
          models_used: {
            context_evaluator: "@cf/meta/llama-3-8b-instruct",
            decision_engine: selectedClefModel
          },
          raw_decision: clefResponse
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
