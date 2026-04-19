"use client";
import { useState } from "react";
import { AudioUploader } from "./audio-uploader";

type ActivityType = "VISIT" | "CALL" | "EMAIL";

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  VISIT: "Visit",
  CALL: "Call",
  EMAIL: "Email",
};

export function ActivityForm({
  companyId,
  activityTypes,
  action,
}: {
  companyId: string;
  activityTypes: string[];
  action: (fd: FormData) => Promise<void>;
}) {
  const [transcript, setTranscript] = useState("");
  const today = new Date().toISOString().split("T")[0];

  return (
    <form action={action} className="field">
      <input type="hidden" name="companyId" value={companyId} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <select name="type" defaultValue="VISIT">
          {activityTypes.map((type) => (
            <option key={type} value={type}>
              {ACTIVITY_LABELS[type as ActivityType] ?? type}
            </option>
          ))}
        </select>
        <input name="occurredAt" type="date" defaultValue={today} />
      </div>
      <input name="subject" placeholder="Subject" />
      <textarea
        name="body"
        placeholder="Notes"
        rows={3}
        style={{ resize: "vertical" }}
      />
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 2 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
          Audio → Transcript
        </div>
        <AudioUploader onTranscript={setTranscript} />
        {transcript && (
          <textarea
            name="transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={4}
            placeholder="Transcript (editable before saving)"
            style={{ marginTop: 6, resize: "vertical", fontSize: 12 }}
          />
        )}
      </div>
      <button type="submit">Log activity</button>
    </form>
  );
}
