"use client";

import { useState } from "react";

export default function ShareCardActions({ cardId }: { cardId: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const url = `${window.location.origin}/card/${cardId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="mt-4 mb-2">
      <button
        onClick={handleCopy}
        className="w-full text-center px-4 py-3 rounded-lg border border-[#3A2A1E] text-[#A08B78] text-sm hover:bg-white/5 transition-colors"
        style={{ fontFamily: "monospace" }}
      >
        {copied ? "Copied!" : "Copy link to share"}
      </button>
    </div>
  );
}
