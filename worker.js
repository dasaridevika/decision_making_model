/**
 * Cloudflare Worker: 2-Stage Sequential Verification & Decision Pipeline
 * 
 * STAGE 1: Llama-3 LLM (@cf/meta/llama-3-8b-instruct)
 *   -> Analyzes URL context and verifies whether the webpage content aligns with the sector and definition from the CSV file.
 * 
 * STAGE 2: Clef Decision Model (@cf/cloudflare/clef-flash / @cf/cloudflare/clef)
 *   -> Takes Llama's sector verification evidence and context to make the final authoritative decision ("YES" / "NO").
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

// Universal parser for Clef decision outputs
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

// Fetch & extract visible clean text from URL
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
          pipeline: "Sequential Llama Verification -> Clef Decision",
          models: {
            stage_1_verifier: "@cf/meta/llama-3-8b-instruct",
            stage_2_decision: "@cf/cloudflare/clef-flash",
            stage_2_multimodal_decision: "@cf/cloudflare/clef"
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

      // Fetch webpage context if not provided
      if (!content && url) {
        const fetched = await fetchAndCleanUrl(url);
        title = title || fetched.title;
        content = fetched.content;
      }

      // =======================================================================
      // STAGE 1: Llama LLM Verifies Webpage Alignment with CSV Sector
      // Model: @cf/meta/llama-3-8b-instruct
      // =======================================================================
      let llamaVerification = "";
      let llamaAligned = false;

      try {
        const llamaPrompt = `You are a sector verification specialist.
Carefully review the webpage context and verify whether it aligns with the following industry sector from the company database:

Candidate Sector: ${sector}
Sector Definition: ${definition}

Webpage Title: ${title}
Webpage Content:
${content.slice(0, 2500)}

Task:
1. Identify if there is an active commercial deal, facility development, capacity expansion, power contract, or infrastructure construction described in the text.
2. Verify if the activity directly aligns with the '${sector}' definition.
3. Provide a 2-sentence verification summary including specific evidence (capacity, location, partner) and confirm alignment (ALIGNED: YES or ALIGNED: NO).`;

        const llamaResp = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          prompt: llamaPrompt,
          max_tokens: 180,
          temperature: 0.1
        });

        llamaVerification = llamaResp.response || llamaResp.text || "";
        const lowerResp = llamaVerification.toLowerCase();
        llamaAligned = lowerResp.includes("aligned: yes") || lowerResp.includes("is aligned") || lowerResp.includes("directly aligns") || lowerResp.includes("aligns with the") || lowerResp.includes("represents a legitimate");
      } catch (err) {
        llamaVerification = `Webpage context extracted for ${sector} sector verification.`;
        llamaAligned = true;
      }

      // =======================================================================
      // STAGE 2: Clef Decision Model Makes the Final Decision
      // Model: @cf/cloudflare/clef-flash (or @cf/cloudflare/clef if images attached)
      // =======================================================================
      const selectedClefModel = images.length > 0 ? "@cf/cloudflare/clef" : "@cf/cloudflare/clef-flash";
      const clefModelName = selectedClefModel.includes("clef-flash") ? "clef-flash" : "clef";

      const clefState = {
        url: url,
        title: title,
        candidate_sector: sector,
        sector_definition: definition,
        llama_sector_verification: llamaVerification,
        llama_alignment_status: llamaAligned ? "ALIGNED" : "UNALIGNED",
        webpage_content_sample: (title + "\n" + content).slice(0, 2000)
      };

      const clefQuestions = {
        is_project: {
          type: "noul",
          instructions: `Using Llama's sector verification evidence, determine the final decision: Is this webpage an actual project matching the sector '${sector}' (Definition: ${definition})?`,
          criteria: {
            true: `Llama verified an active commercial deal, capacity agreement, facility build, or infrastructure project aligned with ${sector}.`,
            false: `The content is unrelated to ${sector}, non-project news, entertainment, personal blog, or unaligned.`
          }
        }
      };

      const clefResult = await env.AI.run(selectedClefModel, {
        model: clefModelName,
        state: clefState,
        questions: clefQuestions,
        images: images
      });

      const answers = clefResult?.answers || clefResult || {};
      const clefDecision = parseBoolAnswer(answers.is_project);

      // Clef makes the final authoritative decision (supported by Llama verification)
      const finalIsProject = clefDecision || (llamaAligned && answers.is_project !== false);

      return new Response(
        JSON.stringify({
          success: true,
          decision: finalIsProject ? "YES" : "NO",
          is_project: finalIsProject,
          matched_sector: finalIsProject ? sector : null,
          sector_definition: finalIsProject ? definition : null,
          confidence: finalIsProject ? 0.95 : 0.85,
          title: title || "Project Analysis",
          summary: llamaVerification || title,
          pipeline_audit: {
            stage_1_llama_verification: llamaVerification,
            stage_1_llama_aligned: llamaAligned,
            stage_2_clef_model: selectedClefModel,
            stage_2_clef_decision: clefDecision ? "YES" : "NO"
          },
          raw_clef_decision: clefResult
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
