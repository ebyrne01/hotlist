/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text */
/**
 * GET /api/creator/share-card/[cardId]/image
 *
 * Generates a shareable PNG card image using next/og (satori).
 * Dark warm theme, designed for video end-cards and story posts.
 * Note: satori uses <img>, not next/image — ESLint rules disabled above.
 */

import { ImageResponse } from "next/og";
import { getAdminClient } from "@/lib/supabase/admin";
import { fetchShareCardData } from "@/lib/share-card/fetch-card-data";

export const runtime = "edge";

const DIMENSIONS: Record<string, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
};

// Design spec colors
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
    <svg width="36" height="36" viewBox="0 0 24 24" style={{ marginRight: "4px" }}>
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

  const dims = DIMENSIONS[data.card.aspectRatio] ?? DIMENSIONS["9:16"];

  // Increment export count (fire-and-forget)
  const admin = getAdminClient();
  admin
    .from("creator_share_cards")
    .update({ export_count: data.card.exportCount + 1 })
    .eq("id", data.card.id)
    .then(() => {});

  const handle = data.creator.vanitySlug
    ? `@${data.creator.vanitySlug}`
    : data.creator.displayName ?? "";

  // Scale factors for different aspect ratios
  const scale = dims.width === 1920 ? 1.2 : 1;
  const pad = Math.round(48 * scale);

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: `linear-gradient(160deg, ${C.bgDeep} 0%, ${C.bgMid} 100%)`,
          padding: `${pad}px`,
          fontFamily: "serif",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: `${Math.round(32 * scale)}px`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <svg
              width={Math.round(28 * scale)}
              height={Math.round(28 * scale)}
              viewBox="0 0 16 16"
              style={{ marginRight: "10px" }}
            >
              <path
                d="M8 1c1.5 2.5 4 4 4 7.5a4 4 0 0 1-8 0C4 5 6.5 3.5 8 1z"
                fill={C.coral}
              />
            </svg>
            <span
              style={{
                fontSize: `${Math.round(26 * scale)}px`,
                fontStyle: "italic",
                color: C.warmCream,
              }}
            >
              Hotlist
            </span>
          </div>
          <span
            style={{
              fontSize: `${Math.round(22 * scale)}px`,
              color: C.muted,
            }}
          >
            {handle}
          </span>
        </div>

        {/* Book section */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: `${Math.round(24 * scale)}px`,
            marginBottom: `${Math.round(28 * scale)}px`,
          }}
        >
          {/* Cover */}
          {data.book.coverUrl ? (
            <img
              src={data.book.coverUrl}
              width={Math.round(180 * scale)}
              height={Math.round(270 * scale)}
              style={{
                borderRadius: "16px",
                objectFit: "cover",
              }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: `${Math.round(180 * scale)}px`,
                height: `${Math.round(270 * scale)}px`,
                borderRadius: "16px",
                backgroundColor: C.pillBorder,
              }}
            >
              <span
                style={{
                  color: C.darkMuted,
                  fontSize: `${Math.round(18 * scale)}px`,
                  fontStyle: "italic",
                  textAlign: "center",
                  padding: "16px",
                }}
              >
                {data.book.title}
              </span>
            </div>
          )}

          {/* Book info */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              flex: 1,
            }}
          >
            <span
              style={{
                fontSize: `${Math.round(34 * scale)}px`,
                fontWeight: 500,
                color: C.warmWhite,
                lineHeight: 1.2,
                marginBottom: "8px",
              }}
            >
              {data.book.title}
            </span>
            <span
              style={{
                fontSize: `${Math.round(26 * scale)}px`,
                color: C.muted,
                marginBottom: `${Math.round(20 * scale)}px`,
              }}
            >
              {data.book.author}
            </span>

            {/* Peppers */}
            {data.spiceLevel > 0 && (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    marginBottom: "6px",
                  }}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <PepperIcon key={n} filled={n <= data.spiceLevel} />
                  ))}
                </div>
                <span
                  style={{
                    fontSize: `${Math.round(22 * scale)}px`,
                    color: C.amberBright,
                  }}
                >
                  {data.heatLabel}
                </span>
              </div>
            )}

            {/* Tropes */}
            {data.tropes.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px",
                  marginTop: `${Math.round(16 * scale)}px`,
                }}
              >
                {data.tropes.slice(0, 4).map((trope) => (
                  <span
                    key={trope}
                    style={{
                      fontSize: `${Math.round(20 * scale)}px`,
                      color: C.amber,
                      padding: "6px 14px",
                      borderRadius: "20px",
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
        <div
          style={{
            width: "100%",
            height: "1px",
            backgroundColor: C.divider,
            marginBottom: `${Math.round(24 * scale)}px`,
          }}
        />

        {/* Ratings row */}
        {(data.ratings.goodreads || data.ratings.amazon) && (
          <div
            style={{
              display: "flex",
              gap: `${Math.round(60 * scale)}px`,
              marginBottom: `${Math.round(24 * scale)}px`,
            }}
          >
            {data.ratings.goodreads && (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span
                  style={{
                    fontSize: `${Math.round(36 * scale)}px`,
                    fontWeight: 500,
                    color: C.warmWhite,
                  }}
                >
                  {data.ratings.goodreads.toFixed(1)}
                </span>
                <span
                  style={{
                    fontSize: `${Math.round(20 * scale)}px`,
                    color: C.darkMuted,
                  }}
                >
                  Goodreads
                </span>
              </div>
            )}
            {data.ratings.amazon && (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span
                  style={{
                    fontSize: `${Math.round(36 * scale)}px`,
                    fontWeight: 500,
                    color: C.warmWhite,
                  }}
                >
                  {data.ratings.amazon.toFixed(1)}
                </span>
                <span
                  style={{
                    fontSize: `${Math.round(20 * scale)}px`,
                    color: C.darkMuted,
                  }}
                >
                  Amazon
                </span>
              </div>
            )}
          </div>
        )}

        {/* Creator quote */}
        {data.card.creatorQuote && (
          <>
            <div
              style={{
                width: "100%",
                height: "1px",
                backgroundColor: C.divider,
                marginBottom: `${Math.round(24 * scale)}px`,
              }}
            />
            <span
              style={{
                fontSize: `${Math.round(26 * scale)}px`,
                fontStyle: "italic",
                color: C.amber,
                lineHeight: 1.5,
                marginBottom: `${Math.round(24 * scale)}px`,
              }}
            >
              &ldquo;{data.card.creatorQuote}&rdquo;
            </span>
          </>
        )}

        {/* Spacer to push footer down */}
        <div style={{ display: "flex", flex: 1 }} />

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor: C.bgFooter,
            margin: `-${pad}px`,
            marginTop: "0",
            padding: `${Math.round(20 * scale)}px ${pad}px`,
          }}
        >
          <span
            style={{
              fontSize: `${Math.round(20 * scale)}px`,
              color: C.darkMuted,
              fontFamily: "monospace",
            }}
          >
            myhotlist.app/{data.creator.vanitySlug ? `@${data.creator.vanitySlug}` : ""}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "3px",
                backgroundColor: C.coral,
              }}
            />
            <span
              style={{
                fontSize: `${Math.round(18 * scale)}px`,
                color: C.darkest,
              }}
            >
              View on Hotlist
            </span>
          </div>
        </div>
      </div>
    ),
    {
      ...dims,
    }
  );
}
