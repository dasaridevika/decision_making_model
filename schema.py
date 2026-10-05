import re
from typing import Dict, List, Optional, Union, Any, Literal
from pydantic import BaseModel, Field, field_validator, model_validator


class NoulCriteria(BaseModel):
    true: Optional[str] = Field(default=None, description="What a yes (value near 1) means.")
    false: Optional[str] = Field(default=None, description="What a no (value near 0) means.")


class NoulQuestion(BaseModel):
    type: Literal["noul"] = "noul"
    instructions: Union[str, Dict[str, Any], List[Any]] = Field(
        ..., description="Required. The yes/no question to evaluate."
    )
    criteria: Optional[NoulCriteria] = Field(
        default=None, description="Optional descriptions of what a yes and a no mean."
    )

    @field_validator("instructions")
    def validate_instructions(cls, v):
        if isinstance(v, str) and not v.strip():
            raise ValueError("instructions cannot be an empty string")
        return v


class ChoiceQuestion(BaseModel):
    type: Literal["choice"] = "choice"
    instructions: Union[str, Dict[str, Any], List[Any]] = Field(
        ..., description="Required. What the model should decide."
    )
    criteria: Dict[str, Any] = Field(
        ..., description="Map of option id (non-empty string) to its description. 2 to 255 options."
    )

    @field_validator("instructions")
    def validate_instructions(cls, v):
        if isinstance(v, str) and not v.strip():
            raise ValueError("instructions cannot be an empty string")
        return v

    @field_validator("criteria")
    def validate_criteria_count(cls, v):
        if not (2 <= len(v) <= 255):
            raise ValueError(f"Choice criteria must have between 2 and 255 options, got {len(v)}")
        for key in v.keys():
            if not key or not str(key).strip():
                raise ValueError("Option key cannot be empty")
        return v


class ScoreQuestion(BaseModel):
    type: Literal["score"] = "score"
    instructions: Union[str, Dict[str, Any], List[Any]] = Field(
        ..., description="Required. What the model should rate."
    )
    criteria: List[Any] = Field(
        ..., description="Ordered level descriptions (string, object, or array), lowest first (2 to 10 levels)."
    )

    @field_validator("instructions")
    def validate_instructions(cls, v):
        if isinstance(v, str) and not v.strip():
            raise ValueError("instructions cannot be an empty string")
        return v

    @field_validator("criteria")
    def validate_criteria_levels(cls, v):
        if not (2 <= len(v) <= 10):
            raise ValueError(f"Score criteria must have between 2 and 10 levels, got {len(v)}")
        return v


QuestionType = Union[NoulQuestion, ChoiceQuestion, ScoreQuestion]


class Base64ImageObject(BaseModel):
    content_type: str = Field(..., description="image/png, image/jpeg, or image/webp.")
    base64: str = Field(..., description="Base64-encoded image bytes.")

    @field_validator("content_type")
    def validate_content_type(cls, v):
        allowed = {"image/png", "image/jpeg", "image/webp"}
        if v.lower() not in allowed:
            raise ValueError(f"content_type must be one of {allowed}, got {v}")
        return v


ImageItem = Union[str, Base64ImageObject]


class ClefDecisionRequest(BaseModel):
    model: str = Field(
        default="clef",
        description="Required. The model selector: 'clef' for @cf/cloudflare/clef, 'clef-flash' for @cf/cloudflare/clef-flash."
    )
    state: Union[str, Dict[str, Any], List[Any]] = Field(
        ...,
        description="Required. The content to evaluate: string, or structured data (records, chat logs, state)."
    )
    questions: Dict[str, QuestionType] = Field(
        ...,
        description="Map of question id to typed question (noul, choice, score). 1 to 64 questions."
    )
    images: Optional[List[ImageItem]] = Field(
        default=None,
        description="Optional embedded PNG, JPEG, or WebP images (max 4)."
    )

    @field_validator("model")
    def validate_model_name(cls, v):
        pattern = r"^\s*(clef|clef-flash)\s*$"
        if not re.match(pattern, v):
            raise ValueError(f"Model must match {pattern}, got '{v}'")
        return v.strip()

    @field_validator("questions")
    def validate_questions_count_and_keys(cls, v):
        if not (1 <= len(v) <= 64):
            raise ValueError(f"Questions map must contain between 1 and 64 questions, got {len(v)}")
        key_pattern = r"^[A-Za-z0-9_.-]{1,100}$"
        for key in v.keys():
            if not re.match(key_pattern, key):
                raise ValueError(f"Question id '{key}' does not match allowed pattern {key_pattern}")
        return v

    @field_validator("images")
    def validate_images(cls, v):
        if v is not None:
            if len(v) > 4:
                raise ValueError(f"Maximum of 4 images allowed, got {len(v)}")
            for item in v:
                if isinstance(item, str):
                    if not re.match(r"^[Dd][Aa][Tt][Aa]:", item):
                        raise ValueError("String image must be a valid Data URL starting with data:")
        return v
