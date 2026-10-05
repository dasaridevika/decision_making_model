import streamlit as st
import requests

st.set_page_config(
    page_title="Client Support & Inquiry Portal",
    page_icon="💼",
    layout="centered"
)

# Clean CSS Styling
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
    <div class="sub-title">Powered by Cloudflare Workers AI</div>
</div>
""", unsafe_allow_html=True)

# Worker Endpoint Configuration
worker_url = st.sidebar.text_input(
    "Cloudflare Worker URL:",
    value="https://client-decision-router.your-subdomain.workers.dev",
    help="Enter your deployed Cloudflare Worker URL"
)

# Input Form
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

    subject = st.text_input("Subject *", placeholder="e.g. Pricing quotation / Project delivery update")
    message = st.text_area("How can we help you? *", placeholder="Please describe your query or issue...", height=130)

    submit_btn = st.form_submit_button("Submit Request", type="primary", use_container_width=True)

# Form Submission
if submit_btn:
    if not message.strip():
        st.error("Please enter your message before submitting.")
    else:
        payload = {
            "client_name": client_name or "Valued Client",
            "company": company_name or "N/A",
            "is_known_client": is_known,
            "subject": subject,
            "message": message
        }

        with st.spinner("Connecting to Cloudflare Workers AI..."):
            try:
                response = requests.post(worker_url, json=payload, timeout=10)
                
                if response.status_code == 200:
                    data = response.json()
                    routing = data.get("routing", {})

                    st.markdown(f"""
                    <div class="result-box">
                        <div class="assigned-badge">{routing.get('team', 'Support Team')}</div>
                        <div class="rep-name">{routing.get('icon', '💼')} Assigned Representative: {routing.get('title', 'Representative')}</div>
                        <p style="color: #4B5563; margin-bottom: 0.5rem;">
                            Hello <b>{client_name or 'there'}</b>, thank you for reaching out. Your inquiry has been routed.
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
                else:
                    st.error(f"Worker error ({response.status_code}): {response.text}")
            except Exception as e:
                st.warning(f"Could not connect to Cloudflare Worker at `{worker_url}`. Please verify your Worker URL in the sidebar.")
