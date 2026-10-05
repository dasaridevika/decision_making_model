const DECISION_QUESTIONS = {
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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

function autoSelectModel(text) {
  const complexTriggers = ["architecture", "soc2", "vpc", "compliance", "integration", "mtls", "legal", "sla"];
  return complexTriggers.some(t => text.toLowerCase().includes(t)) ? "@cf/cloudflare/clef" : "@cf/cloudflare/clef-flash";
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === "GET") {
      return new Response(JSON.stringify({ status: "online", service: "Clef Decision Router" }), { status: 200, headers: CORS_HEADERS });
    }

    try {
      const body = await request.json();
      const clientName = body.client_name || "Valued Client";
      const isKnownClient = body.is_known_client ?? false;
      const subject = body.subject || "";
      const message = body.message || "";

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

      const selectedModel = autoSelectModel(`${subject} ${message}`);

      const aiDecision = await env.AI.run(selectedModel, {
        state: state,
        questions: DECISION_QUESTIONS
      });

      const repKey = aiDecision?.assigned_representative?.choice || "project_manager";
      const urgencyLevel = aiDecision?.inquiry_urgency?.level ?? 1;
      const repInfo = REPRESENTATIVE_METADATA[repKey] || REPRESENTATIVE_METADATA.project_manager;
      const urgencyLabels = ["Low", "Standard", "High Priority", "Urgent / Blocker"];

      return new Response(
        JSON.stringify({
          success: true,
          client_name: clientName,
          model_used: selectedModel,
          routing: {
            representative_key: repKey,
            title: repInfo.title,
            team: repInfo.team,
            icon: repInfo.icon,
            action: repInfo.action,
            response_time: repInfo.response_time,
            priority_level: urgencyLabels[Math.min(urgencyLevel, 3)]
          }
        }),
        { status: 200, headers: CORS_HEADERS }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: err.message }),
        { status: 500, headers: CORS_HEADERS }
      );
    }
  }
};
