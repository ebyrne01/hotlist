"use client";

import { useState, useRef, useEffect } from "react";
import { clsx } from "clsx";

interface ExpandableTextProps {
  text: string;
  /** If true, the first sentence is rendered in bold as a hook line */
  hookLine?: boolean;
  maxLines?: number;
  className?: string;
  style?: React.CSSProperties;
}

/** Extract the first sentence from text (ends at . ! or ? followed by a space or end) */
function splitFirstSentence(text: string): [string, string] {
  const match = text.match(/^(.+?[.!?])(\s+|$)/);
  if (!match) return [text, ""];
  return [match[1], text.slice(match[0].length)];
}

export default function ExpandableText({
  text,
  hookLine,
  className,
  style,
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const [needsExpand, setNeedsExpand] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  // Check if text is actually clamped (overflows)
  useEffect(() => {
    const el = textRef.current;
    if (el) {
      setNeedsExpand(el.scrollHeight > el.clientHeight + 2);
    }
  }, [text]);

  const [firstSentence, rest] = hookLine ? splitFirstSentence(text) : [null, null];

  return (
    <div>
      <p
        ref={textRef}
        className={clsx(className, !expanded && "line-clamp-3")}
        style={style}
      >
        {hookLine && firstSentence ? (
          <>
            <strong>{firstSentence}</strong>
            {rest ? " " + rest : ""}
          </>
        ) : (
          text
        )}
      </p>
      {needsExpand && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1.5 text-xs font-mono text-fire/70 hover:text-fire transition-colors"
        >
          {expanded ? "Show less" : "Read more \u2192"}
        </button>
      )}
    </div>
  );
}
