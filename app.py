import streamlit as st
import json
import requests

st.set_page_config(
    page_title="Client Support & Inquiry Portal",
    page_icon="💼",
    layout="centered"
)

# Custom Styling
st.markdown("""
<style>
    .main-header { text-align: center; margin-bottom: 2rem; }
    .main-title { font-size: 2rem; font-weight: 700; color: #111827; }
    .sub-title { font-size: 1rem; color: #6B7280; }
    .result-box {
        background-color: #F8FAFC;
        border: 1px solid #E2E8F0;
        border-radius: 12px;
        padding: 1.5rem;
        margin-top: 1.5rem;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .assigned-badge {
        display: inline-block;
        background-color: #DBEAFE;
        color: #1E40AF;
        padding: 0.35rem 0.85rem;
        border-radius: 9999px;
        font-weight: 600;
        font-size: 0.95rem;
        margin-bottom: 0.75rem;
    }
    .rep-name { font-size: 1.4rem; font-weight: 700; color: #0F172A; margin-bottom: 0.5rem; }
    .next-steps {
        background: #FFFFFF;
        border-radius: 8px;
        padding: 1rem;
        border-left: 4px solid #3B82F6;
        margin-top: 1rem;
    }
</style>
""", unsafe_allow_html=True)

st.markdown("""
<div class="main-header">
    <div class="main-title">💼 Client Inquiry & Support Portal</div>
    <div class="sub-title">Intelligent Client Query Routing & Decision Making Engine</div>
</div>
""", unsafe_allow_html=True)

# -------------------------------------------------------------
# Decision Engine Logic & Rules
# -------------------------------------------------------------
REPRESENTATIVES = {
    "sales_bdr": {
        "title": "Sales & Business Development Representative",
        "icon": "💼",
        "team": "Growth & Client Onboarding Team",
        "response_time": "Within 2–4 hours",
        "action": "We will prepare a customized quotation, product overview, or schedule a product walkthrough demo tailored to your requirements."
    },
    "solutions_architect": {
        "title": "Solutions Architect / Technical Consultant",
        "icon": "📐",
        "team": "Enterprise Engineering & Architecture Team",
        "response_time": "Within 4–6 hours",
        "action": "A senior technical architect is reviewing your technical specifications, architecture feasibility, and security requirements."
    },
    "project_manager": {
        "title": "Project Delivery Manager",
        "icon": "📋",
        "team": "Project Management & Delivery Team",
        "response_time": "Within 1–2 hours",
        "action": "Your dedicated Project Manager will review your project timeline, sprint deliverables, and provide you with an updated status report."
    },
    "account_manager": {
        "title": "Account Manager (Contracts & Billing)",
        "icon": "🤝",
        "team": "Client Relationship Management",
        "response_time": "Within 2–3 hours",
        "action": "Your Account Manager is reviewing your account details, contract terms, license seat expansion, or billing details to assist you."
    },
    "customer_support": {
        "title": "Technical Support Specialist",
        "icon": "🛠️",
        "team": "24/7 Technical Operations & Support",
        "response_time": "Immediate / Under 30 minutes",
        "action": "Our technical support engineers have flagged your issue and are actively investigating to resolve any errors or system disruptions."
    }
}

def evaluate_decision(client_name: str, company: str, is_known_client: bool, subject: str, message: str) -> dict:
    """
    Intelligent Decision-Making Model:
    Analyzes intent, client status, urgency, and assigns the best representative.
    """
    text = f"{subject} {message}".lower()
    
    # 1. Representative Decision Weights
    scores = {
        "sales_bdr": 0.1,
        "solutions_architect": 0.1,
        "project_manager": 0.1,
        "account_manager": 0.1,
        "customer_support": 0.1
    }

    # Sales / Pricing triggers
    if any(w in text for w in ["pricing", "price", "quote", "quotation", "cost", "demo", "how much", "details", "hire", "services", "solar", "new project"]):
        scores["sales_bdr"] += 0.85

    # Solutions Architecture triggers
    if any(w in text for w in ["architecture", "api", "integration", "soc2", "vpc", "cloud", "security", "scalability", "tech stack"]):
        scores["solutions_architect"] += 0.85

    # Project Manager triggers
    if any(w in text for w in ["sprint", "milestone", "delivery", "timeline", "update", "progress", "schedule", "deadline", "status", "when will"]):
        scores["project_manager"] += 0.90

    # Account Manager triggers
    if any(w in text for w in ["renew", "renewal", "contract", "billing", "invoice", "seats", "license", "payment", "upgrade"]):
        scores["account_manager"] += 0.90

    # Customer Support triggers
    if any(w in text for w in ["bug", "error", "500", "404", "crash", "down", "outage", "broken", "issue", "failure", "not working", "login"]):
        scores["customer_support"] += 0.95

    # Relationship Context adjustment
    if is_known_client:
        scores["sales_bdr"] *= 0.2
    else:
        scores["project_manager"] *= 0.1
        scores["account_manager"] *= 0.1
        scores["customer_support"] *= 0.3

    chosen_rep_key = max(scores, key=scores.get)

    # 2. Urgency Level (0 to 3)
    urgency_level = 1  # Standard
    if any(w in text for w in ["urgent", "emergency", "immediately", "critical", "outage", "asap", "down", "blocked"]):
        urgency_level = 3  # Urgent / Blocker
    elif any(w in text for w in ["soon", "important", "deadline tomorrow", "high priority"]):
        urgency_level = 2  # High Priority
    elif any(w in text for w in ["general", "casual", "feedback", "when possible"]):
        urgency_level = 0  # Low

    rep_info = REPRESENTATIVES.get(chosen_rep_key, REPRESENTATIVES["sales_bdr"])
    urgency_labels = ["Low", "Standard", "High Priority", "Urgent / Blocker"]

    return {
        "representative_key": chosen_rep_key,
        "title": rep_info["title"],
        "team": rep_info["team"],
        "icon": rep_info["icon"],
        "action": rep_info["action"],
        "response_time": rep_info["response_time"],
        "priority_level": urgency_labels[min(urgency_level, 3)]
    }

# -------------------------------------------------------------
# User Interface Form
# -------------------------------------------------------------
with st.sidebar:
    st.header("⚙️ Settings")
    worker_url = st.text_input(
        "Cloudflare Worker URL (Optional):",
        value="",
        placeholder="https://your-worker.workers.dev",
        help="If provided, queries will route through your Cloudflare Worker AI."
    )

with st.form("inquiry_form"):
    col1, col2 = st.columns(2)
    with col1:
        client_name = st.text_input("Your Name *", placeholder="e.g. devika")
    with col2:
        company_name = st.text_input("Company / Organization", placeholder="e.g. Titan")

    is_existing = st.radio(
        "Are you an existing client?",
        ["No, I'm reaching out for the first time", "Yes, I have an active account / project with you"],
        index=0,
        horizontal=True
    )
    is_known = (is_existing == "Yes, I have an active account / project with you")

    subject = st.text_input("Subject *", placeholder="e.g. About solar global project")
    message = st.text_area("How can we help you? *", placeholder="e.g. Can u help me with providing details and pricing", height=130)

    submit_btn = st.form_submit_button("Submit Request", type="primary", use_container_width=True)

# -------------------------------------------------------------
# Decision Handling
# -------------------------------------------------------------
if submit_btn:
    if not message.strip():
        st.error("Please enter your message before submitting.")
    else:
        routing = None

        # 1. Try Cloudflare Worker if URL provided
        if worker_url.strip():
            with st.spinner("Connecting to Cloudflare Worker AI..."):
                try:
                    payload = {
                        "client_name": client_name or "Valued Client",
                        "company": company_name or "N/A",
                        "is_known_client": is_known,
                        "subject": subject,
                        "message": message
                    }
                    resp = requests.post(worker_url.strip(), json=payload, timeout=8)
                    if resp.status_code == 200:
                        data = resp.json()
                        routing = data.get("routing")
                except Exception:
                    pass  # Fall back seamlessly to built-in model

        # 2. Use Built-in Decision Making Engine
        if not routing:
            routing = evaluate_decision(
                client_name=client_name or "Valued Client",
                company=company_name or "N/A",
                is_known_client=is_known,
                subject=subject,
                message=message
            )

        # 3. Render Decision Result
        st.markdown(f"""
        <div class="result-box">
            <div class="assigned-badge">{routing.get('team', 'Support Team')}</div>
            <div class="rep-name">{routing.get('icon', '💼')} Assigned Representative: {routing.get('title')}</div>
            <p style="color: #4B5563; margin-bottom: 0.5rem;">
                Hello <b>{client_name or 'there'}</b>, thank you for reaching out. Based on your request, your inquiry has been routed directly to the appropriate team.
            </p>
            <div class="next-steps">
                <b>📌 What happens next:</b>
                <p style="margin: 0.25rem 0 0.5rem 0; color: #374151;">{routing.get('action', '')}</p>
                <div style="font-size: 0.9rem; color: #6B7280;">
                    ⏱️ <b>Expected Response Time:</b> {routing.get('response_time', 'Shortly')} &nbsp;|&nbsp; 
                    🏷️ <b>Priority Level:</b> {routing.get('priority_level', 'Standard')}
                </div>
            </div>
        </div>
        """, unsafe_allow_html=True)
