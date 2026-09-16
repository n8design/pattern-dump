// OKLCH → sRGB-hex pipeline for the syntax themes. Author tokens in OKLCH (perceptually uniform,
// so lightness ladders survive CVD), compute to hex at module load with culori (pure-JS, cheap).
//
// GAMUT DISCIPLINE (the warning-orange 0.68 0.17 60 lesson): an out-of-sRGB OKLCH value clamps
// silently and paints a different colour than authored. `oklchHex` returns `inGamut`; the theme
// assemblers call `assertInGamut` to FAIL LOUD at load if any authored token is out of gamut —
// never ship a token that lies about its own value. The emitted hex is always a real sRGB colour
// (clampChroma reduces chroma deterministically to the gamut edge) so what we emit is what paints.
import { rgb, formatHex, inGamut, clampChroma } from "culori";

const inRGB = inGamut("rgb");

export interface Oklch {
  l: number; // 0..1 lightness
  c: number; // chroma
  h: number; // hue degrees
}

export interface Emitted {
  hex: string;
  inGamut: boolean;
}

/** Convert an OKLCH intent to an sRGB hex. `inGamut` is false when the authored chroma exceeds
 *  sRGB and had to be clamped (the emitted hex is the deterministic gamut-edge colour). */
export function oklchHex(i: Oklch): Emitted {
  const col = { mode: "oklch" as const, l: i.l, c: i.c, h: i.h };
  const ok = inRGB(rgb(col));
  const hex = formatHex(clampChroma(col, "oklch", "rgb"));
  return { hex, inGamut: ok };
}

/** Compute a named palette of OKLCH intents to hex, failing loud if any is out of sRGB gamut. */
export function computePalette<K extends string>(
  themeName: string,
  intents: Record<K, Oklch>,
): Record<K, string> {
  const out = {} as Record<K, string>;
  const bad: string[] = [];
  for (const key of Object.keys(intents) as K[]) {
    const e = oklchHex(intents[key]);
    if (!e.inGamut) bad.push(`${key} (${e.hex})`);
    out[key] = e.hex;
  }
  if (bad.length) {
    throw new Error(
      `[${themeName}] OKLCH tokens out of sRGB gamut (would clamp/lie): ${bad.join(", ")}`,
    );
  }
  return out;
}
