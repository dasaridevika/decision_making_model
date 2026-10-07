/**
 * Cloudflare Worker: Clef Decision Engine
 * Model: @cf/cloudflare/clef-flash / @cf/cloudflare/clef
 * 
 * Supports two operational modes:
 * 1. Project & Sector Alignment Validator (Verifies URL content against industry sectors)
 * 2. Client Inquiry Decision Router (Routes incoming inquiries to the right business unit)
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
    return { title, content: cleanText.slice(0, 3000) };
  } catch (e) {
    return { title: "", content: "" };
  }
}

// Helper to normalize Clef answers
function parseBoolAnswer(ans) {
  if (typeof ans === "boolean") return ans;
  if (typeof ans === "number") return ans >= 0.5;
  if (typeof ans === "string") return ans.toLowerCase() === "true" || ans.toLowerCase() === "yes";
  if (ans && typeof ans === "object") {
    if (typeof ans.value === "boolean") return ans.value;
    if (typeof ans.value === "number") return ans.value >= 0.5;
    if (typeof ans.value === "string") return ans.value.toLowerCase() === "true" || ans.value.toLowerCase() === "yes";
    if (typeof ans.choice === "string") return ans.choice.toLowerCase() === "true" || ans.choice.toLowerCase() === "yes";
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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === "GET") {
      return new Response(
        JSON.stringify({
          status: "online",
          engine: "Cloudflare Clef Decision Model",
          active_model: "@cf/cloudflare/clef-flash",
          modes: ["project_validator", "client_router"]
        }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    try {
      const body = await request.json();

      // =======================================================================
      // MODE 1: Project & Sector Alignment Validator (Clef-Flash Decision Model)
      // =======================================================================
      if (body.url || body.project_url || (body.matched_sector && body.content)) {
        let url = body.url || body.project_url || "";
        let title = body.title || body.state?.title || "";
        let content = body.content || body.state?.content || "";
        let sector = body.matched_sector || body.state?.matched_sector || "General Infrastructure";
        let definition = body.sector_definition || body.state?.sector_definition || "Industrial / commercial facility";

        // Fetch webpage text if not provided in payload
        if (!content && url) {
          const fetched = await fetchAndCleanUrl(url);
          title = title || fetched.title;
          content = fetched.content;
        }

        // Questions for Clef Model
        const projectQuestions = {
          is_real_project: {
            type: "noul",
            instructions: "Evaluate the text and determine whether it describes a real-world project, construction, facility development, plant expansion, or infrastructure contract.",
            criteria: {
              true: "The text describes an actual project, development, operational facility, or infrastructure initiative with specific capacity, location, investment, or enterprise details.",
              false: "The text is an unrelated article, generic overview, educational tutorial, product ad, or does not describe an active project."
            }
          },
          aligns_with_sector: {
            type: "noul",
            instructions: `Determine if the described project belongs to or aligns with the sector '${sector}' (Definition: ${definition}).`,
            criteria: {
              true: `The project operations and scope align directly with the ${sector} industry sector definition.`,
              false: `The project belongs to an entirely different industry or contradicts the ${sector} definition.`
            }
          },
          confidence_score: {
            type: "score",
            instructions: "Rate your confidence on a 4-level scale that this is a verified real project correctly classified under this sector.",
            criteria: [
              "Level 0 (Low): Weak evidence, uncertain project status, or questionable sector alignment.",
              "Level 1 (Moderate): Plausible project mention, but limited operational details.",
              "Level 2 (High): Verified project with clear commercial scale, location, or capacity matching sector.",
              "Level 3 (Very High): Definite project development with concrete investment, capacity (e.g. MW, GW, tons), timeline, and perfect sector alignment."
            ]
          }
        };

        // Run Cloudflare Clef-Flash
        const clefResult = await env.AI.run("@cf/cloudflare/clef-flash", {
          model: "clef-flash",
          state: {
            url: url,
            page_title: title,
            matched_sector: sector,
            sector_definition: definition,
            content_sample: content.slice(0, 2500)
          },
          questions: projectQuestions
        });

        const answers = clefResult?.answers || clefResult || {};

        const isRealProject = parseBoolAnswer(answers.is_real_project);
        const alignsWithSector = parseBoolAnswer(answers.aligns_with_sector);
        const scoreLevel = parseScoreAnswer(answers.confidence_score);

        const isProject = isRealProject && alignsWithSector;

        // Confidence calculation based on Clef Score (Level 0 to 3)
        const confidenceMap = [0.65, 0.78, 0.90, 0.96];
        const confidence = confidenceMap[Math.min(Math.max(scoreLevel, 0), 3)];

        return new Response(
          JSON.stringify({
            success: true,
            is_project: isProject,
            decision: isProject ? "YES" : "NO",
            matched_sector: sector,
            sector_definition: definition,
            confidence: confidence,
            is_real_project: isRealProject,
            aligns_with_sector: alignsWithSector,
            confidence_level: scoreLevel,
            title: title || "Project Analysis",
            model_used: "@cf/cloudflare/clef-flash",
            raw_decision: clefResult
          }),
          { status: 200, headers: CORS_HEADERS }
        );
      }

      // =======================================================================
      // MODE 2: Client Inquiry Decision Router (Clef Model)
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

      const modelId = images.length > 0 ? "@cf/cloudflare/clef" : "@cf/cloudflare/clef-flash";
      const modelName = modelId.includes("clef-flash") ? "clef-flash" : "clef";

      const aiResponse = await env.AI.run(modelId, {
        model: modelName,
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
          model_used: modelId,
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
