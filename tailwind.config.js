export const content = ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"]

module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          '"Segoe UI"',
          "system-ui",
          "sans-serif"
        ]
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
        }
      },
      borderColor: {
        glass: {
          DEFAULT: "var(--glass-primary-border)",
          soft: "var(--glass-secondary-border)",
          control: "var(--glass-control-border)"
        }
      },
      /* The type scale, surfaced the same way the colours are. The overlay had
         seven sizes inside a 3px range (11 / 11.5 / 12 / 12.5 / 13 / xs / sm),
         several of them half a pixel apart — differences no reader perceives
         but which guaranteed no two components agreed. Four steps plus the key
         cap. Line heights ride along so callers stop setting them by hand. */
      fontSize: {
        title: ["var(--fs-title)", { lineHeight: "1.45" }],
        body: ["var(--fs-body)", { lineHeight: "1.6" }],
        label: ["var(--fs-label)", { lineHeight: "1.35" }],
        meta: ["var(--fs-meta)", { lineHeight: "1.45" }],
        kbd: ["var(--fs-kbd)", { lineHeight: "1" }]
      },
      /* Concentric radii. `surface` is a panel, `nested` a control inside one,
         `inner` a segment inside a control. Tailwind's own rounded-lg (8px)
         inside an 16px panel is the mismatch these replace. */
      borderRadius: {
        surface: "var(--r-surface)",
        nested: "var(--r-nested)",
        inner: "var(--r-inner)"
      },
      /* The `animate-in` / `animate-out` utilities that used to be defined here
         existed only to prop up the toast's `animate-in fade-in
         slide-in-from-bottom`, which came from tailwindcss-animate — a package
         this project has never depended on, so the other two classes emitted
         nothing. The toast now animates from real keyframes in index.css,
         keyed off Radix's data-state, and nothing else referenced these. */
    }
  },
  plugins: []
}
