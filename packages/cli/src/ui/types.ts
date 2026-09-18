export interface Opt {
  value: string;
  label: string;
  hint?: string;
  /** Shown but not selectable - cursor skips it, rendered dim. */
  disabled?: boolean;
}

export interface SelectOpts {
  message: string;
  options: Opt[];
  initialValue?: string;
  footer?: string;
  /** Don't commit to the timeline on resolve, so a step can be replaced in place (back nav). */
  transient?: boolean;
}

export interface MultiSelectOpts {
  message: string;
  options: Opt[];
  initialValues?: string[];
}

export interface TextOpts {
  message: string;
  placeholder?: string;
  initialValue?: string;
  validate?: (v: string) => string | undefined;
  footer?: string;
  transient?: boolean;
}

export interface ListItem {
  label: string;
  badge?: string;
  meta?: string;
  children?: ListItem[];
}

export interface ListOpts {
  items: ListItem[];
  empty?: string;
}

export interface Spinner {
  start: (message: string) => void;
  message: (message: string) => void;
  stop: (message: string) => void;
}

/** Prompt methods resolve to `null` when the user cancels or a non-interactive backend has no answer. */
export interface Renderer {
  start: () => void;
  stop: () => void;

  intro: (text: string) => void;
  step: (text: string) => void;
  info: (text: string) => void;
  success: (text: string) => void;
  warn: (text: string) => void;
  error: (text: string) => void;
  note: (text: string, title?: string) => void;
  report: (text: string) => void;
  list: (o: ListOpts) => void;
  outro: (text: string) => void;

  spinner: () => Spinner;
  select: (o: SelectOpts) => Promise<string | null>;
  multiselect: (o: MultiSelectOpts) => Promise<string[] | null>;
  confirm: (o: { message: string; initial?: boolean }) => Promise<boolean | null>;
  text: (o: TextOpts) => Promise<string | null>;
  onInterrupt?: (listener: () => void) => () => void;
}
