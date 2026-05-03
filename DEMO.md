# Derya Freight OS — Demo

## Real data vs dummy data?

**Use dummy data for the demo video.** Reasons:

- Real Gmail has noise (security alerts, newsletters, bills) that doesn't tell a story.
- Real threads aren't curated — supplier prices not parsed cleanly, missing ETAs, etc.
- A demo needs a tight narrative arc; dummy data gives you full control of every beat.
- Mention once on camera: *"this works on your real Gmail too — it's the same pipeline"* — that's enough to imply scale.

**Use real data only** if your company is bidding for a specific procurement contract and the audience wants to see THEIR commodity end-to-end. Otherwise dummy.

You can have both: a polished 60s dummy-data video for marketing, and a longer "here's our actual pipeline" for sales follow-ups.

---

# 60-second script — Automated FORWARDING engine

A customer asks for a shipping rate. The platform handles ingestion, carrier RFQs, rate comparison, booking, milestone tracking, and customer updates. Operator clicks ~5 times.

## Pre-record setup (one-time, in agent chat)

```
consolidate all open forwarding under one deal — 1x40HC Constanta to Hamburg, electronics
```

Then `hide unrelated` to clear noise.

---

## Script (60s, single take)

**0:00 — Customer RFQ arrives**
*(Open `/dashboard/inbox`)*
> "A customer emails asking for a Constanta-to-Hamburg rate. The AI reads it, classifies it as an RFQ, parses origin/destination/weight/incoterms, and creates the load."

Click the just-arrived RFQ thread → opens `/dashboard/rfq/<id>`. Show the parsed fields already filled in.

**0:08 — Convert to job + carrier outreach**
Click **Create Job from RFQ**. Job appears in the **Forwarding** kanban under *Inquiry*.

In the agent chat (right rail):
> request rates from Maersk, MSC, and CMA CGM

> "AI drafts three carrier RFQ emails — same load, polite tone, asks for 40HC + transit. Operator approves, hits send. Three emails go out via Gmail."

**0:20 — Rates flow in**
Skip 30 seconds of "imaginary time." *(In the demo, replies are pre-seeded.)*
> "Carriers reply over the next hour. Each reply is auto-classified, the rate is extracted, and added to the job's rate table."

Open the job. Show **Carrier rates** card with three rows ranked by total cost — fastest transit shown alongside.

In agent:
> summarize rates

Agent ranks them, flags the cheapest as **BEST**.

**0:32 — Pick winner + customer quote**
> select MSC

> "MSC selected. Job moves to Quoted. AI drafts the customer quote email with markup applied — operator can edit margin."

Click **Send quote PDF** (or accept the AI-drafted quote email). Job advances to *Quoted*.

**0:42 — Booked + customer portal**
Customer accepts (pre-seed an inbound "yes proceed" email).

> mark this booked

Job moves to *Booked*. **Customer auto-emailed** with the live portal link. Click **Customer portal** button → public read-only page renders pipeline + ETD/ETA.

**0:50 — Milestones + docs**
> log BL issued today

Milestone confirmed. Customer gets another auto-email. Drop a `BL.pdf` into the email thread (pre-seeded) — it auto-classifies and attaches to the job's BL slot.

**0:56 — Close**
> "Operator clicked five times. The platform handled ingestion, three carrier RFQs, rate comparison, customer quote, booking, milestones, customer notifications, and document classification."

> "**One operator can run 50 loads instead of 10.**"

---

## Don't click live

- **Discard** (destructive)
- **Rotate link** (breaks shared URLs)
- **Merge duplicates** mid-demo

## Recording tips

- 1440p+ (table text is small)
- Pre-warm Vercel: hit `/dashboard` once before recording
- Cursor highlight overlay
- Single take — the strength is the continuous narrative
