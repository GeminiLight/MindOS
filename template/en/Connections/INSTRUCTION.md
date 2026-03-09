# Connections Instruction

This directory stores reusable relationship context for agent collaboration.

## Purpose

- Help agents understand people context before drafting messages, planning follow-ups, or suggesting introductions.
- Keep relationship memory structured, factual, and privacy-safe.

## Scope

- `Family/`: family members and close household context.
- `Friends/`: personal friends and trusted peers.
- `Classmates/`: school, cohort, and alumni relationships.
- `Colleagues/`: professional contacts across teams and companies.
- `Mentors/`: senior mentors, advisors, and role models.

## Entry Format

Each category is maintained in its own `README.md`.
Use one section per person with this minimum schema:

- `Name`
- `Relationship`
- `Current Role`
- `Location`
- `Communication Preference`
- `Last Interaction`
- `Next Action`
- `Notes`

## Writing Rules

- Prefer facts over opinions; avoid vague labels.
- Keep notes short and actionable.
- Update `Last Interaction` and `Next Action` after important conversations.
- If a person belongs to multiple categories, keep the primary record in one folder and cross-reference in others.

## Privacy Rules

- Do not store passwords, private keys, IDs, bank information, or sensitive medical details.
- Avoid highly sensitive personal details unless strictly required.
- Assume this content may be used by multiple agents; keep only necessary context.

## Maintenance

- Keep folder names stable for predictable agent retrieval.
- Add new categories only when recurring use justifies it.
- If you rename/move files, update all related references.
