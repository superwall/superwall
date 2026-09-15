import React from "react";
import { Box, Static, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { wrapReportLine } from "../log";
import { THEME } from "../theme";
import type { ListItem } from "../types";
import {
  addItem,
  interrupt,
  setActive,
  updateActive,
  useStore,
  type Active,
  type ItemKind,
  type TimelineItem,
} from "./store";

const PRIMARY = THEME.primary;
const ALERT = THEME.alert;

function symbolFor(kind: ItemKind): {
  char: string;
  color?: string;
  dim?: boolean;
} {
  switch (kind) {
    case "intro":
      return { char: "◆", color: PRIMARY };
    case "step":
      return { char: "◇", color: PRIMARY };
    case "success":
      return { char: "◆", color: PRIMARY };
    case "info":
      return { char: "●", color: PRIMARY };
    case "warn":
      return { char: "▲", color: ALERT };
    case "error":
      return { char: "■", color: ALERT };
    case "outro":
      return { char: "└", dim: true };
    default:
      return { char: "◇", color: PRIMARY };
  }
}

function Inline({ line }: { line: string }): React.ReactElement {
  // Brand cyan is reserved for `code` and accents so bold headers don't read as muddy teal.
  const header = line.match(/^\s*#{1,6}\s+(.*)$/);
  if (header) return <Text bold>{header[1]}</Text>;

  const nodes: React.ReactNode[] = [];
  // **bold** | `code` | https://links
  const re = /\*\*(.+?)\*\*|`([^`]+)`|(https?:\/\/[^\s]+)/g;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) nodes.push(<Text key={k++}>{line.slice(last, m.index)}</Text>);
    if (m[1] != null)
      nodes.push(
        <Text key={k++} bold>
          {m[1]}
        </Text>,
      );
    else if (m[2] != null)
      nodes.push(
        <Text key={k++} color={PRIMARY}>
          {m[2]}
        </Text>,
      );
    else
      nodes.push(
        <Text key={k++} underline color={PRIMARY}>
          {m[3]}
        </Text>,
      );
    last = re.lastIndex;
  }
  if (last < line.length) nodes.push(<Text key={k++}>{line.slice(last)}</Text>);
  return <Text>{nodes}</Text>;
}

function ReportBlock({ text }: { text: string }): React.ReactElement {
  const width = Math.max(20, (process.stdout.columns ?? 80) - 2);
  const lines = text.split("\n").flatMap((line) => wrapReportLine(line, width));
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Box key={i}>
          <Text dimColor>│ </Text>
          <Text>{line}</Text>
        </Box>
      ))}
    </Box>
  );
}

function NoteBlock({ title, text }: { title?: string; text: string }): React.ReactElement {
  const lines = text.split("\n");
  const gutterHeight = lines.length + 4;
  return (
    <Box flexDirection="column">
      {title ? (
        <Box>
          <Text color={PRIMARY}>◇</Text>
          <Text> {title}</Text>
        </Box>
      ) : null}
      <Box>
        <Box flexDirection="column">
          {Array.from({ length: gutterHeight }).map((_, i) => (
            <Text key={i} dimColor>
              │
            </Text>
          ))}
        </Box>
        <Text> </Text>
        <Box
          borderStyle="round"
          borderColor="gray"
          paddingX={2}
          paddingY={1}
          flexDirection="column"
        >
          {lines.map((l, i) => (
            <Box key={i}>{l ? <Inline line={l} /> : <Text> </Text>}</Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function ListBlock({ items, empty }: { items: ListItem[]; empty?: string }): React.ReactElement {
  if (items.length === 0) {
    return (
      <Box>
        <Text dimColor>│ </Text>
        <Text dimColor>{empty ?? "None."}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      {items.map((it, i) => {
        const children = it.children ?? [];
        const isLast = i === items.length - 1;
        return (
          <Box key={i} flexDirection="column">
            <Box>
              {/* symbol + 2-space gap matches TimelineRow so labels align under the header column. */}
              <Text color={PRIMARY}>●</Text>
              <Text>{"  "}</Text>
              <Text>{it.label}</Text>
              {it.badge ? <Text dimColor> {it.badge}</Text> : null}
              {it.meta ? <Text dimColor> {it.meta}</Text> : null}
            </Box>
            {children.map((c, j) => (
              <Box key={j}>
                <Text dimColor>│ </Text>
                <Text dimColor>{[c.badge, c.label, c.meta].filter(Boolean).join("  ")}</Text>
              </Box>
            ))}
            {/* Connector omitted after the last row so the tree doesn't dangle. */}
            {!isLast ? <Text dimColor>│</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * One timeline entry. Connectors prefix every item after the first — the cap
 * included, so the closing line is spaced off the work above it — and are
 * never trailing, so the timeline cannot dangle when a command ends without
 * an outro (stop() caps it with `└`).
 */
function TimelineRow({ item, first }: { item: TimelineItem; first: boolean }): React.ReactElement {
  const connector = !first ? <Text dimColor>│</Text> : null;

  if (item.kind === "report")
    return (
      <Box flexDirection="column">
        {connector}
        <ReportBlock text={item.text} />
      </Box>
    );
  if (item.kind === "note")
    return (
      <Box flexDirection="column">
        {connector}
        <NoteBlock title={item.title} text={item.text} />
      </Box>
    );
  if (item.kind === "list")
    return (
      <Box flexDirection="column">
        {connector}
        <ListBlock items={item.list?.items ?? []} empty={item.list?.empty} />
      </Box>
    );

  if (item.kind === "intro") {
    const [firstWord = "Superwall", ...rest] = item.text.split(" ");
    return (
      <Box flexDirection="column">
        {connector}
        <Box>
          <Text color={PRIMARY}>◆ </Text>
          <Text color={PRIMARY} bold>
            {firstWord}
          </Text>
          {rest.length ? <Text dimColor> {rest.join(" ")}</Text> : null}
        </Box>
      </Box>
    );
  }

  const { char, color, dim } = symbolFor(item.kind);
  const lines = item.text.split("\n");
  return (
    <Box flexDirection="column">
      {connector}
      <Box>
        <Text color={color} dimColor={dim}>
          {char}
        </Text>
        {item.text ? (
          <>
            <Text> </Text>
            <Inline line={lines[0] ?? ""} />
          </>
        ) : null}
      </Box>
      {lines.slice(1).map((l, i) => (
        <Box key={i}>
          <Text dimColor>│ </Text>
          <Text>{l}</Text>
        </Box>
      ))}
    </Box>
  );
}

function finish(message: string, chosen: string): void {
  addItem("step", `${message}\n${chosen}`);
  setActive(null);
}

function SpinnerView({ message }: { message: string }): React.ReactElement {
  return (
    <Box>
      <Text color={PRIMARY}>
        <Spinner type="dots" />
      </Text>
      <Text> {message}</Text>
    </Box>
  );
}

function SelectView({
  active,
}: {
  active: Extract<Active, { type: "select" }>;
}): React.ReactElement {
  const n = active.options.length;
  const nextEnabled = (from: number, dir: 1 | -1): number => {
    for (let step = 1; step <= n; step++) {
      const i = (from + dir * step + n * step) % n;
      if (!active.options[i]?.disabled) return i;
    }
    return from;
  };
  useInput((input, key) => {
    if (key.upArrow || input === "k") updateActive({ index: nextEnabled(active.index, -1) });
    else if (key.downArrow || input === "j") updateActive({ index: nextEnabled(active.index, 1) });
    else if (key.return) {
      const opt = active.options[active.index]!;
      if (opt.disabled) return;
      const resolve = active.resolve;
      if (active.transient) setActive(null);
      else finish(active.message, opt.label);
      resolve(opt.value);
    } else if (key.escape) {
      const resolve = active.resolve;
      if (active.transient) setActive(null);
      else finish(active.message, "cancelled");
      resolve(null);
    }
  });
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={PRIMARY}>◇</Text>
        <Text> </Text>
        <Inline line={active.message} />
      </Box>
      {active.options.map((o, i) => {
        const sel = i === active.index;
        return (
          <OptionRow
            key={i}
            marker={`${sel ? "●" : "○"} `}
            label={o.label}
            hint={o.hint}
            color={sel ? PRIMARY : undefined}
            dim={o.disabled}
          />
        );
      })}
      <Footer text={active.footer} />
    </Box>
  );
}

const OPTION_INDENT = "│   ";

function OptionRow({
  marker,
  label,
  hint,
  color,
  dim,
  bold,
}: {
  marker: string;
  label: string;
  hint?: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
}): React.ReactElement {
  const columns = process.stdout.columns ?? 80;
  const inline = !hint || OPTION_INDENT.length + marker.length + label.length + 1 + hint.length <= columns;
  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{OPTION_INDENT}</Text>
        <Text color={color} dimColor={dim} bold={bold}>
          {marker}
          {label}
        </Text>
        {hint && inline ? <Text dimColor> {hint}</Text> : null}
      </Box>
      {hint && !inline ? (
        <Box>
          <Text dimColor>{OPTION_INDENT}</Text>
          <Text dimColor>
            {" ".repeat(marker.length)}
            {hint}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function Footer({ text }: { text?: string }): React.ReactElement | null {
  if (!text) return null;
  return (
    <Box>
      <Text dimColor>│ </Text>
      <Text dimColor> {text}</Text>
    </Box>
  );
}

function MultiSelectView({
  active,
}: {
  active: Extract<Active, { type: "multiselect" }>;
}): React.ReactElement {
  const n = active.options.length;
  useInput((input, key) => {
    if (key.upArrow) updateActive({ index: (active.index - 1 + n) % n });
    else if (key.downArrow) updateActive({ index: (active.index + 1) % n });
    else if (input === " ") {
      const v = active.options[active.index]!.value;
      const next = new Set(active.selected);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      updateActive({ selected: next });
    } else if (key.return) {
      const resolve = active.resolve;
      finish(active.message, `${active.selected.size} selected`);
      resolve([...active.selected]);
    } else if (key.escape) {
      const resolve = active.resolve;
      finish(active.message, "cancelled");
      resolve(null);
    }
  });
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={PRIMARY}>◇</Text>
        <Text> </Text>
        <Inline line={active.message} />
      </Box>
      {active.options.map((o, i) => {
        const cur = i === active.index;
        const on = active.selected.has(o.value);
        return (
          <OptionRow
            key={i}
            marker={`${cur ? "❯" : " "} ${on ? "◼" : "◻"} `}
            label={o.label}
            hint={o.hint}
            color={on ? PRIMARY : undefined}
            bold={cur}
          />
        );
      })}
    </Box>
  );
}

function ConfirmView({
  active,
}: {
  active: Extract<Active, { type: "confirm" }>;
}): React.ReactElement {
  useInput((input, key) => {
    if (key.leftArrow || key.rightArrow || input === "y" || input === "n") {
      updateActive({
        value: input === "y" ? true : input === "n" ? false : !active.value,
      });
    } else if (key.return) {
      const resolve = active.resolve;
      finish(active.message, active.value ? "Yes" : "No");
      resolve(active.value);
    } else if (key.escape) {
      const resolve = active.resolve;
      finish(active.message, "cancelled");
      resolve(null);
    }
  });
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={PRIMARY}>◇</Text>
        <Text> </Text>
        <Inline line={active.message} />
      </Box>
      <Box>
        <Text dimColor>│ </Text>
        <Text color={active.value ? PRIMARY : undefined}> {active.value ? "●" : "○"} Yes</Text>
        <Text> </Text>
        <Text color={!active.value ? PRIMARY : undefined}>{!active.value ? "●" : "○"} No</Text>
      </Box>
    </Box>
  );
}

function TextView({ active }: { active: Extract<Active, { type: "text" }> }): React.ReactElement {
  useInput((input, key) => {
    if (key.return) {
      const v = active.value.trim();
      if (active.validate) {
        const err = active.validate(v);
        if (err) {
          updateActive({ error: err });
          return;
        }
      }
      const resolve = active.resolve;
      if (active.transient) setActive(null);
      else finish(active.message, v || "(empty)");
      resolve(v);
    } else if (key.escape) {
      const resolve = active.resolve;
      if (active.transient) setActive(null);
      else finish(active.message, "cancelled");
      resolve(null);
    } else if (key.backspace || key.delete) {
      updateActive({ value: active.value.slice(0, -1), error: undefined });
    } else if (input && !key.ctrl && !key.meta) {
      updateActive({ value: active.value + input, error: undefined });
    }
  });
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={PRIMARY}>◇</Text>
        <Text> </Text>
        <Inline line={active.message} />
      </Box>
      <Box>
        <Text dimColor>│ </Text>
        <Text> </Text>
        {active.value ? (
          <>
            <Text>{active.value}</Text>
            <Text color={PRIMARY}>▏</Text>
          </>
        ) : (
          <>
            <Text color={PRIMARY}>▏</Text>
            <Text dimColor>{active.placeholder ?? ""}</Text>
          </>
        )}
      </Box>
      {active.error ? (
        <Box>
          <Text dimColor>│ </Text>
          <Text color="red"> {active.error}</Text>
        </Box>
      ) : null}
      <Footer text={active.footer} />
    </Box>
  );
}

function ActiveRegion({ active }: { active: NonNullable<Active> }): React.ReactElement | null {
  switch (active.type) {
    case "spinner":
      return <SpinnerView message={active.message} />;
    case "select":
      return <SelectView active={active} />;
    case "multiselect":
      return <MultiSelectView active={active} />;
    case "confirm":
      return <ConfirmView active={active} />;
    case "text":
      return <TextView active={active} />;
  }
}

export function App(): React.ReactElement {
  const s = useStore();
  useInput((input, key) => {
    if (key.ctrl && input === "c") interrupt();
  });
  return (
    <Box flexDirection="column">
      <Static items={s.items}>
        {(item, index) => <TimelineRow key={item.id} item={item} first={index === 0} />}
      </Static>
      {s.active ? (
        <Box flexDirection="column">
          {s.items.length > 0 ? <Text dimColor>│</Text> : null}
          <ActiveRegion active={s.active} />
        </Box>
      ) : null}
    </Box>
  );
}
