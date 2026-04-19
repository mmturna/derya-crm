# Derya CRM - Project Context

This file captures the product context provided by the stakeholder and the implementation decisions made so far.

## Business Goal

Build a CRM demo for freight forwarding sales/customer follow-up. Initial focus is customer relationship management and activity tracking, with architecture ready for later Siber integration.

## Source Notes (translated summary)

- Large customer pool (50k-100k) must be manageable and segmentable.
- Core tracking: customer status, location/region, visits, sales assignment.
- Activity channels: visit, call, email; WhatsApp later.
- Audio upload, speech-to-text, and concise note generation.
- Email integration and auto-reply draft generation.
- Quote history with positive/negative outcomes.
- Sales rep assignment and assignment change history.
- Smart alerts: detect untouched customers or stopped communication and notify sales + management.
- Phase 1 has no full Siber integration, but system should be designed for Phase 2 data bridge.
- Freight-forwarding context: future data includes customer + load/shipment information.

## Confirmed Product Decisions

1. **Users & scale**
   - Start with one office.
   - About 10 users per office.
   - Multiple offices in future.

2. **Tenant model**
   - Offices are isolated from each other.

3. **Visibility**
   - "Own accounts only" vs "whole office pool" should be configurable (to implement in auth/permission layer).

4. **Data model**
   - Company with multiple contacts (contact points).
   - Multiple sales owners per company are allowed.

5. **Segmentation**
   - One value per category for now.
   - Customer can be classified across multiple categories simultaneously.
   - Category management by admin only (for now).

6. **Quotes**
   - Quote history is enough for MVP (no full pipeline yet).

7. **Email**
   - A mix of draft generation and activity logging.
   - Provider decision deferred.

8. **Deployment**
   - Server-hosted.
   - Keep setup simple for now.

9. **UI language**
   - English first.

10. **Local dev preference**
    - No Docker setup for now.

## MVP Scope (Current Build Direction)

### Phase 1 MVP

- Office-isolated CRM foundation
- Credentials login
- Customer pool with filtering
- Structured categories (one value per category)
- Company + contacts
- Activity tracking (visit/call/email)
- Multi-owner assignments + change history
- Quote history
- Rule-based risk signals (basic)
- Admin panel: category dictionary + user visibility controls
- Company detail screen with inline create flows (contacts/activities/quotes/owners)
- Draft email generation and structured meeting-note generation from transcript text (MVP assistant behavior)

### Phase 1.1 / Next

- Audio upload -> transcription -> meeting note summary
- Better email sync and threaded activity link
- Risk alert notification channels (in-app/email)

### Phase 2 (Siber Bridge)

- Integrate customer + load/shipment data
- Use historical profitability/load signals to guide sales actions
- Keep integration contract-oriented (ETL/API details pending)

## Current Technical Baseline

- Next.js + TypeScript app
- Prisma + SQLite (local demo) data layer
- Cookie-based credentials session for demo
- Seeded demo office/users/sample companies
- Customer detail workflow implemented (contacts, activities, quote history, owner updates)
- Admin panel implemented for category dictionary + user visibility toggles

## Open Decisions

- Exact office visibility policy details per role (Admin/Manager/Sales).
- Category dictionary definitions and controlled vocabulary.
- Email provider and depth of sync in MVP.
- Rule thresholds for risk alerts.
- Siber integration method (API vs scheduled imports vs DB bridge).

## How to update this file

When new decisions are made:

1. Append to **Confirmed Product Decisions**.
2. Move resolved items out of **Open Decisions**.
3. If scope shifts, update **MVP Scope** and **Phase 2** sections.

