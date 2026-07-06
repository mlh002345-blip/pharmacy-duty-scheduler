# Pharmacy Duty Scheduler - Project Instructions

## Product Scope
This project is a B2B web application for Turkish pharmacist chambers.
The first MVP only manages pharmacy duty schedules.

It replaces manual Excel-based pharmacy duty scheduling with:
- pharmacy management
- region/district management
- duty rules
- unavailable dates
- automatic monthly duty schedule generation
- manual schedule editing
- audit logs
- fairness reports
- Excel/PDF exports
- public duty pharmacy page

## Strictly Out of Scope for MVP
Do not add:
- drug stock management
- medicine search
- citizen medicine availability search
- online medicine sales
- medicine reservation
- payment
- SMS integration
- WhatsApp integration
- mobile app
- marketplace
- pharmacy advertisement features
- AI agents
- advanced ERP features
- multi-tenant SaaS complexity unless explicitly requested later

## Tech Stack
Use:
- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- Prisma ORM
- SQLite for local MVP
- date-fns
- xlsx for Excel export

## Development Rules
- Keep the code clean, modular, and maintainable.
- Build step by step.
- Do not implement the full system at once.
- Before making large changes, summarize the plan.
- Prefer simple and reliable architecture over complex abstractions.
- Use Turkish labels in the UI.
- Use English for code, database models, functions, and file names.
- Use separate service files for business logic.
- Keep the duty scheduling algorithm testable.
- Every manual duty assignment change must be auditable.
- Do not delete or rewrite existing files without explaining why.

## MVP Priority
The first demo must support:
1. Admin dashboard
2. Pharmacy list
3. Region list
4. Duty rules
5. Holidays
6. Unavailable dates
7. Generate monthly duty schedule
8. Manual override
9. Fairness report
10. Excel/PDF export
11. Public duty pharmacy page

## Scheduling Algorithm Principles
The first algorithm should be rule-based, not AI-based.
It should:
- assign only active pharmacies
- assign only pharmacies in the selected region
- avoid unavailable dates
- respect minimum days between duties
- consider duty weights for weekdays, Saturdays, Sundays, official holidays, and religious holidays
- prefer pharmacies with the lowest total duty load
- generate fairness reports

## Business Positioning
The system is not a pharmacy sales platform.
It is a duty schedule management tool for pharmacist chambers.
