import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Flat tokens (existing — keep for backwards compat) ──
        fire: "#d4430e",
        cream: "#faf7f2",
        ink: "#12080a",
        muted: "#7a6055",
        gold: "#b07d2a",
        border: "#e0d2c8",

        // ── Semantic token layer ──
        brand: {
          primary: "#d4430e",     // fire orange — CTAs, links, active states
          "primary-dk": "#b8360b", // hover/pressed (10% darker)
          ink: "#12080a",          // primary text
          cream: "#faf7f2",        // page background
          "cream-dk": "#f0ebe2",   // card/surface background
        },
        spice: {
          filled: "#d4430e",       // active pepper
          empty: "#e8ddd5",        // hollow pepper (warm stone)
        },
        enrich: {
          complete: "#2d6a4f",     // enriched — deep green
          partial: "#b8860b",      // enriching — warm amber
          pending: "#a09080",      // pending — warm muted
        },
        status: {
          error: "#9b1c1c",        // errors (distinct from brand orange)
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', "serif"],
        body: ['"Libre Baskerville"', "serif"],
        mono: ['"DM Mono"', "monospace"],
      },
      keyframes: {
        "slide-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
      },
      animation: {
        "slide-up": "slide-up 0.25s ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
