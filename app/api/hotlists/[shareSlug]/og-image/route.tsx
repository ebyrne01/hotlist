/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text */
/**
 * GET /api/hotlists/[shareSlug]/og-image
 *
 * Generates a branded OG image for a Hotlist using next/og (satori).
 * Query param ?size=og (1200x630, default) or ?size=stories (1080x1920).
 */

import { ImageResponse } from "next/og";
import { getHotlistShareData } from "@/lib/hotlist-share-data";

export const runtime = "edge";

const SIZES: Record<string, { width: number; height: number }> = {
  og: { width: 1200, height: 630 },
  stories: { width: 1080, height: 1920 },
};

const C = {
  bgDeep: "#1A0F0A",
  bgMid: "#2C1810",
  warmWhite: "#FAF0E6",
  warmCream: "#E8D5C4",
  amber: "#C8A882",
  coral: "#D85A30",
  muted: "#A08B78",
  pillBorder: "#3A2A1E",
  pillBg: "rgba(255,255,255,0.04)",
};

function PepperIcon({ filled }: { filled: boolean }) {
  const c = filled ? C.coral : "#4A3828";
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" style={{ marginRight: "2px" }}>
      <path d="M12 2C12 2 11 4 11 5C11 5.5 11.5 6 12 6C12.5 6 13 5.5 13 5C13 4 12 2 12 2Z" fill={c} />
      <path d="M8 7C6 8 5 11 5 14C5 18 8 22 10 22C11 22 11.5 21 12 21C12.5 21 13 22 14 22C16 22 19 18 19 14C19 11 18 8 16 7C14.5 6 9.5 6 8 7Z" fill={c} />
    </svg>
  );
}

export async function GET(
  request: Request,
  { params }: { params: { shareSlug: string } }
) {
  const data = await getHotlistShareData(params.shareSlug);
  if (!data) {
    return new Response("Hotlist not found", { status: 404 });
  }

  const url = new URL(request.url);
  const sizeKey = url.searchParams.get("size") ?? "og";
  const dims = SIZES[sizeKey] ?? SIZES.og;
  const isStories = sizeKey === "stories";

  const spiceText =
    data.spiceMin != null && data.spiceMax != null
      ? data.spiceMin === data.spiceMax
        ? `Spice ${Math.round(data.spiceMin)}`
        : `Spice ${Math.round(data.spiceMin)}–${Math.round(data.spiceMax)}`
      : null;

  const coverSize = isStories ? 160 : 100;

  return new ImageResponse(
    (
      <div
        style={{
          width: dims.width,
          height: dims.height,
          display: "flex",
          flexDirection: "column",
          background: `linear-gradient(160deg, ${C.bgMid} 0%, ${C.bgDeep} 100%)`,
          padding: isStories ? "80px 60px" : "48px 56px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: isStories ? "48px" : "24px",
          }}
        >
          <span style={{ color: C.coral, fontSize: isStories ? "28px" : "20px" }}>
            🔥
          </span>
          <span
            style={{
              color: C.muted,
              fontSize: isStories ? "20px" : "14px",
              letterSpacing: "0.1em",
              textTransform: "uppercase" as const,
            }}
          >
            Hotlist
          </span>
        </div>

        {/* Hotlist name */}
        <div
          style={{
            color: C.warmWhite,
            fontSize: isStories ? "48px" : "36px",
            fontWeight: 700,
            fontStyle: "italic",
            lineHeight: 1.2,
            marginBottom: isStories ? "48px" : "28px",
            maxWidth: "90%",
          }}
        >
          {data.name}
        </div>

        {/* Book covers */}
        {data.covers.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: isStories ? "16px" : "12px",
              marginBottom: isStories ? "40px" : "24px",
            }}
          >
            {data.covers.map((coverUrl, i) => (
              <img
                key={i}
                src={coverUrl}
                width={coverSize}
                height={Math.round(coverSize * 1.5)}
                style={{
                  borderRadius: "8px",
                  objectFit: "cover",
                }}
              />
            ))}
          </div>
        )}

        {/* Meta line: book count + spice range */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: isStories ? "24px" : "16px",
          }}
        >
          <span
            style={{
              color: C.warmCream,
              fontSize: isStories ? "20px" : "16px",
            }}
          >
            {data.bookCount} book{data.bookCount !== 1 ? "s" : ""}
          </span>
          {spiceText && (
            <div style={{ display: "flex", alignItems: "center" }}>
              {Array.from({ length: 5 }, (_, i) => (
                <PepperIcon key={i} filled={i < Math.round(data.spiceMax ?? 0)} />
              ))}
              <span
                style={{
                  color: C.amber,
                  fontSize: isStories ? "16px" : "13px",
                  marginLeft: "6px",
                }}
              >
                {spiceText}
              </span>
            </div>
          )}
        </div>

        {/* Shared tropes */}
        {data.sharedTropes.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: "8px",
              flexWrap: "wrap" as const,
              marginBottom: isStories ? "32px" : "20px",
            }}
          >
            {data.sharedTropes.map((trope) => (
              <span
                key={trope}
                style={{
                  color: C.amber,
                  fontSize: isStories ? "16px" : "13px",
                  padding: isStories ? "6px 14px" : "4px 10px",
                  border: `1px solid ${C.pillBorder}`,
                  borderRadius: "20px",
                  background: C.pillBg,
                }}
              >
                {trope}
              </span>
            ))}
          </div>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              color: C.muted,
              fontSize: isStories ? "18px" : "14px",
            }}
          >
            myhotlist.app/lists/{data.shareSlug}
          </span>
          {data.creatorHandle && (
            <span
              style={{
                color: C.amber,
                fontSize: isStories ? "16px" : "13px",
              }}
            >
              by @{data.creatorHandle}
            </span>
          )}
        </div>
      </div>
    ),
    {
      width: dims.width,
      height: dims.height,
    }
  );
}
