import streamlit as st
import pandas as pd
import requests
from bs4 import BeautifulSoup
import re
import os

st.set_page_config(
    page_title="Clef Project URL Validator",
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
        font-size: 1.4rem;
        font-weight: 800;
        padding: 0.35rem 1rem;
        border-radius: 8px;
        display: inline-block;
        margin-bottom: 0.75rem;
    }
    .badge-no {
        background: #EF4444;
        color: white;
        font-size: 1.4rem;
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
    <div class="main-title">🔍 Clef Project URL Validator</div>
    <div class="sub-title">Evaluates if a URL is a legitimate project aligned with company sectors</div>
</div>
""", unsafe_allow_html=True)

# -------------------------------------------------------------
# 1. Load Sector Definitions from CSV
# -------------------------------------------------------------
@st.cache_data
def load_sectors():
    csv_path = "sector_definitions.csv"
    if os.path.exists(csv_path):
        df = pd.read_csv(csv_path)
        # Standardize columns
        df.columns = [c.strip() for c in df.columns]
        sectors_dict = {}
        for _, row in df.iterrows():
            name = str(row.iloc[0]).strip()
            definition = str(row.iloc[1]).strip() if len(row) > 1 else ""
            sectors_dict[name] = definition
        return sectors_dict
    return {}

SECTORS = load_sectors()

# -------------------------------------------------------------
# 2. Extract Webpage Context from URL
# -------------------------------------------------------------
def extract_url_context(url: str) -> dict:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        if not url.startswith("http://") and not url.startswith("https://"):
            url = "https://" + url

        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return {"success": False, "error": f"HTTP {resp.status_code} - Unable to fetch page."}

        soup = BeautifulSoup(resp.text, "html.parser")

        # Remove script and style tags
        for script in soup(["script", "style", "nav", "footer", "header"]):
            script.decompose()

        # Extract title
        title = soup.title.string.strip() if soup.title and soup.title.string else ""

        # Extract meta description
        meta_desc = ""
        meta_tag = soup.find("meta", attrs={"name": re.compile(r"description", re.I)}) or soup.find("meta", attrs={"property": "og:description"})
        if meta_tag and meta_tag.get("content"):
            meta_desc = meta_tag["content"].strip()

        # Extract text content
        paragraphs = [p.get_text().strip() for p in soup.find_all(["p", "h1", "h2", "h3"]) if p.get_text().strip()]
        full_text = " ".join(paragraphs)
        full_text = re.sub(r"\s+", " ", full_text)[:3000] # Cap text length for Clef context

        return {
            "success": True,
            "url": url,
            "title": title,
            "meta_description": meta_desc,
            "content": full_text
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

# -------------------------------------------------------------
# 3. Decision Evaluation Logic
# -------------------------------------------------------------
def evaluate_project_alignment(page_data: dict, worker_url: str = "") -> dict:
    text_corpus = f"{page_data.get('title', '')} {page_data.get('meta_description', '')} {page_data.get('content', '')}".lower()
    
    # Check if a Worker URL is available
    if worker_url.strip():
        try:
            # Send extracted context to Cloudflare Worker AI running Clef
            payload = {
                "url": page_data.get("url"),
                "state": {
                    "title": page_data.get("title"),
                    "description": page_data.get("meta_description"),
                    "content": page_data.get("content")[:2000]
                }
            }
            worker_resp = requests.post(worker_url.strip(), json=payload, timeout=12)
            if worker_resp.status_code == 200:
                return worker_resp.json()
        except Exception:
            pass  # Fall back to local sector evaluator

    # Local Sector Alignment Evaluator (using sector_definitions.csv)
    matched_sector = None
    matched_definition = ""
    max_score = 0

    for sector_name, definition in SECTORS.items():
        # Check sector keywords in extracted text
        sector_words = [w.lower() for w in re.findall(r"\w+", sector_name) if len(w) > 3]
        if not sector_words:
            continue
        
        matches = sum(1 for w in sector_words if w in text_corpus)
        score = matches / len(sector_words)
        
        if score > max_score and score >= 0.5:
            max_score = score
            matched_sector = sector_name
            matched_definition = definition

    # Check if text shows project characteristics (facilities, installations, capacity, location, commissioning)
    project_signals = ["project", "plant", "facility", "capacity", "mw", "installed", "construction", "location", "commissioned", "developed", "phase", "infrastructure"]
    project_score = sum(1 for w in project_signals if w in text_corpus)

    is_project = (matched_sector is not None) and (project_score >= 2 or max_score >= 0.7)
    confidence = min(0.95, round(0.5 + (max_score * 0.3) + (min(project_score, 5) * 0.05), 2)) if is_project else 0.85

    return {
        "is_project": is_project,
        "decision": "YES" if is_project else "NO",
        "confidence": confidence,
        "matched_sector": matched_sector if is_project else None,
        "sector_definition": matched_definition if is_project else None,
        "summary": page_data.get("meta_description") or (page_data.get("content", "")[:200] + "...")
    }

# -------------------------------------------------------------
# 4. Read Worker URL Silently from Streamlit Secrets
# -------------------------------------------------------------
worker_url = ""
try:
    if "CLOUDFLARE_WORKER_URL" in st.secrets:
        worker_url = st.secrets["CLOUDFLARE_WORKER_URL"]
    elif "WORKER_URL" in st.secrets:
        worker_url = st.secrets["WORKER_URL"]
except Exception:
    pass

with st.form("url_form"):
    project_url = st.text_input(
        "Enter Project / Webpage URL *",
        placeholder="e.g. https://www.power-technology.com/projects/bhadla-solar-park-rajasthan/"
    )
    submit_btn = st.form_submit_button("Analyze & Verify Project", type="primary", use_container_width=True)

if submit_btn:
    if not project_url.strip():
        st.error("Please enter a valid URL to analyze.")
    else:
        with st.spinner("Fetching URL content and analyzing with Clef model..."):
            page_data = extract_url_context(project_url.strip())

            if not page_data.get("success"):
                st.error(f"Could not read URL: {page_data.get('error')}")
            else:
                result = evaluate_project_alignment(page_data, worker_url=worker_url)
                
                is_proj = result.get("is_project", False)
                decision_text = result.get("decision", "NO")
                
                if is_proj or decision_text == "YES":
                    st.markdown(f"""
                    <div class="yes-card">
                        <div class="badge-yes">✅ YES — This is a Project</div>
                        <h3 style="color: #15803D; margin: 0.5rem 0;">{page_data.get('title', 'Project Identified')}</h3>
                        <p style="color: #374151;">{result.get('summary', '')}</p>
                        <div class="sector-info">
                            <b>🏷️ Matched Company Sector:</b> {result.get('matched_sector', 'Industrial Project')}
                            <p style="margin: 0.35rem 0 0 0; color: #4B5563; font-size: 0.95rem;">
                                <b>Definition:</b> {result.get('sector_definition', 'Matches defined company sector specifications.')}
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
                        <div class="badge-no">❌ NO — Not a Recognized Sector Project</div>
                        <h3 style="color: #B91C1C; margin: 0.5rem 0;">{page_data.get('title', 'Non-Project Page')}</h3>
                        <p style="color: #374151;">{result.get('summary', '')}</p>
                        <p style="color: #7F1D1D; margin-top: 0.5rem; font-size: 0.95rem;">
                            The analyzed URL does not contain an active project scope or does not align with any of the <b>{len(SECTORS)}</b> registered company sectors.
                        </p>
                    </div>
                    """, unsafe_allow_html=True)
