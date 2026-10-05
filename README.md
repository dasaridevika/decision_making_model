# 💼 Client Inquiry & Support Decision Router

A lightweight client-facing portal built with **Streamlit** that routes client requests to the right representative using **Cloudflare Workers AI (`@cf/cloudflare/clef`)**.

---

## 📁 Repository Structure

```
.
├── app.py              # Streamlit Client Support & Inquiry Portal
├── requirements.txt    # Python dependencies (streamlit, requests)
├── .gitignore          # Git ignore rules
└── README.md           # Documentation
```

---

## 🚀 How to Run

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Run the Streamlit application:**
   ```bash
   streamlit run app.py
   ```

3. **In the application:**
   * Enter your deployed **Cloudflare Worker URL** in the sidebar.
   * Fill out the client inquiry form to receive instant routing and resolution.
