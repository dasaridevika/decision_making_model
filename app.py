import streamlit as st
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
    <div class="sub-title">Intelligent AI Query Routing & Decision Making</div>
</div>
""", unsafe_allow_html=True)

# -------------------------------------------------------------
# Read Cloudflare Worker URL from Streamlit Secrets or Sidebar
# -------------------------------------------------------------
default_worker_url = ""
try:
    if "CLOUDFLARE_WORKER_URL" in st.secrets:
        default_worker_url = st.secrets["CLOUDFLARE_WORKER_URL"]
    elif "WORKER_URL" in st.secrets:
        default_worker_url = st.secrets["WORKER_URL"]
except Exception:
    pass

with st.sidebar:
    st.header("⚙️ Settings")
    worker_url = st.text_input(
        "Cloudflare Worker URL:",
        value=default_worker_url,
        placeholder="https://your-worker.workers.dev",
        help="Reads automatically from .streamlit/secrets.toml"
    )

with st.form("inquiry_form"):
    col1, col2 = st.columns(2)
    with col1:
        client_name = st.text_input("Your Name *", placeholder="Enter your name")
    with col2:
        company_name = st.text_input("Company / Organization", placeholder="Enter company name")

    is_existing = st.radio(
        "Are you an existing client?",
        ["No, I'm reaching out for the first time", "Yes, I have an active account / project with you"],
        index=0,
        horizontal=True
    )
    is_known = (is_existing == "Yes, I have an active account / project with you")

    subject = st.text_input("Subject *", placeholder="Enter subject")
    message = st.text_area("How can we help you? *", placeholder="Enter your message or inquiry...", height=130)

    # Image attachments (Clef extension: PNG, JPEG, WebP, max 4)
    uploaded_images = st.file_uploader(
        "Attach Screenshots / Images (Optional, max 4 images):",
        type=["png", "jpg", "jpeg", "webp"],
        accept_multiple_files=True,
        help="Supports PNG, JPEG, or WebP up to 4MB each"
    )

    submit_btn = st.form_submit_button("Submit Request", type="primary", use_container_width=True)

# -------------------------------------------------------------
# AI-Driven Decision Execution
# -------------------------------------------------------------
if submit_btn:
    if not message.strip():
        st.error("Please enter your message before submitting.")
    elif not worker_url.strip():
        st.warning("Please configure your Cloudflare Worker URL in `.streamlit/secrets.toml` or the sidebar.")
    else:
        # Convert attached images to base64 Data URLs (max 4)
        images_payload = []
        if uploaded_images:
            if len(uploaded_images) > 4:
                st.warning("Maximum of 4 images allowed. Processing the first 4 images.")
            
            import base64
            for img_file in uploaded_images[:4]:
                file_bytes = img_file.read()
                b64_encoded = base64.b64encode(file_bytes).decode("utf-8")
                mime = img_file.type if img_file.type else "image/png"
                images_payload.append(f"data:{mime};base64,{b64_encoded}")

        payload = {
            "client_name": client_name.strip(),
            "company": company_name.strip(),
            "is_known_client": is_known,
            "subject": subject.strip(),
            "message": message.strip(),
            "images": images_payload
        }

        with st.spinner("Cloudflare Workers AI is evaluating your inquiry..."):
            try:
                resp = requests.post(worker_url.strip(), json=payload, timeout=10)
                
                if resp.status_code == 200:
                    data = resp.json()
                    routing = data.get("routing", {})

                    st.markdown(f"""
                    <div class="result-box">
                        <div class="assigned-badge">{routing.get('team', 'Assigned Team')}</div>
                        <div class="rep-name">{routing.get('icon', '💼')} Assigned Representative: {routing.get('title', 'Representative')}</div>
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
                else:
                    st.error(f"Worker Error ({resp.status_code}): {resp.text}")
            except Exception as e:
                st.error(f"Failed to connect to Cloudflare Worker: {e}")
