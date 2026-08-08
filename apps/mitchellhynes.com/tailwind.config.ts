import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    "./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}",
    "../../node_modules/@ecumene/ui/**/*.{js,ts,jsx,tsx}",
  ],
  plugins: [typography],
  theme: {
    fontFamily: {
      sans: ["var(--font-body)"],
      serif: ["var(--font-display)"],
      mono: ["var(--font-mono)"],
      sms: ["Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
    },
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
      typography: {
        DEFAULT: {
          css: {
            fontFamily: "var(--font-body)",
            h1: {
              fontFamily: "var(--font-display)",
              fontWeight: "700",
              letterSpacing: "-0.025em",
            },
            h2: {
              fontFamily: "var(--font-display)",
              fontWeight: "700",
              letterSpacing: "-0.02em",
            },
            h3: {
              fontFamily: "var(--font-display)",
              fontWeight: "700",
              letterSpacing: "-0.015em",
            },
            h4: {
              fontFamily: "var(--font-display)",
              fontWeight: "700",
            },
            strong: {
              fontWeight: "700",
            },
            code: {
              fontFamily: "var(--font-mono)",
              fontWeight: "500",
            },
            pre: {
              fontFamily: "var(--font-mono)",
              fontWeight: "400",
            },
            "code::before": {
              content: "none",
            },
            "code::after": {
              content: "none",
            },
            blockquote: {
              fontStyle: "normal",
            },
            "blockquote p:first-of-type::before": {
              content: "none",
            },
            "blockquote p:last-of-type::after": {
              content: "none",
            },
          },
        },
      },
    },
  },
};

export default config;
