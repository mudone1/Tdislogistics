import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#184F73",
          dark: "#123B58",
          light: "#3D86AC",
        },
        gold: {
          DEFAULT: "#C07C4C",
          light: "#D9A06B",
          pale: "#F4E6D8",
        },
        brown: "#8B5E3C",
        offwhite: "#F8FAFC",
        gray: {
          100: "#EEF2F5",
          200: "#DCE4EA",
          400: "#8A98A6",
          600: "#3F4C58",
        },
        green: {
          DEFAULT: "#2E8F63",
          light: "#E6F5ED",
        },
        red: {
          DEFAULT: "#C0392B",
          light: "#FDECEA",
        },
        amber: {
          DEFAULT: "#C07C4C",
          light: "#F4E6D8",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "sans-serif"],
        tight: ["var(--font-inter-tight)", "Inter Tight", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "18px",
        sm: "12px",
      },
      boxShadow: {
        sm: "0 1px 3px rgba(18,59,88,0.06)",
        DEFAULT: "0 6px 20px rgba(18,59,88,0.08)",
        lg: "0 16px 40px rgba(18,59,88,0.14)",
      },
      keyframes: {
        pulse2: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        spin: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        sectionFadeIn: {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "section-fade-in": "sectionFadeIn 0.4s cubic-bezier(0.22,1,0.36,1) forwards",
        "slide-up": "slideUp 0.3s ease",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
