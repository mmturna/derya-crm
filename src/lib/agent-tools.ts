// Server-only module (NOT a "use server" file — that directive only allows
// async-function exports, but we also export the TOOLS array constant).
// The functions here are called from within other server actions, so they
// run server-side regardless.
import "server-only";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { mergeAllOpenInquiriesIntoOne, consolidateDuplicateInquiries } from "./merge-actions";
import { populateJobFromEmails } from "./job-populate";
import { awardSupplier, draftReplyToMessage, draftCounterOffer } from "./sourcing-award";
import { extractSourcingOffersForInquiry } from "./sourcing-offers";
import { findStuckJobs } from "./stuck-jobs";
import { seedDemoLoad } from "./seed-demo-load";
import { analyzeJobDocument } from "./doc-analyze";
import {
  applyEditJob, applyMoveStage, applyAddMilestone,
  applySetCustomer, applyRenameCompany, applyEditInquiry,
  applySetMoney, applyAddQuoteLine, applyDeleteJob,
} from "./agent-actions";

// Tool schemas matching Anthropic's tool-use spec. Each has a strict
// input_schema so Claude knows exactly what arguments are valid.
export const TOOLS = [
  // ── Lookups ────────────────────────────────────────────────────────────────
  {
    name: "search_jobs",
    description: "Search the user's jobs by free-text. Matches reference, origin, destination, commodity, customer name, or notes.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search query" },
        type: { type: "string", enum: ["SOURCING", "FORWARDING"], description: "Optional type filter" },
        status: { type: "string", description: "Optional status filter (PROPOSED/INQUIRY/QUOTED/BOOKED/IN_TRANSIT/CUSTOMS/DELIVERED)" },
        limit: { type: "number", description: "Max results, default 10" },
      },
      required: ["q"],
    },
  },
  {
    name: "search_inquiries",
    description: "Search RFQs/inquiries by subject, commodity, sender, or route.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string" },
        type: { type: "string", enum: ["SOURCING", "FORWARDING"] },
        limit: { type: "number" },
      },
      required: ["q"],
    },
  },
  {
    name: "search_companies",
    description: "Search customer/company records by name.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string" },
        limit: { type: "number" },
      },
      required: ["q"],
    },
  },
  {
    name: "search_email_threads",
    description: "Full-text search across email threads — subjects, bodies, sender names/emails.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string" },
        only_unlinked: { type: "boolean", description: "Only threads not linked to a job/inquiry" },
        limit: { type: "number" },
      },
      required: ["q"],
    },
  },
  {
    name: "get_job",
    description: "Fetch full details of one job: status, customer, route, milestones, supplier offers (if SOURCING) or carrier quotes (if FORWARDING), linked inquiry, documents.",
    input_schema: {
      type: "object",
      properties: { job_id: { type: "string" } },
      required: ["job_id"],
    },
  },
  {
    name: "list_open_inquiries",
    description: "List inquiries currently in active statuses (INGESTED/PARSED/PRICED/QUOTED).",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["SOURCING", "FORWARDING"] },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "list_threads_awaiting_reply",
    description: "List email threads where the latest message is INBOUND (no outbound reply yet) — i.e. waiting on the operator.",
    input_schema: { type: "object", properties: { limit: { type: "number" } } },
  },
  {
    name: "list_stuck_jobs",
    description: "Active jobs that haven't moved in N+ days. Returns each with an AI-suggested next action.",
    input_schema: {
      type: "object",
      properties: {
        days_threshold: { type: "number", description: "How many days idle counts as stuck. Default 5." },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "morning_briefing",
    description: "Aggregate snapshot: pending replies, unawarded sourcing inquiries, stuck jobs with next-actions, proposed-stage jobs awaiting confirm.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "summarize_supplier_offers",
    description: "For a SOURCING job, list every linked thread's supplier offer, ranked by price (cheapest first). Auto-extracts offers from emails if they haven't been parsed. Use this when the operator asks about prices, rates, or supplier comparison on a procurement job.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Job to summarize. Defaults to the focused job if omitted." },
      },
    },
  },
  {
    name: "summarize_carrier_rates",
    description: "For a FORWARDING job, list received carrier rates ranked by total cost. Use when operator asks about rates on a shipping/forwarding job.",
    input_schema: {
      type: "object",
      properties: { job_id: { type: "string" } },
    },
  },

  // ── Mutations ──────────────────────────────────────────────────────────────
  {
    name: "merge_inquiries_into_one",
    description: "Consolidate multiple open inquiries into ONE umbrella job. Use when the operator says 'merge them', 'they're all the same', 'consolidate', 'group these', etc. Optionally accepts deal specs for the keeper.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["SOURCING", "FORWARDING"], description: "Filter to merge only this type" },
        subject: { type: "string", description: "Override the AI-generated subject for the keeper" },
        commodity: { type: "string" },
        origin: { type: "string" },
        destination: { type: "string" },
        weight_kg: { type: "number", description: "Total weight in kilograms" },
      },
    },
  },
  {
    name: "dedup_inquiries",
    description: "AI clusters open inquiries by similarity and merges duplicates. Use when operator says 'find duplicates', 'dedupe'. Different from merge_inquiries_into_one — this only collapses near-identical records, not all records into one.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "populate_job_from_emails",
    description: "Walks every email thread linked to the focused job and fills missing fields (origin, destination, mode, weight, ETD, ETA, commodity, etc) from email content.",
    input_schema: { type: "object", properties: { job_id: { type: "string" } } },
  },
  {
    name: "award_supplier",
    description: "Mark a SOURCING supplier as the winner. Advances job to 'Awarded', sets cost from their offer, drafts a confirmation email, and auto-creates a child FORWARDING job for the actual shipment.",
    input_schema: {
      type: "object",
      properties: {
        thread_id: { type: "string", description: "EmailThread id of the winning supplier. If omitted, uses cheapest priced thread on the focused job." },
        supplier_hint: { type: "string", description: "Partial supplier name for fuzzy match (e.g. 'orlazul'). Used only if thread_id omitted." },
        job_id: { type: "string" },
      },
    },
  },
  {
    name: "draft_reply",
    description: "Draft an email reply to the latest inbound message on a thread. Operator can pass intent like 'ask for sample' or 'accept the offer'.",
    input_schema: {
      type: "object",
      properties: {
        thread_id: { type: "string", description: "Defaults to most recent thread on the focused job" },
        intent: { type: "string", description: "Stance/instruction for the AI drafter" },
      },
    },
  },
  {
    name: "draft_counter_offer",
    description: "Draft a polite counter-offer email to a SOURCING supplier. Uses market context from sibling supplier offers but never names competitors.",
    input_schema: {
      type: "object",
      properties: {
        thread_id: { type: "string" },
        target: { type: "string", description: "Target price or instruction (e.g. '$480/MT', '5% under best', 'match cheapest')" },
      },
      required: ["target"],
    },
  },
  {
    name: "extract_supplier_offers",
    description: "Re-run AI extraction over every supplier thread on a SOURCING inquiry. Updates the persisted offer parsing.",
    input_schema: {
      type: "object",
      properties: { inquiry_id: { type: "string" } },
    },
  },
  {
    name: "edit_job",
    description: "Update fields on a job. ANY of these can be set: origin, destination, mode (SEA-FCL/SEA-LCL/AIR/ROAD/COURIER), incoterms, commodity, weight (kg), volume (cbm), packages, etd (YYYY-MM-DD), eta, currency (USD/EUR/GBP/TRY), notes.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        fields: { type: "object", description: "Fields to update" },
      },
      required: ["fields"],
    },
  },
  {
    name: "edit_inquiry",
    description: "Update fields on an inquiry: origin, destination, mode, incoterms, commodity, weight, volume, subject, fromEmail, fromCompany.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Edits the inquiry linked to this job" },
        fields: { type: "object" },
      },
      required: ["fields"],
    },
  },
  {
    name: "move_job_stage",
    description: "Change a job's status. Valid statuses: PROPOSED, INQUIRY, QUOTED, BOOKED, IN_TRANSIT, CUSTOMS, DELIVERED, CANCELLED.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        status: { type: "string" },
      },
      required: ["status"],
    },
  },
  {
    name: "add_milestone",
    description: "Add or update a job milestone. Type one of: BOOKING, CARGO_READY, ETD, ETA, CUSTOMS_ENTRY, CUSTOMS_RELEASE, DELIVERY.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        type: { type: "string" },
        planned_at: { type: "string", description: "YYYY-MM-DD" },
        actual_at: { type: "string", description: "YYYY-MM-DD when this milestone was actually hit" },
        note: { type: "string" },
      },
      required: ["type"],
    },
  },
  {
    name: "set_customer",
    description: "Link a customer (Company) to a job. Creates the company if it doesn't exist (case-insensitive name match against existing companies).",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        company_name: { type: "string" },
        create_if_missing: { type: "boolean", description: "Default true" },
      },
      required: ["company_name"],
    },
  },
  {
    name: "rename_job",
    description: "Rename / re-title a job. The job's reference (e.g. JOB-2026-003) is the immutable ID — you cannot change it — but you CAN change the displayed deal name by updating the linked Inquiry's subject. Most UI surfaces show that subject as the job's title, so this is the right tool when the operator says 'rename this job to X', 'call this deal X', 'title it X', 'change the job name to X'.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Defaults to focused job" },
        new_title: { type: "string", description: "New deal name / subject" },
      },
      required: ["new_title"],
    },
  },
  {
    name: "rename_company",
    description: "Rename the customer/company already linked to a job. Affects every job linked to this customer. Refuses if a different company already has the new name.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        new_name: { type: "string" },
      },
      required: ["new_name"],
    },
  },
  {
    name: "set_revenue",
    description: "Set the customer-facing revenue (price quoted to customer) on a job.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string", enum: ["USD", "EUR", "GBP", "TRY"] },
      },
      required: ["amount"],
    },
  },
  {
    name: "set_cost",
    description: "Set the cost (carrier/supplier expense) on a job.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string", enum: ["USD", "EUR", "GBP", "TRY"] },
      },
      required: ["amount"],
    },
  },
  {
    name: "add_quote_line",
    description: "Append a line item (description + amount) to a job's quote.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        description: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string", enum: ["USD", "EUR", "GBP", "TRY"] },
      },
      required: ["description", "amount"],
    },
  },
  {
    name: "hide_unrelated_threads",
    description: "Bulk-hide unlinked email threads classified as not freight-related (newsletters, security alerts, banking notifications).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "link_threads_to_job",
    description: "Find email threads matching a query and link them all to the focused job's inquiry. If `q` is omitted, the tool derives search terms automatically from the job itself (commodity name, origin/destination, customer name, customer email domain). Use this when the operator says 'attach related emails', 'why aren't offers showing up', 'find related threads', or 'pull in the supplier emails for this load'.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Optional override search query. Leave empty to auto-derive from the job's commodity/route/customer." },
        job_id: { type: "string", description: "Defaults to focused job" },
        only_unlinked: { type: "boolean", description: "Default true — skip threads already linked elsewhere" },
        limit: { type: "number", description: "Max threads to link, default 50" },
      },
    },
  },
  {
    name: "seed_demo_load",
    description: "Seeds one fully-populated example FORWARDING job for demos: customer 'Black Sea Trading Co', steel coils Constanta → Hamburg, 3 carrier rates, milestones, 3 docs (BL + Invoice + Packing List) with pre-baked AI analysis, portal token. Idempotent — returns the existing demo job if already seeded. Use when the operator says 'seed a demo load', 'create an example job', 'set up demo data'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "analyze_document",
    description: "Re-run AI analysis on a JobDocument: fetches the PDF, extracts text, generates a 1-3 sentence summary + flags any discrepancies + extracts key fields (BL number, weights, dates). Use when operator approves a doc or asks 'what does this BL say' / 'are there issues with this invoice'.",
    input_schema: {
      type: "object",
      properties: {
        document_id: { type: "string" },
        force: { type: "boolean", description: "Re-analyze even if already done recently" },
      },
      required: ["document_id"],
    },
  },
  {
    name: "delete_job",
    description: "Permanently delete a job. ONLY call this when the user explicitly says delete/remove/kill. Destructive.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        confirm: { type: "boolean" },
      },
      required: ["confirm"],
    },
  },
] as const;

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export type ToolContext = {
  officeId: string;
  scopeJobId?: string;
};

export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  // Resolve job_id helper — falls back to scope.
  const jobId = (input.job_id as string | undefined) ?? ctx.scopeJobId;

  try {
    switch (name) {
      case "search_jobs": {
        const q = String(input.q ?? "");
        const limit = Math.min(50, Number(input.limit ?? 10));
        const where: any = { officeId: ctx.officeId };
        if (input.type) where.type = String(input.type);
        if (input.status) where.status = String(input.status);
        const rows = await prisma.job.findMany({
          where: {
            ...where,
            OR: q ? [
              { reference: { contains: q, mode: "insensitive" } },
              { origin: { contains: q, mode: "insensitive" } },
              { destination: { contains: q, mode: "insensitive" } },
              { commodity: { contains: q, mode: "insensitive" } },
              { notes: { contains: q, mode: "insensitive" } },
              { company: { name: { contains: q, mode: "insensitive" } } },
            ] : undefined,
          },
          select: {
            id: true, reference: true, type: true, status: true,
            origin: true, destination: true, commodity: true,
            company: { select: { name: true } },
          },
          take: limit, orderBy: { updatedAt: "desc" },
        });
        return { ok: true, result: rows };
      }
      case "search_inquiries": {
        const q = String(input.q ?? "");
        const limit = Math.min(50, Number(input.limit ?? 10));
        const where: any = { officeId: ctx.officeId };
        if (input.type) where.type = String(input.type);
        const rows = await prisma.inquiry.findMany({
          where: {
            ...where,
            OR: q ? [
              { subject: { contains: q, mode: "insensitive" } },
              { commodity: { contains: q, mode: "insensitive" } },
              { fromEmail: { contains: q, mode: "insensitive" } },
              { origin: { contains: q, mode: "insensitive" } },
              { destination: { contains: q, mode: "insensitive" } },
            ] : undefined,
          },
          select: { id: true, subject: true, type: true, status: true, commodity: true, origin: true, destination: true, fromEmail: true },
          take: limit, orderBy: { receivedAt: "desc" },
        });
        return { ok: true, result: rows };
      }
      case "search_companies": {
        const q = String(input.q ?? "");
        const rows = await prisma.company.findMany({
          where: { officeId: ctx.officeId, name: { contains: q, mode: "insensitive" } },
          select: { id: true, name: true, status: true },
          take: Math.min(50, Number(input.limit ?? 10)),
        });
        return { ok: true, result: rows };
      }
      case "search_email_threads": {
        const q = String(input.q ?? "");
        const rows = await prisma.emailThread.findMany({
          where: {
            officeId: ctx.officeId,
            ...(input.only_unlinked ? { jobId: null, inquiryId: null } : {}),
            OR: [
              { subject: { contains: q, mode: "insensitive" } },
              { messages: { some: { OR: [
                { bodyText: { contains: q, mode: "insensitive" } },
                { fromEmail: { contains: q, mode: "insensitive" } },
                { fromName: { contains: q, mode: "insensitive" } },
              ] } } },
            ],
          },
          select: { id: true, subject: true, messageCount: true, lastMessageAt: true, jobId: true, inquiryId: true },
          take: Math.min(30, Number(input.limit ?? 10)),
          orderBy: { lastMessageAt: "desc" },
        });
        return { ok: true, result: rows };
      }
      case "get_job": {
        if (!jobId) return { ok: false, error: "No job_id and no focused job" };
        const job = await prisma.job.findFirst({
          where: { id: jobId, officeId: ctx.officeId },
          include: {
            company: { select: { name: true } },
            inquiry: { include: {
              carrierQuotes: true,
              emailThreads: { include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } } },
            } },
            milestones: true,
            documents: true,
          },
        });
        if (!job) return { ok: false, error: "Job not found" };
        // Slim result for token budget
        const offers = (job.inquiry?.emailThreads ?? []).map((t) => {
          let o: any = {};
          try { if (t.supplierOffer) o = JSON.parse(t.supplierOffer); } catch {}
          return {
            thread_id: t.id,
            subject: t.subject,
            supplier: o.supplierName ?? null,
            price: o.pricePerUnit ?? null,
            currency: o.currency ?? null,
            unit: o.unit ?? null,
            qty: o.qtyAvailable ?? null,
            incoterms: o.incoterms ?? null,
            origin: o.origin ?? null,
            lead_time: o.leadTime ?? null,
            payment_terms: o.paymentTerms ?? null,
            awarded: !!t.awardedAt,
          };
        });
        return {
          ok: true,
          result: {
            id: job.id, reference: job.reference, type: job.type, status: job.status,
            customer: job.company?.name ?? null,
            origin: job.origin, destination: job.destination, mode: job.mode,
            commodity: job.commodity, weight: job.weight, volume: job.volume,
            etd: job.etd, eta: job.eta,
            revenue: job.revenue, cost: job.cost, currency: job.currency,
            inquiry_id: job.inquiryId,
            supplier_offers: job.type === "SOURCING" ? offers : undefined,
            carrier_quotes: job.type === "FORWARDING" ? job.inquiry?.carrierQuotes.map((q) => ({
              carrier: q.carrier, status: q.status, total_40hc: q.total40HC, total_40: q.total40, total_20: q.total20, transit_days: q.transitDays, service: q.service,
            })) : undefined,
            milestones: job.milestones.map((m) => ({ type: m.type, planned: m.plannedAt, actual: m.actualAt })),
            documents: job.documents.map((d) => ({ name: d.name, type: d.docType, status: d.status })),
          },
        };
      }
      case "list_open_inquiries": {
        const where: any = { officeId: ctx.officeId, status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] } };
        if (input.type) where.type = String(input.type);
        const rows = await prisma.inquiry.findMany({
          where,
          select: { id: true, subject: true, type: true, commodity: true, origin: true, destination: true, status: true },
          take: Math.min(50, Number(input.limit ?? 20)),
          orderBy: { receivedAt: "desc" },
        });
        return { ok: true, result: rows };
      }
      case "list_threads_awaiting_reply": {
        const cands = await prisma.emailThread.findMany({
          where: { officeId: ctx.officeId, hiddenAt: null },
          include: {
            messages: { orderBy: { sentAt: "desc" }, take: 1 },
            job: { select: { reference: true } },
            inquiry: { select: { subject: true } },
          },
          orderBy: { lastMessageAt: "desc" },
          take: 100,
        });
        const awaiting = cands.filter((t) => t.messages[0]?.direction === "INBOUND")
          .slice(0, Math.min(20, Number(input.limit ?? 10)))
          .map((t) => ({
            thread_id: t.id, subject: t.subject,
            last_from: t.messages[0].fromName ?? t.messages[0].fromEmail,
            last_at: t.messages[0].sentAt,
            linked_to: t.job?.reference ?? t.inquiry?.subject ?? null,
          }));
        return { ok: true, result: awaiting };
      }
      case "list_stuck_jobs": {
        const stuck = await findStuckJobs(ctx.officeId, {
          daysThreshold: Number(input.days_threshold ?? 5),
          max: Math.min(20, Number(input.limit ?? 8)),
        });
        return { ok: true, result: stuck };
      }
      case "morning_briefing": {
        const [needsReply, stuck, unawardedSourcing, openProposed] = await Promise.all([
          prisma.emailThread.findMany({
            where: { officeId: ctx.officeId, hiddenAt: null, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }] },
            include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } },
            take: 100,
          }),
          findStuckJobs(ctx.officeId, { daysThreshold: 5, max: 5 }),
          prisma.inquiry.findMany({
            where: { officeId: ctx.officeId, type: "SOURCING", status: { in: ["PARSED", "PRICED", "QUOTED"] } },
            include: { _count: { select: { emailThreads: true } } },
            take: 20,
          }),
          prisma.job.count({ where: { officeId: ctx.officeId, status: "PROPOSED" } }),
        ]);
        const awaiting = needsReply.filter((t) => t.messages[0]?.direction === "INBOUND").length;
        return {
          ok: true,
          result: {
            proposed_jobs_awaiting_confirm: openProposed,
            threads_awaiting_reply: awaiting,
            open_sourcing_inquiries: unawardedSourcing.length,
            sourcing_with_multiple_offers: unawardedSourcing.filter((i) => i._count.emailThreads >= 2).length,
            stuck_jobs: stuck,
          },
        };
      }
      case "summarize_supplier_offers": {
        if (!jobId) return { ok: false, error: "No job in scope" };
        const job = await prisma.job.findFirst({
          where: { id: jobId, officeId: ctx.officeId },
          include: {
            inquiry: { include: { emailThreads: { include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } } } } },
          },
        });
        if (!job?.inquiry) return { ok: false, error: "Job has no linked inquiry" };
        if (job.type !== "SOURCING") return { ok: false, error: "Not a SOURCING job" };
        const parsedCount = job.inquiry.emailThreads.filter((t) => !!t.supplierOffer).length;
        if (parsedCount < job.inquiry.emailThreads.length / 2) {
          try { await extractSourcingOffersForInquiry(job.inquiry.id); } catch {}
        }
        const reread = await prisma.emailThread.findMany({ where: { inquiryId: job.inquiry.id } });
        const offers = reread.map((t) => {
          let o: any = {};
          try { if (t.supplierOffer) o = JSON.parse(t.supplierOffer); } catch {}
          return {
            thread_id: t.id,
            supplier: o.supplierName ?? t.subject,
            price: o.pricePerUnit ?? null,
            currency: o.currency ?? null,
            unit: o.unit ?? null,
            qty: o.qtyAvailable ?? null,
            incoterms: o.incoterms ?? null,
            origin: o.origin ?? null,
            lead_time: o.leadTime ?? null,
            payment_terms: o.paymentTerms ?? null,
            awarded: !!t.awardedAt,
          };
        });
        offers.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
        return { ok: true, result: { commodity: job.inquiry.commodity, destination: job.destination, offers } };
      }
      case "summarize_carrier_rates": {
        if (!jobId) return { ok: false, error: "No job in scope" };
        const job = await prisma.job.findFirst({
          where: { id: jobId, officeId: ctx.officeId },
          include: { inquiry: { include: { carrierQuotes: { orderBy: { createdAt: "asc" } } } } },
        });
        if (!job?.inquiry) return { ok: false, error: "No inquiry linked" };
        const sorted = [...job.inquiry.carrierQuotes].sort((a, b) => {
          const ap = a.total40HC ?? a.total40 ?? a.total20 ?? Infinity;
          const bp = b.total40HC ?? b.total40 ?? b.total20 ?? Infinity;
          return ap - bp;
        });
        return { ok: true, result: sorted.map((q) => ({ carrier: q.carrier, status: q.status, total_40hc: q.total40HC, total_40: q.total40, total_20: q.total20, transit_days: q.transitDays })) };
      }

      // ─── Mutations ───────────────────────────────────────────────────────
      case "merge_inquiries_into_one": {
        const r = await mergeAllOpenInquiriesIntoOne({
          type: input.type as "SOURCING" | "FORWARDING" | undefined,
          subject: input.subject as string | undefined,
          commodity: input.commodity as string | undefined,
          origin: input.origin as string | undefined,
          destination: input.destination as string | undefined,
          weightKg: typeof input.weight_kg === "number" ? (input.weight_kg as number) : undefined,
        });
        return { ok: true, result: r };
      }
      case "dedup_inquiries": {
        const r = await consolidateDuplicateInquiries();
        return { ok: true, result: r };
      }
      case "populate_job_from_emails": {
        if (!jobId) return { ok: false, error: "No job_id" };
        const r = await populateJobFromEmails(jobId);
        return { ok: true, result: r };
      }
      case "award_supplier": {
        let threadId = input.thread_id as string | undefined;
        if (!threadId) {
          // Find cheapest priced thread or fuzzy-match on supplier_hint.
          if (!jobId) return { ok: false, error: "Need thread_id or focused job" };
          const inq = await prisma.job.findFirst({
            where: { id: jobId, officeId: ctx.officeId },
            select: { inquiry: { include: { emailThreads: true } } },
          });
          if (!inq?.inquiry) return { ok: false, error: "No inquiry linked" };
          const cands = inq.inquiry.emailThreads.map((t) => {
            let o: any = {};
            try { if (t.supplierOffer) o = JSON.parse(t.supplierOffer); } catch {}
            return { id: t.id, subject: t.subject, name: o.supplierName, price: o.pricePerUnit };
          });
          const hint = input.supplier_hint ? String(input.supplier_hint).toLowerCase() : "";
          let pick = hint
            ? cands.find((c) => (c.name && c.name.toLowerCase().includes(hint)) || c.subject.toLowerCase().includes(hint))
            : null;
          if (!pick) pick = cands.filter((c) => typeof c.price === "number").sort((a, b) => a.price - b.price)[0];
          if (!pick) return { ok: false, error: "No supplier matched" };
          threadId = pick.id;
        }
        const r = await awardSupplier(threadId);
        return { ok: true, result: r };
      }
      case "draft_reply": {
        let threadId = input.thread_id as string | undefined;
        if (!threadId) {
          if (!jobId) return { ok: false, error: "Need thread_id or focused job" };
          const j = await prisma.job.findFirst({
            where: { id: jobId, officeId: ctx.officeId },
            select: { inquiry: { include: { emailThreads: { orderBy: { lastMessageAt: "desc" }, take: 1, select: { id: true } } } } },
          });
          threadId = j?.inquiry?.emailThreads?.[0]?.id;
          if (!threadId) return { ok: false, error: "No threads on this job" };
        }
        const r = await draftReplyToMessage({ threadId, intent: input.intent as string | undefined });
        return { ok: true, result: r };
      }
      case "draft_counter_offer": {
        const threadId = input.thread_id as string | undefined;
        if (!threadId) return { ok: false, error: "thread_id required for counter-offer" };
        const r = await draftCounterOffer({ threadId, target: String(input.target) });
        return { ok: true, result: r };
      }
      case "extract_supplier_offers": {
        const inquiryId = input.inquiry_id as string | undefined;
        if (!inquiryId) return { ok: false, error: "inquiry_id required" };
        const r = await extractSourcingOffersForInquiry(inquiryId);
        return { ok: true, result: r };
      }
      case "edit_job": {
        if (!jobId) return { ok: false, error: "No job_id" };
        const r = await applyEditJob(jobId, ctx.officeId, (input.fields as Record<string, unknown>) ?? {});
        return { ok: true, result: r };
      }
      case "edit_inquiry": {
        if (!jobId) return { ok: false, error: "No job_id (need scope to find inquiry)" };
        const r = await applyEditInquiry(jobId, ctx.officeId, (input.fields as Record<string, unknown>) ?? {});
        return "error" in r ? { ok: false, error: r.error } : { ok: true, result: r };
      }
      case "move_job_stage": {
        if (!jobId) return { ok: false, error: "No job_id" };
        const r = await applyMoveStage(jobId, ctx.officeId, String(input.status));
        return "error" in r ? { ok: false, error: r.error } : { ok: true, result: r };
      }
      case "add_milestone": {
        if (!jobId) return { ok: false, error: "No job_id" };
        const r = await applyAddMilestone(jobId, ctx.officeId, {
          type: String(input.type),
          plannedAt: input.planned_at as string | undefined,
          actualAt: input.actual_at as string | undefined,
          note: input.note as string | undefined,
        });
        return "error" in r ? { ok: false, error: r.error } : { ok: true, result: r };
      }
      case "set_customer": {
        if (!jobId) return { ok: false, error: "No job_id" };
        const r = await applySetCustomer(jobId, ctx.officeId, {
          companyName: String(input.company_name),
          createIfMissing: input.create_if_missing !== false,
        });
        return "error" in r ? { ok: false, error: r.error } : { ok: true, result: r };
      }
      case "rename_job": {
        if (!jobId) return { ok: false, error: "No job in scope" };
        const newTitle = String(input.new_title ?? "").trim();
        if (!newTitle) return { ok: false, error: "new_title required" };
        const job = await prisma.job.findFirst({
          where: { id: jobId, officeId: ctx.officeId },
          select: { id: true, reference: true, inquiryId: true, inquiry: { select: { subject: true } } },
        });
        if (!job) return { ok: false, error: "Job not found" };
        if (!job.inquiryId) return { ok: false, error: "Job has no linked inquiry — title is stored on the inquiry's subject. Set a customer/inquiry first." };
        const oldTitle = job.inquiry?.subject ?? "(untitled)";
        await prisma.inquiry.update({
          where: { id: job.inquiryId },
          data: { subject: newTitle.slice(0, 200) },
        });
        revalidatePath(`/dashboard/jobs/${jobId}`);
        revalidatePath(`/dashboard/rfq/${job.inquiryId}`);
        revalidatePath("/dashboard/jobs");
        return { ok: true, result: { reference: job.reference, from: oldTitle, to: newTitle } };
      }
      case "rename_company": {
        if (!jobId) return { ok: false, error: "No job_id" };
        const r = await applyRenameCompany(jobId, ctx.officeId, String(input.new_name));
        return "error" in r ? { ok: false, error: r.error } : { ok: true, result: r };
      }
      case "set_revenue": {
        if (!jobId) return { ok: false, error: "No job_id" };
        const r = await applySetMoney(jobId, ctx.officeId, "revenue", Number(input.amount), input.currency as string | undefined);
        return "error" in r ? { ok: false, error: r.error } : { ok: true, result: r };
      }
      case "set_cost": {
        if (!jobId) return { ok: false, error: "No job_id" };
        const r = await applySetMoney(jobId, ctx.officeId, "cost", Number(input.amount), input.currency as string | undefined);
        return "error" in r ? { ok: false, error: r.error } : { ok: true, result: r };
      }
      case "add_quote_line": {
        if (!jobId) return { ok: false, error: "No job_id" };
        const r = await applyAddQuoteLine(jobId, ctx.officeId, {
          description: String(input.description),
          amount: Number(input.amount),
          currency: input.currency as string | undefined,
        });
        return "error" in r ? { ok: false, error: r.error } : { ok: true, result: r };
      }
      case "hide_unrelated_threads": {
        const cands = await prisma.emailThread.findMany({
          where: {
            officeId: ctx.officeId, hiddenAt: null, jobId: null, inquiryId: null,
            messages: { every: { OR: [{ classification: "OTHER" }, { classification: null }] } },
          },
          take: 100, select: { id: true },
        });
        await prisma.emailThread.updateMany({
          where: { id: { in: cands.map((c) => c.id) } },
          data: { hiddenAt: new Date() },
        });
        revalidatePath("/dashboard/inbox");
        return { ok: true, result: { hidden: cands.length } };
      }
      case "link_threads_to_job": {
        if (!jobId) return { ok: false, error: "No job in scope" };
        const job = await prisma.job.findFirst({
          where: { id: jobId, officeId: ctx.officeId },
          select: {
            id: true, type: true, inquiryId: true, reference: true,
            commodity: true, origin: true, destination: true,
            company: { select: { name: true } },
            inquiry: { select: { fromEmail: true, fromCompany: true } },
          },
        });
        if (!job?.inquiryId) return { ok: false, error: "Focused job has no linked inquiry" };

        // Build search terms. Operator override beats auto-derivation.
        const explicitQ = (input.q as string | undefined)?.trim();
        const terms: string[] = [];
        if (explicitQ) {
          terms.push(explicitQ);
        } else {
          // Derive from job context: commodity (split into per-word too), route, customer.
          if (job.commodity) {
            terms.push(job.commodity);
            // Also search per significant word so "soybean meal" matches "soybean", "SBM", etc.
            for (const w of job.commodity.split(/\s+/)) {
              if (w.length >= 4 && !terms.includes(w)) terms.push(w);
            }
          }
          if (job.destination) terms.push(job.destination);
          if (job.origin) terms.push(job.origin);
          if (job.company?.name) terms.push(job.company.name);
          if (job.inquiry?.fromEmail) {
            const domain = job.inquiry.fromEmail.split("@")[1];
            if (domain) terms.push(domain);
          }
          if (job.inquiry?.fromCompany) terms.push(job.inquiry.fromCompany);
        }
        if (terms.length === 0) return { ok: false, error: "No commodity/route/customer set on this job — pass q explicitly or run populate_job_from_emails first." };

        const onlyUnlinked = input.only_unlinked !== false;
        const limit = Math.min(100, Number(input.limit ?? 50));

        // Build a big OR query across all terms × all fields.
        const orClauses: any[] = [];
        for (const term of terms) {
          orClauses.push({ subject: { contains: term, mode: "insensitive" } });
          orClauses.push({ messages: { some: { OR: [
            { bodyText: { contains: term, mode: "insensitive" } },
            { fromEmail: { contains: term, mode: "insensitive" } },
            { fromName: { contains: term, mode: "insensitive" } },
          ] } } });
        }
        const where: any = { officeId: ctx.officeId, OR: orClauses };
        if (onlyUnlinked) {
          // Only consider threads not already on a different inquiry/job.
          where.jobId = null;
          where.AND = [{ OR: [{ inquiryId: null }, { inquiryId: job.inquiryId }] }];
        }

        const threads = await prisma.emailThread.findMany({
          where, take: limit, select: { id: true, subject: true, inquiryId: true },
        });
        const toLink = threads.filter((t) => t.inquiryId !== job.inquiryId);
        if (toLink.length === 0) {
          return { ok: true, result: {
            linked: 0,
            already_linked: threads.length,
            search_terms: terms,
            message: threads.length > 0
              ? `Already linked ${threads.length} matching thread(s) to this job. Nothing new to attach.`
              : `No matching threads found across [${terms.join(", ")}]`,
          } };
        }
        await prisma.emailThread.updateMany({
          where: { id: { in: toLink.map((t) => t.id) } },
          data: { inquiryId: job.inquiryId, autoLinkedAt: new Date() },
        });
        if (job.type === "SOURCING") {
          try { await extractSourcingOffersForInquiry(job.inquiryId); } catch {}
        }
        revalidatePath("/dashboard/inbox");
        revalidatePath(`/dashboard/jobs/${jobId}`);
        revalidatePath(`/dashboard/rfq/${job.inquiryId}`);
        return {
          ok: true,
          result: {
            linked: toLink.length,
            job_reference: job.reference,
            search_terms: terms,
            sample_subjects: toLink.slice(0, 5).map((t) => t.subject),
            note: job.type === "SOURCING" ? "Supplier offers re-extracted." : undefined,
          },
        };
      }
      case "seed_demo_load": {
        const r = await seedDemoLoad({ officeId: ctx.officeId });
        return "error" in r ? { ok: false, error: r.error } : { ok: true, result: r };
      }
      case "analyze_document": {
        const documentId = String(input.document_id ?? "");
        if (!documentId) return { ok: false, error: "document_id required" };
        const r = await analyzeJobDocument({ documentId, force: input.force === true });
        return "error" in r ? { ok: false, error: r.error } : { ok: true, result: r };
      }
      case "delete_job": {
        if (!jobId) return { ok: false, error: "No job_id" };
        if (input.confirm !== true) return { ok: false, error: "delete_job requires confirm=true" };
        const r = await applyDeleteJob(jobId, ctx.officeId);
        return "error" in r ? { ok: false, error: r.error } : { ok: true, result: r };
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
