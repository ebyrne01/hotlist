/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text */
/**
 * GET /api/creator/share-card/[cardId]/preview
 *
 * Returns a smaller (540px wide) preview of the share card.
 * Does not increment export_count — for in-editor previewing only.
 * Note: satori uses <img>, not next/image — ESLint rules disabled above.
 */

import { ImageResponse } from "next/og";
import { fetchShareCardData } from "@/lib/share-card/fetch-card-data";

export const runtime = "edge";

const PREVIEW_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "9:16": { width: 540, height: 960 },
  "16:9": { width: 960, height: 540 },
  "1:1": { width: 540, height: 540 },
};

const C = {
  bgDeep: "#1A0F0A",
  bgMid: "#2C1810",
  bgFooter: "#150D08",
  warmWhite: "#FAF0E6",
  warmCream: "#E8D5C4",
  amber: "#C8A882",
  amberBright: "#C88A5A",
  muted: "#A08B78",
  darkMuted: "#6B5A45",
  darkest: "#4A3828",
  coral: "#D85A30",
  divider: "rgba(255,255,255,0.06)",
  pillBorder: "#3A2A1E",
  pillBg: "rgba(255,255,255,0.04)",
};

function PepperIcon({ filled }: { filled: boolean }) {
  const c = filled ? C.coral : C.darkest;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" style={{ marginRight: "2px" }}>
      <path d="M12 2C12 2 11 4 11 5C11 5.5 11.5 6 12 6C12.5 6 13 5.5 13 5C13 4 12 2 12 2Z" fill={c} />
      <path d="M8 7C6 8 5 11 5 14C5 18 8 22 10 22C11 22 11.5 21 12 21C12.5 21 13 22 14 22C16 22 19 18 19 14C19 11 18 8 16 7C14.5 6 9.5 6 8 7Z" fill={c} />
    </svg>
  );
}

export async function GET(
  request: Request,
  { params }: { params: { cardId: string } }
) {
  const data = await fetchShareCardData(params.cardId);
  if (!data) {
    return new Response("Card not found", { status: 404 });
  }

  const dims = PREVIEW_DIMENSIONS[data.card.aspectRatio] ?? PREVIEW_DIMENSIONS["9:16"];

  const handle = data.creator.vanitySlug
    ? `@${data.creator.vanitySlug}`
    : data.creator.displayName ?? "";

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: `linear-gradient(160deg, ${C.bgDeep} 0%, ${C.bgMid} 100%)`,
          padding: "24px",
          fontFamily: "serif",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <svg width="14" height="14" viewBox="0 0 16 16" style={{ marginRight: "6px" }}>
              <path d="M8 1c1.5 2.5 4 4 4 7.5a4 4 0 0 1-8 0C4 5 6.5 3.5 8 1z" fill={C.coral} />
            </svg>
            <span style={{ fontSize: "13px", fontStyle: "italic", color: C.warmCream }}>
              Hotlist
            </span>
          </div>
          <span style={{ fontSize: "11px", color: C.muted }}>{handle}</span>
        </div>

        {/* Book section */}
        <div style={{ display: "flex", gap: "12px", marginBottom: "14px" }}>
          {data.book.coverUrl ? (
            <img
              src={data.book.coverUrl}
              width={90}
              height={135}
              style={{ borderRadius: "8px", objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "90px",
                height: "135px",
                borderRadius: "8px",
                backgroundColor: C.pillBorder,
              }}
            >
              <span style={{ color: C.darkMuted, fontSize: "9px", fontStyle: "italic", textAlign: "center", padding: "8px" }}>
                {data.book.title}
              </span>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
            <span style={{ fontSize: "17px", fontWeight: 500, color: C.warmWhite, lineHeight: 1.2, marginBottom: "4px" }}>
              {data.book.title}
            </span>
            <span style={{ fontSize: "13px", color: C.muted, marginBottom: "10px" }}>
              {data.book.author}
            </span>

            {data.spiceLevel > 0 && (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: "3px" }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <PepperIcon key={n} filled={n <= data.spiceLevel} />
                  ))}
                </div>
                <span style={{ fontSize: "11px", color: C.amberBright }}>{data.heatLabel}</span>
              </div>
            )}

            {data.tropes.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "8px" }}>
                {data.tropes.slice(0, 4).map((trope) => (
                  <span
                    key={trope}
                    style={{
                      fontSize: "10px",
                      color: C.amber,
                      padding: "3px 7px",
                      borderRadius: "10px",
                      border: `1px solid ${C.pillBorder}`,
                      backgroundColor: C.pillBg,
                    }}
                  >
                    {trope}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: "100%", height: "1px", backgroundColor: C.divider, marginBottom: "12px" }} />

        {/* Ratings */}
        {(data.ratings.goodreads || data.ratings.amazon) && (
          <div style={{ display: "flex", gap: "30px", marginBottom: "12px" }}>
            {data.ratings.goodreads && (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "18px", fontWeight: 500, color: C.warmWhite }}>
                  {data.ratings.goodreads.toFixed(1)}
                </span>
                <span style={{ fontSize: "10px", color: C.darkMuted }}>Goodreads</span>
              </div>
            )}
            {data.ratings.amazon && (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "18px", fontWeight: 500, color: C.warmWhite }}>
                  {data.ratings.amazon.toFixed(1)}
                </span>
                <span style={{ fontSize: "10px", color: C.darkMuted }}>Amazon</span>
              </div>
            )}
          </div>
        )}

        {/* Quote */}
        {data.card.creatorQuote && (
          <>
            <div style={{ width: "100%", height: "1px", backgroundColor: C.divider, marginBottom: "12px" }} />
            <span style={{ fontSize: "13px", fontStyle: "italic", color: C.amber, lineHeight: 1.5, marginBottom: "12px" }}>
              &ldquo;{data.card.creatorQuote}&rdquo;
            </span>
          </>
        )}

        {/* Spacer */}
        <div style={{ display: "flex", flex: 1 }} />

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor: C.bgFooter,
            margin: "-24px",
            marginTop: "0",
            padding: "10px 24px",
          }}
        >
          <span style={{ fontSize: "10px", color: C.darkMuted, fontFamily: "monospace" }}>
            myhotlist.app/{data.creator.vanitySlug ? `@${data.creator.vanitySlug}` : ""}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <div style={{ width: "4px", height: "4px", borderRadius: "2px", backgroundColor: C.coral }} />
            <span style={{ fontSize: "9px", color: C.darkest }}>View on Hotlist</span>
          </div>
        </div>
      </div>
    ),
    {
      ...dims,
    }
  );
}
