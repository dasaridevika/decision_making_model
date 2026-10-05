import pytest
import json
from pydantic import ValidationError
from schema import (
    ClefDecisionRequest,
    NoulQuestion,
    ChoiceQuestion,
    ScoreQuestion,
    Base64ImageObject
)
from decision_engine import (
    DEFAULT_QUESTIONS,
    build_client_state,
    build_clef_request,
    simulate_clef_decision
)


class TestClefSchemaValidation:
    """Tests strictly validating adherence to the Cloudflare Clef API Schema."""

    def test_valid_minimal_payload(self):
        req = ClefDecisionRequest(
            model="clef",
            state="Hello, need a quote",
            questions={
                "q1": NoulQuestion(instructions="Is this a quote request?")
            }
        )
        assert req.model == "clef"
        assert len(req.questions) == 1

    def test_model_regex_pattern(self):
        # Valid model strings with leading/trailing spaces
        assert ClefDecisionRequest(
            model="  clef-flash  ",
            state="test",
            questions={"q1": NoulQuestion(instructions="Is it valid?")}
        ).model == "clef-flash"

        # Invalid model string
        with pytest.raises(ValidationError):
            ClefDecisionRequest(
                model="gpt-4o",
                state="test",
                questions={"q1": NoulQuestion(instructions="Is it valid?")}
            )

    def test_choice_criteria_bounds(self):
        # Less than 2 options -> Should fail
        with pytest.raises(ValidationError):
            ChoiceQuestion(
                instructions="Pick one",
                criteria={"only_one": "Single option"}
            )

        # Valid 2 options
        valid_choice = ChoiceQuestion(
            instructions="Pick one",
            criteria={"opt_a": "Option A", "opt_b": "Option B"}
        )
        assert len(valid_choice.criteria) == 2

    def test_score_criteria_bounds(self):
        # Less than 2 levels -> Should fail
        with pytest.raises(ValidationError):
            ScoreQuestion(
                instructions="Rate quality",
                criteria=["Level 1 only"]
            )

        # More than 10 levels -> Should fail
        with pytest.raises(ValidationError):
            ScoreQuestion(
                instructions="Rate quality",
                criteria=[f"Level {i}" for i in range(11)]
            )

        # Valid 4 levels
        valid_score = ScoreQuestion(
            instructions="Rate urgency",
            criteria=["Low", "Med", "High", "Critical"]
        )
        assert len(valid_score.criteria) == 4

    def test_image_validation(self):
        # Valid data URL
        valid_img_req = ClefDecisionRequest(
            model="clef",
            state="Check screenshot",
            questions={"q1": NoulQuestion(instructions="Is there an error?")},
            images=["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY44YAAAAASUVORK5CYII="]
        )
        assert len(valid_img_req.images) == 1

        # Invalid image URL without data: prefix
        with pytest.raises(ValidationError):
            ClefDecisionRequest(
                model="clef",
                state="Check screenshot",
                questions={"q1": NoulQuestion(instructions="Is there an error?")},
                images=["https://example.com/image.png"]
            )

        # More than 4 images -> Should fail
        with pytest.raises(ValidationError):
            ClefDecisionRequest(
                model="clef",
                state="Check screenshots",
                questions={"q1": NoulQuestion(instructions="Is there an error?")},
                images=["data:image/png;base64,1", "data:image/png;base64,2", "data:image/png;base64,3", "data:image/png;base64,4", "data:image/png;base64,5"]
            )


class TestClientRoutingDecisions:
    """Tests evaluating routing decisions for various client profiles and intents."""

    def test_new_prospect_sales_routing(self):
        state = build_client_state(
            client_name="Alice Smith",
            company="NexGen AI",
            is_known_client=False,
            subject="Inquiry regarding SaaS Enterprise pricing and quotation",
            message="Hi, we are evaluating your platform for 100 users. Could you share pricing, quote packages, and how to schedule a demo?"
        )
        req = build_clef_request(state)
        decision = simulate_clef_decision(req)

        assert decision["assigned_representative"]["choice"] == "sales_bdr"
        assert decision["is_existing_client"]["decision"] is False
        assert decision["inquiry_urgency"]["level"] in (0, 1)

    def test_new_prospect_solutions_architect_routing(self):
        state = build_client_state(
            client_name="David Chen",
            company="FinTech Core",
            is_known_client=False,
            subject="Technical architecture, custom VPC, and SOC2 compliance validation",
            message="We are architecting a high-throughput API integration. Does your stack support dedicated VPC peering, custom mTLS, and SOC2 Type II compliance?"
        )
        req = build_clef_request(state)
        decision = simulate_clef_decision(req)

        assert decision["assigned_representative"]["choice"] == "solutions_architect"
        assert decision["is_existing_client"]["decision"] is False

    def test_existing_client_project_manager_routing(self):
        state = build_client_state(
            client_name="Sarah Connor",
            company="Cyberdyne Corp",
            is_known_client=True,
            subject="Sprint 4 delivery date and milestone progress update",
            message="Hi team, checking in on our contract milestone #3 and Sprint 4 deliverables. What is our revised delivery date for the UI rollout?"
        )
        req = build_clef_request(state)
        decision = simulate_clef_decision(req)

        assert decision["assigned_representative"]["choice"] == "project_manager"
        assert decision["is_existing_client"]["decision"] is True

    def test_existing_client_account_manager_routing(self):
        state = build_client_state(
            client_name="Mark Evans",
            company="Global Logistics",
            is_known_client=True,
            subject="Annual contract renewal and adding 50 team seats",
            message="Our current annual agreement is expiring next month. We need to renew our license and expand by 50 additional enterprise seats. Please send updated invoice and contract amendment."
        )
        req = build_clef_request(state)
        decision = simulate_clef_decision(req)

        assert decision["assigned_representative"]["choice"] == "account_manager"
        assert decision["is_existing_client"]["decision"] is True

    def test_production_outage_support_and_critical_urgency(self):
        state = build_client_state(
            client_name="Robert Taylor",
            company="QuickPay Inc",
            is_known_client=True,
            subject="URGENT: Production API down, 500 error on checkout",
            message="EMERGENCY: Our production gateway is returning HTTP 500 errors! All customer checkouts are failing. Need immediate fix!"
        )
        req = build_clef_request(state)
        decision = simulate_clef_decision(req)

        assert decision["assigned_representative"]["choice"] == "customer_support"
        assert decision["is_existing_client"]["decision"] is True
        assert decision["inquiry_urgency"]["level"] == 3  # Critical urgency
        assert decision["assigned_representative"]["confidence"] > 0.5


if __name__ == "__main__":
    pytest.main(["-v", __file__])
