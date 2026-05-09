"""Prompt templates for advisor / brainstorm task kinds."""

ADVISOR_TEMPLATE = """You are an advisor. The user has a question or problem below. \
Respond with structured advice as JSON with exactly these keys:
- "summary": one-paragraph overview
- "options": array of {{"name", "rationale", "tradeoffs"}}
- "recommendation": which option you'd pick and why
- "next_steps": array of 3-5 concrete next actions

Output ONLY the JSON. No prose before or after.

USER QUESTION:
{user_prompt}
"""

BRAINSTORM_TEMPLATE = """You are a brainstorm planner. The user has a goal below. \
Decompose it into exactly 3 follow-up actions that, executed in sequence, would \
deliver the goal. Respond as JSON:
- "summary": one-paragraph overview of the plan
- "actions": array of EXACTLY 3 objects, each with:
    - "name": short slug (lowercase, hyphens, max 30 chars)
    - "prompt": the full prompt the executor will run for this action
    - "tools": comma-separated allowed tools (default "Read,Bash,Edit,Write")

Output ONLY the JSON. No prose before or after.

USER GOAL:
{user_prompt}
"""


def wrap_prompt(kind: str, user_prompt: str) -> str:
    if kind == "advisor":
        return ADVISOR_TEMPLATE.format(user_prompt=user_prompt)
    if kind == "brainstorm":
        return BRAINSTORM_TEMPLATE.format(user_prompt=user_prompt)
    return user_prompt
