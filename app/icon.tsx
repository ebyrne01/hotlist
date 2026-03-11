import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: "#d4430e",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontSize: 22,
            fontWeight: 700,
            fontStyle: "italic",
            color: "#faf7f2",
            fontFamily: "serif",
            lineHeight: 1,
            marginTop: -1,
          }}
        >
          H
        </span>
      </div>
    ),
    { ...size }
  );
}
