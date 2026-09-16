// Verbose-timing gate.
//
// A LEAF, and deliberately its own module rather than a duplicated const: it is read by the style
// index, the diagnostics seed and the HMR patch path, and those instrument two halves of the same
// asymmetry — the startup full index build versus the per-save incremental patch. Two copies of
// this flag would let one half go quiet without anyone noticing.
//
// Gate verbose timing behind PD_VERBOSE_TIMING=1 so default runs produce no extra noise.
// Leave this in the codebase as a permanent early-warning tripwire and measurement hook;
// do NOT delete after benchmarking.

export const verboseTiming = !!process.env["PD_VERBOSE_TIMING"];
