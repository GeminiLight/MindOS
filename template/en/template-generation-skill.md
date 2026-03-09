# Template Generation Skill

This document captures the execution playbook for generating and evolving templates under `template/`.

## Core Principles

- Keep `zh/` and `en/` semantically aligned.
- Keep structure isomorphic across languages.
- Rule priority: root `INSTRUCTION.md` > subdirectory `INSTRUCTION.md` > `README.md` > content files.
- `_example` / `_examples` files are examples only, not production user data.
