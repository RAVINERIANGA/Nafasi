import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14211c",
        paper: "#f3efe6",
        card: "#fffdf8",
        line: "#ddd4c6",
        mist: "#e7f3f1",
        teal: {
          DEFAULT: "#0e6e68",
          dark: "#083f3c",
        },
        clay: "#9f2d22",
        amber: "#8a5a00",
        moss: "#0b6b3a",
        sky: "#154e9e",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "ui-serif", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 0 rgba(20,33,28,0.04), 0 12px 32px rgba(20,33,28,0.05)",
      },
    },
  },
  plugins: [],
};

export default config;
