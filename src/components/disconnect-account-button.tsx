"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { disconnectEmailAccount } from "@/lib/gmail-sync";

export function DisconnectAccountButton({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  function disconnect() {
    if (!confirm("Disconnect this inbox? Existing synced messages will stay.")) return;
    startTransition(async () => {
      await disconnectEmailAccount(accountId);
      router.refresh();
    });
  }

  return (
    <button
      onClick={disconnect}
      disabled={busy}
      className="btn btn-secondary btn-sm"
      style={{ fontSize: 12 }}
    >
      {busy ? "…" : "Disconnect"}
    </button>
  );
}
