import streamlit as st
import base64
import requests
from schema import ClefDecisionRequest
from decision_engine import (
    build_client_state,
    build_clef_request,
    simulate_clef_decision
)

st.set_page_config(
    page_title="Client Support & Inquiry Portal",
    page_icon="💼",
    layout="centered"
)

# Clean, elegant styling
st.markdown("""
<style>
    .main-header {
        text-align: center;
        margin-bottom: 2rem;
    }
    .main-title {
        font-size: 2rem;
        font-weight: 700;
        color: #111827;
        margin-bottom: 0.25rem;
    }
    .sub-title {
        font-size: 1rem;
        color: #6B7280;
    }
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
    .rep-name {
        font-size: 1.4rem;
        font-weight: 700;
        color: #0F172A;
        margin-bottom: 0.5rem;
    }
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
    <div class="sub-title">Submit your request below and we will instantly connect you with the right representative.</div>
</div>
""", unsafe_allow_html=True)

with st.form("inquiry_form"):
    col1, col2 = st.columns(2)
    with col1:
        client_name = st.text_input("Your Name *", placeholder="e.g. Alex Johnson")
    with col2:
        company_name = st.text_input("Company / Organization", placeholder="e.g. Acme Corp")

    is_existing = st.radio(
        "Are you an existing client?",
        ["No, I'm reaching out for the first time", "Yes, I have an active account / project with you"],
        index=0,
        horizontal=True
    )
    is_known = (is_existing == "Yes, I have an active account / project with you")

    subject = st.text_input("Subject *", placeholder="e.g. Question about project delivery date / Quote request")
    message = st.text_area("How can we help you? *", placeholder="Please describe your query, request, or issue...", height=140)

    submit_btn = st.form_submit_button("Submit Request", type="primary", use_container_width=True)

if submit_btn:
    if not message.strip():
        st.error("Please enter a message before submitting.")
    else:
        # Build client state
        client_state = build_client_state(
            client_name=client_name or "Valued Client",
            company=company_name or "N/A",
            is_known_client=is_known,
            subject=subject,
            message=message
        )
        
        clef_req = build_clef_request(state=client_state)
        decision_res = simulate_clef_decision(clef_req)

        assigned_rep = decision_res["assigned_representative"]["choice"]
        urgency_level = decision_res["inquiry_urgency"]["level"]

        # Human friendly metadata mapping
        rep_profiles = {
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

        profile = rep_profiles.get(assigned_rep, rep_profiles["customer_support"])
        urgency_text = ["Standard", "Standard", "High Priority", "Urgent / Blocker"][min(urgency_level, 3)]

        st.markdown(f"""
        <div class="result-box">
            <div class="assigned-badge">{profile['team']}</div>
            <div class="rep-name">{profile['icon']} Assigned Representative: {profile['title']}</div>
            <p style="color: #4B5563; margin-bottom: 0.5rem;">
                Hello <b>{client_name or 'there'}</b>, thank you for reaching out. Based on your request, your inquiry has been routed directly to the appropriate team.
            </p>
            <div class="next-steps">
                <b>📌 What happens next:</b>
                <p style="margin: 0.25rem 0 0.5rem 0; color: #374151;">{profile['action']}</p>
                <div style="font-size: 0.9rem; color: #6B7280;">
                    ⏱️ <b>Expected Response Time:</b> {profile['response_time']} &nbsp;|&nbsp; 
                    🏷️ <b>Priority Level:</b> {urgency_text}
                </div>
            </div>
        </div>
        """, unsafe_allow_html=True)
