# Derya Freight OS — Demo Story

A 4-minute walkthrough script that hits the wow moments end-to-end.

## The deal

**One umbrella deal threads the whole video:** *Soybean meal procurement — 300 MT to Ashgabat.*
Multiple suppliers in different countries replied to your RFQ. The platform reads each reply, extracts terms, ranks them, drafts negotiation emails, and once you award a winner, automatically spins up the forwarding job for the actual shipment.

Set this up before recording: tell the agent
> consolidate all open procurement under one deal — 300 MT soybean meal to Ashgabat

## Scene 1 — Inbox arrives, AI does triage (45s)

**Open:** `/dashboard/inbox`

**Voiceover:** "An operator at a freight forwarding office gets dozens of emails per day — RFQs, supplier offers, carrier replies, customs docs, and a lot of noise. Without context, they're a queue of 100s. With context, they're a workflow."

**Click:** **Sync now** (or skip — cron auto-syncs every 15 min, you can mention this).

**Show:**
- The Active filter badge ticks up
- AI auto-classifies and links — the "Linked to a load" count grows
- Hidden noise (security alerts, banking notifications) silently drops out

**Soundbite:** "47 new emails landed. 38 already linked themselves to active deals. The 9 unlinked are real new RFQs."

## Scene 2 — One procurement deal, four supplier replies (60s)

**Click:** the soybean meal procurement card → opens `/dashboard/rfq/<id>`.

**Show:** the **Sourcing offers** comparison table.
- 4 supplier rows side-by-side: ORLAZUL, ARYAVRT, HONEY OTOMOTIV, others
- Cheapest priced offer highlighted with **BEST** chip
- Per-row buttons: **Award**, **AI reply**, **Counter**

**Voiceover:** "Each supplier email got parsed. Price per MT, qty available, incoterms, payment terms, lead time, sample availability — all pulled out and ranked side-by-side. The operator sees the deal not the inbox."

**Click:** the `+ freight` input, type `45` (USD/MT freight Constanta → Ashgabat).
**Show:** Landed column appears, table re-ranks. The cheapest unit-price supplier is now NOT the cheapest landed.
**Soundbite:** "Adding freight to the math flips the ranking."

## Scene 3 — Counter-offer in two clicks (40s)

**Click:** **Counter** on a high-priced supplier.
**Show:** the prompt — "What's your target?"
**Type:** `5% under best`
**Click:** Draft counter-offer.

**Show the modal:** AI-drafted polite counter-offer email referencing market context, asking for revised pricing by a date, no competitor numbers exposed.

**Voiceover:** "AI drafts the counter-offer. Operator edits, hits Send."
**Click:** **Send** (Gmail send via API, properly threaded).
**Show:** the modal closes, page refreshes — outbound message appears in the thread.

## Scene 4 — Award + auto-spinoff (45s)

**Click:** **Award** on the lowest-landed supplier.
**Confirm dialog appears.** Click confirm.

**Show:**
- Awarded chip appears on the row
- Inquiry status flips to WON
- Job advances to "Awarded"
- AI-drafted confirmation email to supplier opens in modal
- "Linked jobs" card on the procurement job now shows ↓ Spinoff

**Click:** the spinoff link → opens the new FORWARDING job.

**Voiceover:** "The procurement deal is closed. The platform doesn't stop — it spins up the forwarding job for the actual logistics, with origin already set to the supplier's port and destination set to Ashgabat."

## Scene 5 — Forwarding side, agent does the rest (60s)

On the new forwarding job, in the **agent chat** on the right rail:

**Type:** `populate the load details from the emails`
**Show:** AI extracts shipment details from the supplier email thread → fills in mode, weight, container type, ETD, ETA, cargo-ready date.

**Type:** `set ETD May 28 and ETA June 18`
**Show:** Job updated in real time.

**Type:** `mark this booked`
**Show:** Status pipeline advances. Customer auto-notified via Gmail (mention: customer gets an email with the live portal link).

**Click:** **Customer portal** button → modal with shareable URL.
**Click:** Copy or Open → public read-only page renders the pipeline, ETD/ETA, milestones.

**Voiceover:** "The customer never has to chase you for status. They get a magic link that's always current."

## Scene 6 — Daily ops, agent (30s)

Back to dashboard. In agent chat:

**Type:** `morning briefing`
**Show:** the digest — pending replies count, stuck jobs with AI next-actions, unawarded sourcing flagged for comparison, proposed jobs awaiting confirmation.

**Soundbite:** "The agent isn't a chatbot — it's a verb. It can merge inquiries, award suppliers, draft replies, populate fields, hide noise, log milestones. Every action it claims to take, it actually takes."

## Closing (15s)

**Voiceover:** "Derya Freight OS — your inbox knows what your jobs are. Your jobs know what your customers see. The operator focuses on judgment calls; the platform handles the typing."

---

## Technical setup before recording

1. **Run the consolidation:** ask the agent
   > consolidate all open procurement under one deal — 300 MT soybean meal to Ashgabat
   This collapses your existing soybean/corn-gluten/cottonseed/fish-meal threads into one umbrella SOURCING inquiry with the right specs.

2. **Reconnect Gmail** at `/dashboard/settings/email` if you haven't yet (new `gmail.send` scope).

3. **Pre-extract supplier offers:** open the procurement RFQ → click **Re-extract with AI** so the comparison table has parsed fields ready.

4. **Have a second test inbox** to receive the customer status email demo (mark a milestone done → it sends to the original RFQ sender).

5. **Hide the demo office's noise:** in agent chat, type `hide unrelated` to clear newsletter/security/banking threads from the active view.

6. **Sample test data the demo uses:**
   - Procurement deal subject line: "Soybean meal procurement, 300 MT to Ashgabat"
   - Suppliers: 4 different ones, prices ranging 460–520 USD/MT
   - Origin: Brazil / Argentina / Black Sea
   - Destination: Ashgabat, TM (landlocked → road or rail leg)

## Things to avoid live

- **Don't** click `Discard` on a proposed job — destructive
- **Don't** click `Rotate link` on the portal — old link breaks instantly
- **Don't** click `Merge duplicates` mid-demo — show the result with the agent instead so the audience sees the verb in action

## Recording tips

- Record at 1440p+ — the supplier comparison table has small text
- Cursor highlight overlay helps audience follow clicks
- Pre-warm Vercel by hitting `/dashboard` once before recording (cold start is ~2s)
- Don't cut between scenes — the strength is the continuous narrative
