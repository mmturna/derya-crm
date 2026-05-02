"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type MarginProfile = { id: string; label: string; customerTier: string | null; urgency: string | null; marginPercent: number };
type Company = { id: string; name: string };
type CalcResult = {
  matchedLane: { origin: string; destination: string; mode: string; baseAmount: number; currency: string } | null;
  matchedMarginLabel: string | null;
  marginPercent: number;
  baseAmount: number;
  marginAmount: number;
  recommendedAmount: number;
  floorAmount: number;
  currency: string;
  warnings: string[];
};

type Props = {
  origins: string[];
  destinations: string[];
  modes: string[];
  marginProfiles: MarginProfile[];
  companies: Company[];
  calcResult: CalcResult | null;
  searchParams: { origin?: string; destination?: string; mode?: string; tier?: string; urgency?: string };
  createQuoteAction: (fd: FormData) => Promise<void>;
};

export function PricingCalculator({ origins, destinations, modes, marginProfiles, companies, calcResult, searchParams, createQuoteAction }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [savePending, setSavePending] = useState(false);
  const [savedToCompany, setSavedToCompany] = useState<string | null>(null);
  const [showSaveForm, setShowSaveForm] = useState(false);

  const [origin, setOrigin] = useState(searchParams.origin ?? "");
  const [destination, setDestination] = useState(searchParams.destination ?? "");
  const [mode, setMode] = useState(searchParams.mode ?? "");
  const [tier, setTier] = useState(searchParams.tier ?? "");
  const [urgency, setUrgency] = useState(searchParams.urgency ?? "");

  function calculate() {
    if (!origin || !destination || !mode) return;
    const params = new URLSearchParams();
    if (origin) params.set("origin", origin);
    if (destination) params.set("destination", destination);
    if (mode) params.set("mode", mode);
    if (tier) params.set("tier", tier);
    if (urgency) params.set("urgency", urgency);
    startTransition(() => { router.push(`/dashboard/pricing?${params}`); });
  }

  async function handleSaveQuote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavePending(true);
    const fd = new FormData(e.currentTarget);
    await createQuoteAction(fd);
    const companyId = String(fd.get("companyId"));
    const company = companies.find((c) => c.id === companyId);
    setSavedToCompany(company?.name ?? "company");
    setSavePending(false);
    setShowSaveForm(false);
  }

  const hasResult = calcResult !== null;
  const noLane = hasResult && !calcResult!.matchedLane;

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      {/* Calculator header */}
      <div style={{ background: "var(--surface-3)", borderBottom: "1px solid var(--border)", padding: "16px 20px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-2)", marginBottom: 2 }}>Rate calculator</div>
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>Enter a route to get a recommended quote based on your lane rates and margin profiles</div>
      </div>

      <div style={{ padding: 20 }}>
        {/* Input grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr auto", gap: 10, alignItems: "end", marginBottom: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Origin</label>
            <input
              list="origin-list"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="e.g. Istanbul"
              style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: "1px solid var(--border)", fontSize: 13, background: "var(--surface)", color: "var(--text)", boxSizing: "border-box" }}
            />
            <datalist id="origin-list">{origins.map((o) => <option key={o} value={o} />)}</datalist>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Destination</label>
            <input
              list="dest-list"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="e.g. Hamburg"
              style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: "1px solid var(--border)", fontSize: 13, background: "var(--surface)", color: "var(--text)", boxSizing: "border-box" }}
            />
            <datalist id="dest-list">{destinations.map((d) => <option key={d} value={d} />)}</datalist>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: "1px solid var(--border)", fontSize: 13, background: "var(--surface)", color: "var(--text)", boxSizing: "border-box" }}>
              <option value="">Select mode</option>
              {["SEA-FCL", "SEA-LCL", "AIR", "ROAD", "COURIER"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Client tier</label>
            <select value={tier} onChange={(e) => setTier(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: "1px solid var(--border)", fontSize: 13, background: "var(--surface)", color: "var(--text)", boxSizing: "border-box" }}>
              <option value="">Any</option>
              <option value="new">New</option>
              <option value="existing">Existing</option>
              <option value="vip">VIP</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Urgency</label>
            <select value={urgency} onChange={(e) => setUrgency(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: "1px solid var(--border)", fontSize: 13, background: "var(--surface)", color: "var(--text)", boxSizing: "border-box" }}>
              <option value="">Any</option>
              <option value="flexible">Flexible</option>
              <option value="normal">Normal</option>
              <option value="asap">ASAP</option>
            </select>
          </div>
          <button
            type="button"
            onClick={calculate}
            disabled={!origin || !destination || !mode || isPending}
            style={{
              padding: "8px 20px",
              borderRadius: 7,
              background: "var(--brand)",
              color: "#fff",
              border: "none",
              fontWeight: 700,
              fontSize: 13,
              cursor: origin && destination && mode ? "pointer" : "not-allowed",
              opacity: origin && destination && mode ? 1 : 0.5,
              whiteSpace: "nowrap",
            }}
          >
            {isPending ? "…" : "Calculate"}
          </button>
        </div>

        {/* Result */}
        {hasResult && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 20, marginTop: 4 }}>

            {/* Warnings */}
            {calcResult!.warnings.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                {calcResult!.warnings.map((w, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 7, marginBottom: 4, fontSize: 12, color: "#92400e" }}>
                    <span>⚠</span><span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 12, alignItems: "start" }}>
              {/* Breakdown */}
              <div style={{ background: "var(--surface-3)", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Breakdown</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "var(--text-3)" }}>Base rate</span>
                    <span style={{ fontWeight: 600 }}>{noLane ? "—" : `${calcResult!.baseAmount.toLocaleString()} ${calcResult!.currency}`}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "var(--text-3)" }}>Margin ({calcResult!.marginPercent}%)</span>
                    <span style={{ fontWeight: 600 }}>{noLane ? "—" : `+${calcResult!.marginAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${calcResult!.currency}`}</span>
                  </div>
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6, display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "var(--text-3)" }}>Floor (min)</span>
                    <span style={{ fontWeight: 600 }}>{noLane ? "—" : `${calcResult!.floorAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${calcResult!.currency}`}</span>
                  </div>
                </div>
              </div>

              {/* Lane matched */}
              <div style={{ background: "var(--surface-3)", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Lane matched</div>
                {calcResult!.matchedLane ? (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
                      {calcResult!.matchedLane.origin} → {calcResult!.matchedLane.destination}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-3)" }}>{calcResult!.matchedLane.mode}</div>
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: "var(--danger)" }}>No match found</div>
                )}
                {calcResult!.matchedMarginLabel && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-3)" }}>
                    Margin: <strong style={{ color: "var(--text-2)" }}>{calcResult!.matchedMarginLabel}</strong>
                  </div>
                )}
              </div>

              {/* Recommended price */}
              <div style={{ background: calcResult!.baseAmount > 0 ? "#011f3d" : "var(--surface-3)", borderRadius: 10, padding: "14px 16px", color: calcResult!.baseAmount > 0 ? "#fff" : "var(--text)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: calcResult!.baseAmount > 0 ? "#93c5fd" : "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Recommended quote</div>
                {calcResult!.baseAmount > 0 ? (
                  <>
                    <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em" }}>
                      {calcResult!.recommendedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                    <div style={{ fontSize: 14, color: "#93c5fd", marginTop: 2 }}>{calcResult!.currency}</div>
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: "var(--text-3)" }}>Add a lane rate first</div>
                )}
              </div>

              {/* Save as quote */}
              {calcResult!.baseAmount > 0 && (
                <div>
                  {savedToCompany ? (
                    <div style={{ padding: "10px 14px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, fontSize: 13, color: "#16a34a", fontWeight: 600 }}>
                      ✓ Saved to {savedToCompany}
                    </div>
                  ) : showSaveForm ? (
                    <form onSubmit={handleSaveQuote} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <input type="hidden" name="origin" value={calcResult!.matchedLane?.origin ?? origin} />
                      <input type="hidden" name="destination" value={calcResult!.matchedLane?.destination ?? destination} />
                      <input type="hidden" name="mode" value={mode} />
                      <input type="hidden" name="value" value={calcResult!.recommendedAmount.toFixed(0)} />
                      <input type="hidden" name="currency" value={calcResult!.currency} />
                      <select name="companyId" required style={{ padding: "8px 10px", borderRadius: 7, border: "1px solid var(--border)", fontSize: 13, background: "var(--surface)", color: "var(--text)" }}>
                        <option value="">Select company…</option>
                        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <input name="notes" placeholder="Notes (optional)" style={{ padding: "8px 10px", borderRadius: 7, border: "1px solid var(--border)", fontSize: 13, background: "var(--surface)", color: "var(--text)" }} />
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="submit" disabled={savePending} style={{ flex: 1, padding: "8px", borderRadius: 7, background: "var(--brand)", color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                          {savePending ? "Saving…" : "Save quote"}
                        </button>
                        <button type="button" onClick={() => setShowSaveForm(false)} style={{ padding: "8px 12px", borderRadius: 7, background: "var(--surface-3)", color: "var(--text-3)", border: "1px solid var(--border)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowSaveForm(true)}
                      style={{ width: "100%", padding: "10px 16px", borderRadius: 8, border: "1px solid var(--brand)", background: "transparent", color: "var(--brand)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                    >
                      Save as quote →
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
