import { useLayoutEffect, useMemo, useState } from "react";
import type { CardElementProps, StripeCheckoutOptions } from "superwall/checkout/stripe";
import { useColorScheme } from "superwall/hooks";

/**
 * The design tokens Stripe's fields are drawn from, read from theme.css.
 * Stripe draws its fields in its own frame, so it can't read the page's CSS
 * variables: each token is resolved here to a plain colour and handed over.
 */
const TOKENS = {
  bg: "--bg",
  surface: "--surface",
  raised: "--raised",
  fg: "--fg",
  fgSecondary: "--fg-secondary",
  fgMuted: "--fg-muted",
  border: "--border",
  accent: "--accent",
  danger: "--destructive-ink",
} as const;

type Palette = Record<keyof typeof TOKENS, string>;

const FALLBACK: Palette = {
  bg: "#fdfef6",
  surface: "#f5f6ee",
  raised: "#ebece5",
  fg: "#0c0b0a",
  fgSecondary: "rgba(12, 11, 10, 0.7)",
  fgMuted: "rgba(12, 11, 10, 0.45)",
  border: "rgba(12, 11, 10, 0.1)",
  accent: "#46d7d4",
  danger: "#712f1a",
};

/**
 * Resolves each token to `rgb()`: the browser computes the token (OKLCH,
 * `color-mix()`), and a one-pixel canvas turns that into numbers Stripe reads.
 */
const readPalette = (): Palette => {
  if (typeof document === "undefined") return FALLBACK;
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.append(probe);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const palette = { ...FALLBACK };
  for (const [name, variable] of Object.entries(TOKENS) as [keyof Palette, string][]) {
    probe.style.color = `var(${variable})`;
    const computed = getComputedStyle(probe).color;
    if (!context || !computed) continue;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = computed;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    palette[name] =
      a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`;
  }
  probe.remove();
  return palette;
};

/** The palette for the current light or dark scheme, read again when it changes. */
const usePalette = (): Palette => {
  const scheme = useColorScheme();
  const [palette, setPalette] = useState<Palette>(readPalette);
  useLayoutEffect(() => setPalette(readPalette()), [scheme]);
  return palette;
};

const FONT = "Manrope, system-ui, sans-serif";

/**
 * Manrope's font file itself, not Google's stylesheet: Stripe loads a font
 * file inside its own frame, but fetches a stylesheet (`cssSrc`) from the
 * paywall's page, where a strict Content Security Policy can block it.
 */
const MANROPE = "url(https://fonts.gstatic.com/s/manrope/v23/xn7gYHE41ni1AdIRggexSvfedN4.woff2)";
const FONTS = ["400", "500", "600"].map((weight) => ({
  family: "Manrope",
  src: MANROPE,
  weight,
  display: "swap",
}));

/**
 * Stripe's Payment, Address, Link and wallet elements in this paywall's
 * design: the same surface as the plan rows, the same hairline, 3px corner,
 * teal focus edge, typeface and text ladder. Kept stable with `useMemo`,
 * since a new object makes Stripe redraw every element.
 */
export const useStripeOptions = (): StripeCheckoutOptions => {
  const p = usePalette();
  return useMemo(() => {
    const hairline = `1px solid ${p.border}`;
    const flat = { boxShadow: "none" };
    return {
      fonts: FONTS,
      appearance: {
        theme: "flat",
        labels: "above",
        variables: {
          colorPrimary: p.accent,
          colorBackground: p.surface,
          colorText: p.fg,
          colorTextSecondary: p.fgSecondary,
          colorTextPlaceholder: p.fgMuted,
          colorIcon: p.fgMuted,
          colorDanger: p.danger,
          fontFamily: FONT,
          fontSizeBase: "16px",
          borderRadius: "3px",
          spacingUnit: "4px",
          gridRowSpacing: "16px",
          focusBoxShadow: "none",
          focusOutline: "none",
        },
        rules: {
          ".Input": {
            ...flat,
            border: hairline,
            backgroundColor: p.surface,
            padding: "12px",
            fontSize: "16px",
          },
          ".Input:focus": { ...flat, borderColor: p.accent },
          ".Input--invalid": { ...flat, borderColor: p.danger },
          ".Label": { color: p.fgSecondary, fontWeight: "500", fontSize: "14px" },
          ".Tab": { ...flat, border: hairline, backgroundColor: p.surface },
          ".Tab:hover": { backgroundColor: p.raised },
          ".Tab--selected": { ...flat, borderColor: p.accent, backgroundColor: p.surface },
          ".AccordionItem": { ...flat, border: hairline, backgroundColor: p.surface },
          ".Block": { ...flat, border: hairline, backgroundColor: p.surface },
          ".PickerItem": { ...flat, border: hairline, backgroundColor: p.surface },
          ".CheckboxInput": { border: hairline, backgroundColor: p.surface },
          ".TermsText": { color: p.fgMuted },
          ".Error": { color: p.danger },
        },
      },
    };
  }, [p]);
};

/** The same design for the classic card fields, which take a `style` instead. */
export const useCardStyle = (): NonNullable<CardElementProps["options"]>["style"] => {
  const p = usePalette();
  return useMemo(
    () => ({
      base: {
        color: p.fg,
        iconColor: p.fgMuted,
        fontFamily: FONT,
        fontSize: "16px",
        fontSmoothing: "antialiased",
        "::placeholder": { color: p.fgMuted },
      },
      invalid: { color: p.danger, iconColor: p.danger },
    }),
    [p],
  );
};
