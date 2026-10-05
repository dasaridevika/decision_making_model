# 🧭 Client Intelligent Decision & Routing Engine

An intelligent decision-making and query routing system based on **Cloudflare Clef / Clef-Flash** decision model API schema (`noul`, `choice`, `score`).

---

## 📁 Project Structure

```
client_decision_routing_system/
├── schema.py                 # Pydantic models matching Clef API JSON Schema
├── decision_engine.py        # Questions builder & high-fidelity simulation engine
├── test_decision_unit.py     # Pytest test suite (schema validation & decision assertions)
├── app.py                    # Streamlit interactive dashboard & benchmark runner
├── requirements.txt          # Python dependencies
├── worker/                   # Cloudflare Worker implementation
│   ├── src/index.ts          # Worker TypeScript script calling @cf/cloudflare/clef
│   ├── wrangler.toml         # Cloudflare Workers AI binding configuration
│   └── package.json          # Node dependencies
└── README.md                 # Documentation
```

---

## 🛠️ Roles & Decision Matrix

| Client Type | Inquiry Intent / Situation | Assigned Representative |
| :--- | :--- | :--- |
| **New Prospect** | Pricing, quote package, product demo, introductory calls | **💼 Sales / BDR** |
| **New Prospect** | Deep technical architecture, custom VPC, SOC2, API specs | **📐 Solutions Architect** |
| **Existing Client** | Sprint milestone status, UI deliverable date, scope updates | **📋 Project Manager (PM)** |
| **Existing Client** | License seat additions, annual contract renewals, invoices | **🤝 Account Manager (AM)** |
| **Existing Client** | Production 500 downtime, bug report, login/system errors | **🛠️ Customer Support** |

---

## 🚀 Getting Started

### 1. Run the Pytest Test Suite
```bash
python -m pytest test_decision_unit.py -v
```

### 2. Launch the Streamlit Interactive App
```bash
streamlit run app.py
```

### 3. Deploy the Cloudflare Worker (Optional)
```bash
cd worker
npm install
npx wrangler dev    # for local testing
npx wrangler deploy # for production deployment
```
