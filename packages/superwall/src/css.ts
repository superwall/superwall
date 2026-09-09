import type * as React from "react";

export type StyleWithVariables = React.CSSProperties & Record<`--${string}`, string>;
