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
        fire: "#d4430e",
        cream: "#faf7f2",
        ink: "#12080a",
        muted: "#7a6055",
        gold: "#b07d2a",
        border: "#e0d2c8",
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
