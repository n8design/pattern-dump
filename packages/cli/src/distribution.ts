// The identity of the distributable package — the ONE place its name lives.
//
// PD is published (later) as a single self-contained package that bundles every @pattern-dump/*
// workspace package. The npm name is still provisional; renaming it is a change to this constant,
// which the pack script, `pd init` and the scaffolded config all read.

import cliPackage from "../package.json" with { type: "json" };

export const PD_PACKAGE_NAME = "pattern-dump";

/** The version stamped into the distributable, and the range `pd init` depends on. */
export const PD_VERSION: string = cliPackage.version;
