import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Full-bleed mark so iOS can apply its own rounded-square mask. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#414fd2",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="118" height="118" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="6" rx="7" ry="3" />
          <path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
          <path d="M5 12v6c0 1.66 3.13 3 7 3 1.4 0 2.7-.18 3.8-.5" />
          <path d="m17 17 4 4m0-4a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
