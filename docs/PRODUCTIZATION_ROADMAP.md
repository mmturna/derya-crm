# Derya CRM Productization Roadmap

This is the execution checklist to turn the current MVP into a product-grade CRM.
We will implement this gradually, step by step, and keep this file updated.

## Current status

- Product baseline works (auth, customers, company detail, admin, tasks, risk scan).
- UX is still mid-transition from MVP to product-grade.

## Step-by-step execution plan

### Step 1 - UI Foundation Hardening (in progress)

Goal: establish reusable UI patterns and remove ad-hoc page-by-page styling.

- [x] Create shared UI components (badges, section headers, stat cards, empty states).
- [x] Introduce semantic status styles (customer status, risk level, task status).
- [x] Refactor `Overview` and `Customers` pages to use shared components only.
- [x] Ensure responsive behavior is consistent across dashboard pages.
- [x] Run build and lint validation.

Deliverable:
- Unified and consistent visual language across top-level screens.

### Step 2 - Company 360 Experience

Goal: turn company detail into an actionable CRM workspace.

- [x] Rework company detail into clear sections (Summary, Timeline, Tasks, Quotes, Contacts).
- [x] Build unified timeline feed (activities + quotes + task changes).
- [x] Add prominent quick actions (log activity, create quote, create task, generate draft).
- [x] Improve owner assignment UX (clear primary owner, role-aware interaction).
- [x] Add risk panel with explainability and status history.

Deliverable:
- Company page feels like a true operational cockpit.

### Step 3 - Customer Operations at Scale

Goal: make customer pool usable for 50k-100k records.

- [x] Add server-driven pagination controls and page size options.
- [x] Add sortable columns and richer filter UX.
- [x] Add saved segments/views per user.
- [x] Add bulk actions (status/category/owner updates).
- [ ] Add list performance safeguards (query bounds and indexes review).

Deliverable:
- Fast and practical daily workflow for large customer pools.

### Step 4 - Workflow Automation and Alerts

Goal: convert passive data into guided action.

- [ ] Add risk rule settings per office (thresholds and channels).
- [ ] Add persisted alert lifecycle (open, snooze, resolve, reopen).
- [ ] Add task automation from risk triggers.
- [ ] Add manager summary view (team risk + overdue tasks).

Deliverable:
- CRM proactively guides reps and managers.

### Step 5 - Communication Layer (Email/Audio)

Goal: support real customer communication workflows.

- [ ] Implement email provider abstraction (prepare Google/Microsoft connectors).
- [ ] Link generated draft emails to activity timeline with status.
- [ ] Add audio file handling pipeline and transcript storage model.
- [ ] Improve meeting-note generation templates and audit trail.

Deliverable:
- Communication interactions become first-class CRM records.

### Step 6 - Production Readiness

Goal: make the system deployable and maintainable.

- [ ] Add role/permission guard coverage for all server actions.
- [ ] Add end-to-end smoke tests for critical flows.
- [ ] Add seed scenarios for demo storytelling.
- [ ] Improve docs for install/run/deploy and handover.

Deliverable:
- Reliable demo/prod candidate with predictable behavior.

## Execution log

- 2026-03-30: Roadmap created.
- 2026-03-30: Started Step 1 implementation.
- 2026-03-30: Added reusable UI primitives and applied them to Overview + Customers.
- 2026-03-30: Refactored Company Detail, Admin, and Login screens to use the shared product UI system.
- 2026-03-30: Started Step 2 with Company 360 summary panel + unified timeline.
- 2026-03-30: Completed Step 2 quick-actions pass with role-aware ownership controls and risk history.
- 2026-03-30: Started Step 3 with server pagination, sorting, saved views, and bulk status updates.
- 2026-03-30: Visual sprint pass: premium styling system, dashboard insight cards, toolbar UX, and card-based timeline.

