import streamlit as st
import csv
import re
import requests
from urllib.parse import urlparse

st.set_page_config(
    page_title="Clef Project & Sector Validator",
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
    <div class="main-title">🔍 Clef Project & Sector Validator</div>
    <div class="sub-title">Verifies whether a URL represents an active project aligned with company sectors</div>
</div>
""", unsafe_allow_html=True)

# -------------------------------------------------------------
# 1. Load 463 Sectors & Definitions (Zero-dependency CSV loader)
# -------------------------------------------------------------
@st.cache_data
def load_sectors():
    sectors = {}
    try:
        with open("sector_definitions.csv", mode="r", encoding="utf-8") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            for row in reader:
                if len(row) >= 2:
                    name = row[0].strip()
                    definition = row[1].strip()
                    if name:
                        sectors[name] = definition
    except Exception:
        pass
    return sectors

SECTORS = load_sectors()

# -------------------------------------------------------------
# 2. Extract Webpage Context from URL
# -------------------------------------------------------------
def fetch_url_context(url: str) -> dict:
    target_url = url.strip()
    if not target_url.startswith("http://") and not target_url.startswith("https://"):
        target_url = "https://" + target_url

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        resp = requests.get(target_url, headers=headers, timeout=12)
        if resp.status_code != 200:
            return {"success": False, "error": f"HTTP status {resp.status_code}"}

        html = resp.text

        # Extract title
        title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
        title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else ""

        # Extract meta description
        meta_match = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']', html, re.IGNORECASE | re.DOTALL) or \
                     re.search(r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\'](.*?)["\']', html, re.IGNORECASE | re.DOTALL)
        meta_desc = meta_match.group(1).strip() if meta_match else ""

        # Clean HTML tags and scripts
        cleaned = re.sub(r"<(script|style|nav|footer|header)[^>]*>.*?</\1>", " ", html, flags=re.DOTALL | re.IGNORECASE)
        cleaned = re.sub(r"<[^>]+>", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()

        return {
            "success": True,
            "url": target_url,
            "title": title,
            "meta_description": meta_desc,
            "content": cleaned[:3500]
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

# -------------------------------------------------------------
# 3. Evaluate Project Alignment against Sector Knowledge Base
# -------------------------------------------------------------
def evaluate_project_alignment(page_data: dict, worker_url: str = "") -> dict:
    title = page_data.get("title", "")
    content = page_data.get("content", "")
    meta_desc = page_data.get("meta_description", "")
    full_text = f"{title} {meta_desc} {content}".lower()

    # Step A: Find best matching sector from sector_definitions.csv
    best_sector = None
    best_definition = ""
    best_score = 0

    for sector_name, definition in SECTORS.items():
        clean_name = re.sub(r"\(.*?\)", "", sector_name).strip().lower()
        
        # Exact sector substring match
        if clean_name in full_text:
            score = 100 + len(clean_name)
        else:
            # Word token intersection
            tokens = [w for w in re.findall(r"\b\w+\b", clean_name) if len(w) > 3]
            if tokens:
                matches = sum(1 for w in tokens if w in full_text)
                if matches == len(tokens):
                    score = 80 + matches * 5
                elif matches > 0:
                    score = (matches / len(tokens)) * 45
                else:
                    score = 0
            else:
                score = 0

        if score > best_score:
            best_score = score
            best_sector = sector_name
            best_definition = definition

    # Step B: If no recognized sector is matched with sufficient threshold, reject immediately
    is_recognized_sector = (best_sector is not None) and (best_score >= 45)
    if not is_recognized_sector:
        return {
            "is_project": False,
            "decision": "NO",
            "matched_sector": None,
            "sector_definition": None,
            "confidence": 0.95,
            "summary": meta_desc or (content[:220] + "..."),
            "worker_engine": "Sector Classifier"
        }

    # Step C: Check for real-world project operational indicators
    project_indicators = [
        "project", "plant", "facility", "capacity", "mw", "gw", "kw", "construction",
        "built", "installed", "commissioned", "developed", "contract", "deal",
        "site", "grid", "investment", "developer", "operator", "infrastructure", "substation"
    ]
    indicator_count = sum(1 for w in project_indicators if w in full_text)

    # Step D: If Cloudflare Worker URL is available, execute Clef decision
    if worker_url.strip():
        try:
            payload = {
                "url": page_data.get("url", ""),
                "title": title,
                "content": content[:2500],
                "matched_sector": best_sector,
                "sector_definition": best_definition
            }
            worker_resp = requests.post(worker_url.strip(), json=payload, timeout=12)
            if worker_resp.status_code == 200:
                worker_data = worker_resp.json()
                if "is_project" in worker_data:
                    return {
                        "is_project": worker_data.get("is_project"),
                        "decision": worker_data.get("decision", "YES" if worker_data.get("is_project") else "NO"),
                        "matched_sector": worker_data.get("matched_sector") or best_sector,
                        "sector_definition": worker_data.get("sector_definition") or best_definition,
                        "confidence": worker_data.get("confidence", 0.90),
                        "summary": meta_desc or (content[:220] + "..."),
                        "worker_engine": worker_data.get("model_used", "@cf/cloudflare/clef-flash")
                    }
        except Exception as e:
            pass  # Fall back to local sector evaluator

    # Local fallback threshold: Must match a registered sector AND show project attributes
    is_project = (indicator_count >= 2 or best_score >= 100)
    confidence = min(0.98, round(0.65 + (min(indicator_count, 6) * 0.05), 2)) if is_project else 0.85

    return {
        "is_project": is_project,
        "decision": "YES" if is_project else "NO",
        "matched_sector": best_sector if is_project else None,
        "sector_definition": best_definition if is_project else None,
        "confidence": confidence,
        "summary": meta_desc or (content[:220] + "..."),
        "worker_engine": "Local Sector Engine"
    }

# -------------------------------------------------------------
# 4. Streamlit UI
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
        placeholder="https://example.com/project-article-or-details"
    )
    submit_btn = st.form_submit_button("Analyze & Verify Project", type="primary", use_container_width=True)

if submit_btn:
    if not project_url.strip():
        st.error("Please enter a valid URL to analyze.")
    else:
        with st.spinner("Extracting webpage context and evaluating with Clef model..."):
            page_data = fetch_url_context(project_url.strip())

            if not page_data.get("success"):
                st.error(f"Could not load webpage: {page_data.get('error')}")
            else:
                result = evaluate_project_alignment(page_data, worker_url=worker_url)
                is_proj = result.get("is_project", False)
                engine_used = result.get("worker_engine", "Local Sector Engine")
                
                if is_proj:
                    st.markdown(f"""
                    <div class="yes-card">
                        <div class="badge-yes">✅ YES — This is a Project</div>
                        <h3 style="color: #15803D; margin: 0.5rem 0;">{page_data.get('title') or 'Project Identified'}</h3>
                        <p style="color: #374151;">{result.get('summary', '')}</p>
                        <div class="sector-info">
                            <b>🏷️ Matched Company Sector:</b> {result.get('matched_sector')}
                            <p style="margin: 0.35rem 0 0 0; color: #4B5563; font-size: 0.95rem;">
                                <b>Sector Definition:</b> {result.get('sector_definition')}
                            </p>
                        </div>
                        <div style="margin-top: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.9rem; color: #166534; font-weight: 600;">
                                <b>Confidence:</b> {int(result.get('confidence', 0.85) * 100)}%
                            </span>
                            <span style="font-size: 0.8rem; color: #64748B; background: #E2E8F0; padding: 0.2rem 0.6rem; border-radius: 6px;">
                                ⚡ Engine: {engine_used}
                            </span>
                        </div>
                    </div>
                    """, unsafe_allow_html=True)
                else:
                    st.markdown(f"""
                    <div class="no-card">
                        <div class="badge-no">❌ NO — Not a Recognized Sector Project</div>
                        <h3 style="color: #B91C1C; margin: 0.5rem 0;">{page_data.get('title') or 'Non-Project Webpage'}</h3>
                        <p style="color: #374151;">{result.get('summary', '')}</p>
                        <p style="color: #7F1D1D; margin-top: 0.5rem; font-size: 0.95rem;">
                            The analyzed webpage does not describe an active project scope or does not align with any of our <b>{len(SECTORS)}</b> registered company sectors.
                        </p>
                        <div style="margin-top: 0.75rem; text-align: right;">
                            <span style="font-size: 0.8rem; color: #64748B; background: #E2E8F0; padding: 0.2rem 0.6rem; border-radius: 6px;">
                                ⚡ Engine: {engine_used}
                            </span>
                        </div>
                    </div>
                    """, unsafe_allow_html=True)
