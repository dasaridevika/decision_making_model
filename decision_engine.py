import json
import re
from typing import Dict, Any, Optional
from schema import ClefDecisionRequest, ChoiceQuestion, NoulQuestion, ScoreQuestion

# Pre-defined standardized questions for client routing
DEFAULT_QUESTIONS: Dict[str, Any] = {
    "assigned_representative": ChoiceQuestion(
        instructions="Analyze the client's relationship, situation, and request to select the most appropriate representative to handle and reply to this query.",
        criteria={
            "sales_bdr": "For new prospects seeking pricing, product capabilities, quotes, demos, trial setup, or sales discovery.",
            "solutions_architect": "For prospects or clients asking in-depth technical architecture questions, API integration feasibility, security/compliance validations, or custom engineering feasibility.",
            "project_manager": "For active/existing clients inquiring about ongoing project status, milestone deliverables, delivery dates, sprint roadmap, change-of-scope requests, or sprint task updates.",
            "account_manager": "For existing clients inquiring about commercial contract renewals, seat expansion, license upgrades, invoice/billing issues, or partnership reviews.",
            "customer_support": "For existing users/clients experiencing technical bugs, system outages, error codes, login/authentication failures, or operational disruptions."
        }
    ),
    "is_existing_client": NoulQuestion(
        instructions="Determine if the person or organization submitting this inquiry is an already signed/active client (Yes) or a new prospect/unregistered user (No).",
        criteria={
            "true": "The user references an active contract, project milestone, account ID, existing SLA, or previous work done.",
            "false": "The user is an external prospect inquiring about services, asking 'can you do this', requesting pricing/quotes for the first time."
        }
    ),
    "inquiry_urgency": ScoreQuestion(
        instructions="Rate the operational and business urgency of this inquiry on a 4-level rubric.",
        criteria=[
            "Level 0 (Low): General inquiry, exploratory information, no deadline mentioned, casual feedback.",
            "Level 1 (Normal): Standard routine request, scheduled update, non-blocking question.",
            "Level 2 (High): Time-sensitive request, contract expiring soon, upcoming demo/milestone deadline, minor bug impacting workflow.",
            "Level 3 (Critical): Total system downtime, security breach, production outage, severe client escalation threatening churn."
        ]
    ),
    "sentiment_tone": ChoiceQuestion(
        instructions="What is the emotional tone or sentiment conveyed in the message?",
        criteria={
            "positive_enthusiastic": "Excited, appreciative, eager to start, praising past work.",
            "neutral_professional": "Matter-of-fact, polite, business inquiry, regular operational communication.",
            "concerned_inquisitive": "Hesitant, asking for risk mitigations, inquiring about potential delays.",
            "frustrated_escalated": "Angry, disappointed with service, threatening cancellation, demanding urgent escalation."
        }
    )
}

def build_client_state(
    client_name: str,
    company: str,
    is_known_client: Optional[bool],
    subject: str,
    message: str,
    metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Formats structured state representing the client inquiry for Clef evaluation."""
    state = {
        "client_profile": {
            "name": client_name.strip() if client_name else "Unknown",
            "company": company.strip() if company else "Unknown",
            "is_known_client": is_known_client,
        },
        "inquiry": {
            "subject": subject.strip() if subject else "",
            "message": message.strip() if message else "",
        }
    }
    if metadata:
        state["metadata"] = metadata
    return state


def build_clef_request(
    state: Any,
    model: str = "clef-flash",
    custom_questions: Optional[Dict[str, Any]] = None,
    images: Optional[list] = None
) -> ClefDecisionRequest:
    """Builds and validates a full ClefDecisionRequest against the official schema."""
    questions = custom_questions if custom_questions is not None else DEFAULT_QUESTIONS
    return ClefDecisionRequest(
        model=model,
        state=state,
        questions=questions,
        images=images
    )


def simulate_clef_decision(request_payload: ClefDecisionRequest) -> Dict[str, Any]:
    """
    High-fidelity deterministic local evaluator for unit testing and offline simulation.
    Analyzes keywords, sentiment, urgency triggers, and client status.
    """
    state_str = json.dumps(request_payload.state).lower()
    
    # 1. Determine is_existing_client
    existing_triggers = [
        "contract", "account id", "project milestone", "sprint", "our agreement",
        "current contract", "our app", "deployed", "invoice", "license renewal",
        "existing client", "our build", "ticket #", "subscription"
    ]
    is_existing_score = 0.85 if any(t in state_str for t in existing_triggers) else 0.15
    if '"is_known_client": true' in state_str:
        is_existing_score = 0.95
    elif '"is_known_client": false' in state_str:
        is_existing_score = 0.05

    # 2. Determine Representative
    scores = {
        "sales_bdr": 0.1,
        "solutions_architect": 0.1,
        "project_manager": 0.1,
        "account_manager": 0.1,
        "customer_support": 0.1
    }

    if any(k in state_str for k in ["pricing", "demo", "quote", "cost", "quotation", "how much", "we want to hire"]):
        scores["sales_bdr"] += 0.7
    if any(k in state_str for k in ["architecture", "api integration", "soc2", "vpc", "security protocol", "stack", "feasibility"]):
        scores["solutions_architect"] += 0.75
    if any(k in state_str for k in ["sprint", "milestone", "delivery date", "timeline", "progress update", "schedule", "when will it be ready"]):
        scores["project_manager"] += 0.85
    if any(k in state_str for k in ["billing", "invoice", "renew", "seat expansion", "tier upgrade", "contract amendment", "payment"]):
        scores["account_manager"] += 0.85
    if any(k in state_str for k in ["bug", "error", "500", "crash", "down", "outage", "broken", "cannot log in", "failure"]):
        scores["customer_support"] += 0.90

    # Adjust based on client status
    if is_existing_score > 0.5:
        scores["sales_bdr"] *= 0.2
    else:
        scores["project_manager"] *= 0.1
        scores["account_manager"] *= 0.1
        scores["customer_support"] *= 0.2

    total_rep = sum(scores.values())
    rep_probs = {k: round(v / total_rep, 3) for k, v in scores.items()}
    chosen_rep = max(rep_probs, key=rep_probs.get)

    # 3. Urgency Score (0-3)
    urgency_level = 1
    urgency_probs = [0.1, 0.7, 0.15, 0.05]
    if any(k in state_str for k in ["critical", "down", "outage", "immediately", "emergency", "production broken"]):
        urgency_level = 3
        urgency_probs = [0.01, 0.04, 0.15, 0.80]
    elif any(k in state_str for k in ["urgent", "deadline tomorrow", "asap", "delay", "blocked"]):
        urgency_level = 2
        urgency_probs = [0.05, 0.15, 0.70, 0.10]
    elif any(k in state_str for k in ["casual", "no rush", "whenever", "general info"]):
        urgency_level = 0
        urgency_probs = [0.85, 0.10, 0.04, 0.01]

    # 4. Sentiment
    sentiment = "neutral_professional"
    if any(k in state_str for k in ["angry", "unacceptable", "furious", "cancel my service", "terrible"]):
        sentiment = "frustrated_escalated"
    elif any(k in state_str for k in ["love", "great job", "excited", "awesome", "looking forward"]):
        sentiment = "positive_enthusiastic"
    elif any(k in state_str for k in ["worried", "concerned", "risk", "delay"]):
        sentiment = "concerned_inquisitive"

    return {
        "assigned_representative": {
            "choice": chosen_rep,
            "probabilities": rep_probs,
            "confidence": rep_probs[chosen_rep]
        },
        "is_existing_client": {
            "value": round(is_existing_score, 3),
            "decision": is_existing_score >= 0.5
        },
        "inquiry_urgency": {
            "level": urgency_level,
            "probabilities": urgency_probs,
            "confidence": max(urgency_probs)
        },
        "sentiment_tone": {
            "choice": sentiment,
            "confidence": 0.88
        }
    }
