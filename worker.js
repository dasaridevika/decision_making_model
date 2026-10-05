const DECISION_QUESTIONS = {
  assigned_representative: {
    type: "choice",
    instructions: "Analyze the inquiry and any attached screenshots/images. If the user asks about project status, delivery dates, timelines, milestones, or progress updates, ALWAYS choose project_manager.",
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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === "GET") {
      return new Response(
        JSON.stringify({ status: "online", service: "Clef Decision Routing Engine" }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    try {
      const body = await request.json();
      const clientName = body.client_name || "Valued Client";
      const isKnownClient = body.is_known_client ?? false;
      const subject = body.subject || "";
      const message = body.message || "";
      const images = body.images || [];

      if (!message.trim()) {
        return new Response(JSON.stringify({ error: "Missing inquiry message." }), { status: 400, headers: CORS_HEADERS });
      }

      // 1. Structure Clef state
      const state = {
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

      // 2. Select model (use multimodal clef if images are attached, else clef-flash)
      const modelId = images.length > 0 ? "@cf/cloudflare/clef" : "@cf/cloudflare/clef-flash";
      const modelName = modelId.includes("clef-flash") ? "clef-flash" : "clef";

      // 3. Execute Clef Model via Workers AI
      const aiResponse = await env.AI.run(modelId, {
        model: modelName,
        state: state,
        questions: DECISION_QUESTIONS,
        images: images
      });

      // 4. Extract answers correctly from `aiResponse.answers`
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

      // 5. Return clean response for Streamlit
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
        JSON.stringify({ success: false, error: err.message || "Failed to process inquiry" }),
        { status: 500, headers: CORS_HEADERS }
      );
    }
  }
};
