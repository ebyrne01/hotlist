"use client";

import { useState, useRef, useEffect } from "react";
import { clsx } from "clsx";

interface ExpandableTextProps {
  text: string;
  maxLines?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function ExpandableText({
  text,
  maxLines = 3,
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

  return (
    <div>
      <p
        ref={textRef}
        className={clsx(className, !expanded && "line-clamp-3")}
        style={style}
      >
        {text}
      </p>
      {needsExpand && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1.5 text-xs font-mono text-fire/70 hover:text-fire transition-colors"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}
