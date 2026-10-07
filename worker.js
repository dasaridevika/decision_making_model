/**
 * Cloudflare Worker: Clef Decision & LLM Engine
 * 
 * Active Models:
 * 1. @cf/cloudflare/clef-flash (Fast Clef Decision Model - noul/choice/score)
 * 2. @cf/cloudflare/clef (Full Multimodal Clef Model - text & image evaluations)
 * 3. @cf/meta/llama-3-8b-instruct (Generative LLM for context reasoning & summarization)
 * 
 * Supports:
 * - MODE 1: Project & Sector Alignment Validator (URL Webpage Context Evaluation)
 * - MODE 2: Client Inquiry Decision Router (Multi-role Routing + Urgency Scoring)
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

// Mode 2 Question Schema for Clef
const ROUTING_QUESTIONS = {
  assigned_representative: {
    type: "choice",
    instructions: "Analyze the inquiry. If the user asks about project status, delivery dates, timelines, milestones, or progress updates, ALWAYS choose project_manager.",
    criteria: {
      project_manager: "For ANY inquiry regarding project status, delivery dates, timelines, milestones, sprint progress, or deliverables walkthroughs.",
      sales_bdr: "Strictly for new business inquiries asking about purchasing services, initial pricing quotations, product overview brochures, sales discovery, or scheduling a demo.",
      solutions_architect: "For prospects or clients asking in-depth technical architecture questions, API integration feasibility, security/compliance validations, or custom engineering feasibility.",
      account_manager: "For existing clients inquiring about commercial contract renewals, seat expansion, license upgrades, invoice/billing issues, or partnership reviews.",
      customer_support: "For existing users/clients experiencing technical bugs, system outages, error codes, login/authentication failures, or operational disruptions."
    }
  },
  is_existing_client: {
    type: "noul",
    instructions: "Determine if the person or organization submitting this inquiry is an already signed/active client (Yes) or a new prospect/unregistered user (No).",
    criteria: {
      true: "The user references an active contract, project milestone, account ID, existing SLA, or previous work done.",
      false: "The user is an external prospect inquiring about services, asking 'can you do this', requesting pricing/quotes for the first time."
    }
  },
  inquiry_urgency: {
    type: "score",
    instructions: "Rate the operational and business urgency of this inquiry on a 4-level rubric.",
    criteria: [
      "Level 0 (Low): General inquiry, exploratory information, no deadline mentioned, casual feedback.",
      "Level 1 (Normal): Standard routine request, scheduled update, non-blocking question.",
      "Level 2 (High): Time-sensitive request, contract expiring soon, upcoming demo/milestone deadline, minor bug impacting workflow.",
      "Level 3 (Critical): Total system downtime, security breach, production outage, severe client escalation threatening churn."
    ]
  }
};

const REPRESENTATIVE_METADATA = {
  project_manager: {
    title: "Project Delivery Manager",
    icon: "📋",
    team: "Project Management & Delivery Team",
    response_time: "Within 1–2 hours",
    action: "Your dedicated Project Manager will review your project timeline, sprint deliverables, and provide you with an updated status report."
  },
  sales_bdr: {
    title: "Sales & Business Development Representative",
    icon: "💼",
    team: "Growth & Client Onboarding Team",
    response_time: "Within 2–4 hours",
    action: "We will prepare a customized quotation, product overview, or schedule a product walkthrough demo tailored to your requirements."
  },
  solutions_architect: {
    title: "Solutions Architect / Technical Consultant",
    icon: "📐",
    team: "Enterprise Engineering & Architecture Team",
    response_time: "Within 4–6 hours",
    action: "A senior technical architect is reviewing your technical specifications, architecture feasibility, and security requirements."
  },
  account_manager: {
    title: "Account Manager (Contracts & Billing)",
    icon: "🤝",
    team: "Client Relationship Management",
    response_time: "Within 2–3 hours",
    action: "Your Account Manager is reviewing your account details, contract terms, license seat expansion, or billing details to assist you."
  },
  customer_support: {
    title: "Technical Support Specialist",
    icon: "🛠️",
    team: "24/7 Technical Operations & Support",
    response_time: "Immediate / Under 30 minutes",
    action: "Our technical support engineers have flagged your issue and are actively investigating to resolve any errors or system disruptions."
  }
};

// Universal Parser for Clef answers
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

function parseScoreAnswer(ans) {
  if (typeof ans === "number") return ans;
  if (ans && typeof ans === "object") {
    if (typeof ans.score === "number") return ans.score;
    if (typeof ans.level === "number") return ans.level;
    if (typeof ans.value === "number") return ans.value;
  }
  return 2;
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
    throw new Error("Could not parse JSON: " + text.slice(0, 150));
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
          engine: "Cloudflare Clef & LLM Decision System",
          clef_models: ["@cf/cloudflare/clef-flash", "@cf/cloudflare/clef"],
          llm_model: "@cf/meta/llama-3-8b-instruct",
          modes: ["project_validator", "client_router"]
        }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    try {
      const body = await request.json();

      // =======================================================================
      // MODE 1: Project & Sector Alignment Validator (LLM + Clef Models)
      // =======================================================================
      if (body.url || body.project_url || (body.matched_sector && body.content)) {
        let url = body.url || body.project_url || "";
        let title = body.title || body.state?.title || "";
        let content = body.content || body.state?.content || "";
        let sector = body.matched_sector || body.state?.matched_sector || "General Infrastructure";
        let definition = body.sector_definition || body.state?.sector_definition || "Commercial and industrial operations";
        let images = body.images || [];

        // If content not provided, extract from URL
        if (!content && url) {
          const fetched = await fetchAndCleanUrl(url);
          title = title || fetched.title;
          content = fetched.content;
        }

        // 1. Primary: Run LLM Reasoning Model for Rich Verification & Summary
        try {
          const systemPrompt = `You are an expert industrial project evaluator. Analyze the webpage context and determine:
1. Does this describe an actual commercial/industrial project, facility development, capacity deal (MW/GW), power agreement, or construction initiative? (NOT entertainment, celebrity gossip, generic tutorials, or personal blogs).
2. Does it align with the industry sector '${sector}' (Definition: ${definition})?

Respond with STRICT JSON ONLY:
{
  "is_project": true,
  "decision": "YES",
  "matched_sector": "${sector}",
  "sector_definition": "${definition}",
  "confidence": 0.95,
  "project_summary": "1-2 sentence summary of the project details, location, and capacity.",
  "reasoning": "Clear explanation of how the project aligns with the sector."
}`;

          const userPrompt = `URL: ${url}\nTitle: ${title}\nSector: ${sector}\nDefinition: ${definition}\n\nWebpage Content:\n${(title + "\n" + content).slice(0, 3000)}`;

          const llmResp = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ],
            max_tokens: 512,
            temperature: 0.1
          });

          const parsed = extractJSON(llmResp.response || llmResp.text || JSON.stringify(llmResp));
          const isProj = Boolean(parsed.is_project);

          return new Response(
            JSON.stringify({
              success: true,
              is_project: isProj,
              decision: isProj ? "YES" : "NO",
              matched_sector: parsed.matched_sector || sector,
              sector_definition: parsed.sector_definition || definition,
              confidence: typeof parsed.confidence === "number" ? parsed.confidence : (isProj ? 0.95 : 0.85),
              summary: parsed.project_summary || parsed.summary || title,
              reasoning: parsed.reasoning || "",
              model_used: "@cf/meta/llama-3-8b-instruct",
              raw_response: parsed
            }),
            { status: 200, headers: CORS_HEADERS }
          );

        } catch (llmErr) {
          // 2. Fallback: Clef Model (@cf/cloudflare/clef for multimodal images or @cf/cloudflare/clef-flash)
          const clefModelId = images.length > 0 ? "@cf/cloudflare/clef" : "@cf/cloudflare/clef-flash";
          const clefModelName = clefModelId.includes("clef-flash") ? "clef-flash" : "clef";

          const clefResult = await env.AI.run(clefModelId, {
            model: clefModelName,
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
                instructions: `Determine if this webpage represents a legitimate real project, deal, contract, or facility in '${sector}' (Definition: ${definition}).`,
                criteria: {
                  true: `Real project, deal, or facility development in ${sector}.`,
                  false: "Unrelated content, non-project, or entertainment."
                }
              },
              confidence_score: {
                type: "score",
                instructions: "Rate confidence in project authenticity and sector alignment.",
                criteria: [
                  "Level 0 (Low): Weak evidence or mismatch.",
                  "Level 1 (Moderate): Minor project mention.",
                  "Level 2 (High): Verified project with clear commercial scale matching sector.",
                  "Level 3 (Very High): Major project/contract with concrete capacity, partners, and perfect alignment."
                ]
              }
            },
            images: images
          });

          const answers = clefResult?.answers || clefResult || {};
          const isProj = parseBoolAnswer(answers.is_sector_project ?? answers.is_real_project ?? answers.is_project);
          const scoreLevel = parseScoreAnswer(answers.confidence_score);
          const confidenceMap = [0.72, 0.82, 0.92, 0.97];

          return new Response(
            JSON.stringify({
              success: true,
              is_project: isProj,
              decision: isProj ? "YES" : "NO",
              matched_sector: sector,
              sector_definition: definition,
              confidence: confidenceMap[Math.min(Math.max(scoreLevel, 0), 3)],
              summary: title,
              reasoning: isProj ? `Verified as an active project aligned with ${sector}.` : `Content does not describe an active project scope for ${sector}.`,
              model_used: clefModelId,
              raw_response: clefResult
            }),
            { status: 200, headers: CORS_HEADERS }
          );
        }
      }

      // =======================================================================
      // MODE 2: Client Inquiry Decision Router (Clef & Clef-Flash Models)
      // =======================================================================
      const clientName = body.client_name || "Valued Client";
      const isKnownClient = body.is_known_client ?? false;
      const subject = body.subject || "";
      const message = body.message || "";
      const images = body.images || [];

      if (!message.trim()) {
        return new Response(
          JSON.stringify({ error: "Missing inquiry message or URL parameter." }),
          { status: 400, headers: CORS_HEADERS }
        );
      }

      const clientState = {
        client_profile: {
          name: clientName,
          company: body.company || "N/A",
          is_known_client: isKnownClient
        },
        inquiry: {
          subject: subject,
          message: message
        }
      };

      // Uses multimodal Clef if images/screenshots are uploaded, else clef-flash
      const routerModelId = images.length > 0 ? "@cf/cloudflare/clef" : "@cf/cloudflare/clef-flash";
      const routerModelName = routerModelId.includes("clef-flash") ? "clef-flash" : "clef";

      const aiResponse = await env.AI.run(routerModelId, {
        model: routerModelName,
        state: clientState,
        questions: ROUTING_QUESTIONS,
        images: images
      });

      const answers = aiResponse?.answers || aiResponse || {};

      let repKey = "project_manager";
      if (answers.assigned_representative) {
        if (typeof answers.assigned_representative === "string") {
          repKey = answers.assigned_representative;
        } else if (answers.assigned_representative.choice) {
          repKey = answers.assigned_representative.choice;
        }
      }

      let urgencyLevel = 1;
      if (answers.inquiry_urgency !== undefined) {
        if (typeof answers.inquiry_urgency === "number") {
          urgencyLevel = Math.round(answers.inquiry_urgency);
        } else if (answers.inquiry_urgency.level !== undefined) {
          urgencyLevel = answers.inquiry_urgency.level;
        } else if (answers.inquiry_urgency.score !== undefined) {
          urgencyLevel = Math.round(answers.inquiry_urgency.score);
        }
      }

      const repInfo = REPRESENTATIVE_METADATA[repKey] || REPRESENTATIVE_METADATA.project_manager;
      const urgencyLabels = ["Low", "Standard", "High Priority", "Urgent / Blocker"];

      return new Response(
        JSON.stringify({
          success: true,
          client_name: clientName,
          model_used: routerModelId,
          routing: {
            representative_key: repKey,
            title: repInfo.title,
            team: repInfo.team,
            icon: repInfo.icon,
            action: repInfo.action,
            response_time: repInfo.response_time,
            priority_level: urgencyLabels[Math.min(Math.max(urgencyLevel, 0), 3)]
          },
          raw_decision: aiResponse
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
