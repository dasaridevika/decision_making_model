import streamlit as st
import requests

st.set_page_config(
    page_title="Project URL Validator",
    page_icon="🔍",
    layout="centered"
)

# Custom Styling
st.markdown("""
<style>
    .main-header { text-align: center; margin-bottom: 2rem; }
    .main-title { font-size: 2.2rem; font-weight: 700; color: #0F172A; }
    .sub-title { font-size: 1.05rem; color: #64748B; margin-top: 0.3rem; }
    .yes-card {
        background: #F0FDF4;
        border: 2px solid #22C55E;
        border-radius: 12px;
        padding: 1.5rem;
        margin-top: 1.5rem;
    }
    .no-card {
        background: #FEF2F2;
        border: 2px solid #EF4444;
        border-radius: 12px;
        padding: 1.5rem;
        margin-top: 1.5rem;
    }
    .badge-yes {
        background: #22C55E;
        color: white;
        font-size: 1.3rem;
        font-weight: 800;
        padding: 0.35rem 1rem;
        border-radius: 8px;
        display: inline-block;
        margin-bottom: 0.75rem;
    }
    .badge-no {
        background: #EF4444;
        color: white;
        font-size: 1.3rem;
        font-weight: 800;
        padding: 0.35rem 1rem;
        border-radius: 8px;
        display: inline-block;
        margin-bottom: 0.75rem;
    }
    .sector-info {
        background: #FFFFFF;
        border-radius: 8px;
        padding: 1rem;
        margin-top: 1rem;
        border-left: 4px solid #3B82F6;
    }
</style>
""", unsafe_allow_html=True)

st.markdown("""
<div class="main-header">
    <div class="main-title">🔍 Project URL Validator</div>
    <div class="sub-title">Powered by Cloudflare Workers AI</div>
</div>
""", unsafe_allow_html=True)

# -------------------------------------------------------------
# Read Worker URL Silently from Streamlit Secrets
# -------------------------------------------------------------
worker_url = ""
try:
    if "CLOUDFLARE_WORKER_URL" in st.secrets:
        worker_url = st.secrets["CLOUDFLARE_WORKER_URL"]
    elif "WORKER_URL" in st.secrets:
        worker_url = st.secrets["WORKER_URL"]
except Exception:
    pass

# Form Input
with st.form("url_form"):
    project_url = st.text_input(
        "Enter Project / Webpage URL *",
        placeholder="https://example.com/project-name"
    )
    submit_btn = st.form_submit_button("Analyze & Verify Project", type="primary", use_container_width=True)

if submit_btn:
    if not project_url.strip():
        st.error("Please enter a valid URL to analyze.")
    elif not worker_url.strip():
        st.warning("Please configure `CLOUDFLARE_WORKER_URL` in Streamlit secrets.")
    else:
        with st.spinner("Analyzing URL with Cloudflare Workers AI..."):
            try:
                resp = requests.post(worker_url.strip(), json={"url": project_url.strip()}, timeout=15)
                
                if resp.status_code == 200:
                    result = resp.json()
                    is_proj = result.get("is_project", False)
                    decision_text = result.get("decision", "NO")
                    
                    if is_proj or decision_text == "YES":
                        st.markdown(f"""
                        <div class="yes-card">
                            <div class="badge-yes">✅ YES — This is a Project</div>
                            <h3 style="color: #15803D; margin: 0.5rem 0;">{result.get('title') or result.get('matched_sector') or 'Project Confirmed'}</h3>
                            <p style="color: #374151;">{result.get('summary', '')}</p>
                            <div class="sector-info">
                                <b>🏷️ Sector:</b> {result.get('matched_sector', 'Industrial / Commercial Project')}
                                <p style="margin: 0.35rem 0 0 0; color: #4B5563; font-size: 0.95rem;">
                                    <b>Definition:</b> {result.get('sector_definition', 'Matches defined industry sector specifications.')}
                                </p>
                            </div>
                            <p style="font-size: 0.85rem; color: #166534; margin-top: 0.75rem;">
                                <b>Confidence:</b> {int(result.get('confidence', 0.9) * 100)}%
                            </p>
                        </div>
                        """, unsafe_allow_html=True)
                    else:
                        st.markdown(f"""
                        <div class="no-card">
                            <div class="badge-no">❌ NO — Not a Recognized Project</div>
                            <p style="color: #374151; margin-top: 0.5rem;">{result.get('summary', 'The URL does not describe an active or specific industrial project.')}</p>
                        </div>
                        """, unsafe_allow_html=True)
                else:
                    st.error(f"Worker Error ({resp.status_code}): {resp.text}")
            except Exception as e:
                st.error(f"Failed to connect to Cloudflare Worker: {e}")
