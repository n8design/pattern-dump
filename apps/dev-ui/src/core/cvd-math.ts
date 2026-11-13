// CVD (colour vision deficiency) simulation maths.
//
// Pure: no DOM, no module state, no imports beyond the CvdType union. Extracted from main.ts as the
// first step of the shell decomposition precisely because it has zero coupling — it is the one
// region that could move without a state or DOM seam existing yet, which makes it the safe place to
// prove the extraction loop before anything risky moves.
//
// The tables and both functions are a VERBATIM move. Nothing here was retyped: the Machado
// coefficients are physiological constants and a transcription slip would be invisible to review
// and produce subtly wrong colour, so they were lifted by line range, not by hand.

import type { CvdType } from "./store.js";

// ─── CVD overlay — Machado 2009 matrix table ─────────────────────────────
// Source: G. M. Machado, M. M. Oliveira, L. Fernandes (2009), "A Physiologically-based Model for
// Simulation of Color Vision Deficiency", IEEE Transactions on Visualization and Computer Graphics
// 15(6), 1291-1298, doi:10.1109/TVCG.2009.113. The coefficients are the paper's published values
// (data, not code), as also used by Chromium and Firefox DevTools. Listed in THIRD-PARTY-NOTICES.md.
// Each entry: 9-element row-major 3×3 linear-sRGB transform [r1,r2,r3, g1,g2,g3, b1,b2,b3].
// 11 entries per type, severity 0.0–1.0, step 0.1.
// Intermediate severities: element-wise lerp between the two bracketing table entries.

export const CVD_IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// Generates a severity table by element-wise lerp from identity to `full` at 0.1 steps.
// Used only for achromatopsia, which has no physiological intermediate matrices.
export function cvdLinearTable(full: number[]): number[][] {
  return Array.from({ length: 11 }, (_, i) => {
    const t = i / 10;
    return CVD_IDENTITY.map((v, j) => v + (full[j] - v) * t);
  });
}

export const MACHADO: Record<Exclude<CvdType, "none">, number[][]> = {
  // Protanopia (L-cone loss) — Machado 2009, exact physiological values.
  protanopia: [
    [...CVD_IDENTITY],
    [0.856167,  0.182038, -0.038205,  0.029342, 0.955115,  0.015544, -0.002176, -0.025934,  1.028110],
    [0.734766,  0.334872, -0.069637,  0.057840, 0.903969,  0.038191, -0.004285, -0.051898,  1.056183],
    [0.630323,  0.465641, -0.095964,  0.086397, 0.847100,  0.066503, -0.006294, -0.075916,  1.082210],
    [0.539009,  0.579343, -0.118352,  0.114820, 0.788267,  0.096913, -0.008200, -0.098948,  1.107148],
    [0.458064,  0.679578, -0.137642,  0.140729, 0.736319,  0.122953, -0.009962, -0.121111,  1.131073],
    [0.385450,  0.769005, -0.154455,  0.164416, 0.691090,  0.144494, -0.011561, -0.142143,  1.153704],
    [0.319627,  0.849633, -0.169261,  0.186197, 0.651799,  0.162004, -0.013136, -0.162620,  1.175756],
    [0.259411,  0.923008, -0.182419,  0.205816, 0.613938,  0.180247, -0.014678, -0.182078,  1.196756],
    [0.203876,  0.990338, -0.194214,  0.223825, 0.579316,  0.196860, -0.016169, -0.200382,  1.216551],
    [0.152286,  1.052583, -0.204868,  0.114503, 0.786281,  0.099216, -0.003882, -0.048116,  1.051998],
  ],
  // Deuteranopia (M-cone loss) — Machado 2009, exact physiological values.
  deuteranopia: [
    [...CVD_IDENTITY],
    [0.866435,  0.177704, -0.044139,  0.049567, 0.939063,  0.011370, -0.003453,  0.007233,  0.996220],
    [0.760729,  0.319078, -0.079807,  0.090568, 0.865985,  0.043447, -0.006027,  0.013626,  0.992401],
    [0.675425,  0.433850, -0.109275,  0.125303, 0.781209,  0.093488, -0.007950,  0.026799,  0.981151],
    [0.605511,  0.528560, -0.134071,  0.155318, 0.687938,  0.156744, -0.009376,  0.043310,  0.966066],
    [0.547494,  0.607240, -0.154734,  0.181692, 0.589028,  0.229280, -0.010410,  0.060810,  0.949600],
    [0.498864,  0.674188, -0.173052,  0.205199, 0.484799,  0.310002, -0.011131,  0.078156,  0.932975],
    [0.457771,  0.731899, -0.189670,  0.225977, 0.374653,  0.399370, -0.011595,  0.095399,  0.916196],
    [0.422116,  0.781437, -0.203553,  0.244340, 0.260728,  0.494932, -0.011841,  0.112064,  0.899777],
    [0.394719,  0.821042, -0.215761,  0.262213, 0.466615,  0.271172, -0.011830,  0.077502,  0.934329],
    [0.367322,  0.860646, -0.227968,  0.280085, 0.672501,  0.047413, -0.011820,  0.042940,  0.968881],
  ],
  // Tritanopia (S-cone loss) — Machado 2009, exact physiological values.
  // NOT a linear ramp: R→R dips to 0.896 at sev 0.2, then rises past 1 (peaks ~1.279 at sev 0.9).
  tritanopia: [
    [...CVD_IDENTITY],
    [ 0.926670,  0.092514, -0.019184,  0.021191, 0.964503,  0.014306,  0.008437,  0.054813,  0.936750],
    [ 0.895720,  0.133330, -0.029050,  0.029997, 0.945400,  0.024603,  0.013027,  0.104707,  0.882266],
    [ 0.905871,  0.127791, -0.033662,  0.026856, 0.941251,  0.031893,  0.013410,  0.148296,  0.838294],
    [ 0.948035,  0.089490, -0.037526,  0.014364, 0.946792,  0.038844,  0.010853,  0.193991,  0.795156],
    [ 1.017277,  0.027029, -0.044306, -0.006113, 0.958479,  0.047634,  0.006379,  0.248708,  0.744913],
    [ 1.104996, -0.046633, -0.058363, -0.032137, 0.971635,  0.060503,  0.001336,  0.317922,  0.680742],
    [ 1.193214, -0.109812, -0.083402, -0.058496, 0.979410,  0.079086, -0.002346,  0.403492,  0.598854],
    [ 1.257728, -0.139648, -0.118081, -0.078003, 0.975409,  0.102594, -0.003316,  0.501214,  0.502102],
    [ 1.278864, -0.125333, -0.153531, -0.084748, 0.957674,  0.127074, -0.000989,  0.601151,  0.399838],
    [ 1.255528, -0.076749, -0.178779, -0.078411, 0.930809,  0.147602,  0.004733,  0.691367,  0.303900],
  ],
  // Achromatopsia — Rec. 709 luminance-weighted greyscale ramp (identity → full greyscale).
  // Not a Machado table: the physiological model doesn't cover monochromacy.
  achromatopsia: cvdLinearTable(
    [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722]
  ),
};

export function computeCvdMatrix(type: Exclude<CvdType, "none">, severity: number): number[] {
  const table = MACHADO[type];
  if (severity <= 0) return table[0];
  if (severity >= 1) return table[10];
  const lo = Math.floor(severity * 10);
  const t  = severity * 10 - lo;
  const a  = table[lo];
  const b  = table[lo + 1];
  return a.map((v, i) => v + (b[i] - v) * t);
}

export function cvdMatrixToValues(m: number[]): string {
  // feColorMatrix type="matrix": 20 values, 4 rows × 5 cols (R,G,B,A,1 inputs).
  // m = [r1,r2,r3, g1,g2,g3, b1,b2,b3] — 3×3 linear-RGB, no alpha change, no bias.
  return `${m[0]} ${m[1]} ${m[2]} 0 0  ${m[3]} ${m[4]} ${m[5]} 0 0  ${m[6]} ${m[7]} ${m[8]} 0 0  0 0 0 1 0`;
}
