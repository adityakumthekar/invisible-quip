export const content = ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"]

module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        /* The faces live in src/tokens.css; these only point at them. */
        sans: ["var(--font-body)"],
        mono: ["var(--font-mono)"]
      },
      /* Surfaced so components can theme with `bg-glass-hover` etc. instead of
         hardcoding `bg-white/10`, which ignored the token system entirely.
         These resolve to CSS vars, so the `/opacity` modifier won't work on
         them — use a token with the alpha already baked in. */
      colors: {
        glass: {
          hover: "var(--glass-hover)",
          soft: "var(--glass-accent-soft)",
          line: "var(--glass-primary-border)",
          scrim: "var(--glass-scrim)",
          accent: "var(--glass-accent)",
          heading: "var(--glass-heading)",
          text: "var(--glass-text)",
          muted: "var(--glass-muted)",
          subtle: "var(--glass-subtle)",
          link: "var(--glass-link)",
          danger: "var(--glass-danger)",
          success: "var(--glass-success)",
          warning: "var(--glass-warning)"
        },
        signal: "var(--signal)",
        live: "var(--live)"
      },
      borderColor: {
        glass: {
          DEFAULT: "var(--glass-primary-border)",
          soft: "var(--glass-secondary-border)",
          control: "var(--glass-control-border)"
        }
      },
      animation: {
        in: "in 0.2s ease-out",
        out: "out 0.2s ease-in"
      },
      keyframes: {
        in: {
          "0%": { transform: "translateY(100%)", opacity: 0 },
          "100%": { transform: "translateY(0)", opacity: 1 }
        },
        out: {
          "0%": { transform: "translateY(0)", opacity: 1 },
          "100%": { transform: "translateY(100%)", opacity: 0 }
        }
      }
    }
  },
  plugins: []
}
