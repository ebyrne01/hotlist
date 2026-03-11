import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          borderRadius: 36,
          background: "#d4430e",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontSize: 120,
            fontWeight: 700,
            fontStyle: "italic",
            color: "#faf7f2",
            fontFamily: "serif",
            lineHeight: 1,
            marginTop: -4,
          }}
        >
          H
        </span>
      </div>
    ),
    { ...size }
  );
}
