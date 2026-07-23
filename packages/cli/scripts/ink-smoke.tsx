import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/ui/ink/App";
import { addItem, setActive } from "../src/ui/ink/store";

const { lastFrame, stdin } = render(<App />);
addItem("intro", "Superwall CLI v0.1.0");
addItem("info", "Detected Swift (iOS) · SwiftUI");
addItem("success", "Superwall is already set up in Orbis.");
addItem(
  "report",
  "## Superwall Placement Audit - Orbis\n\n**Placements found**\n- `campaign_trigger` - ContentView.swift:27 - Go Premium button.\n\n**Overall health: needs work**",
);
await new Promise((r) => setTimeout(r, 60));
console.log("=== TIMELINE FRAME ===");
console.log(lastFrame());

let resolved: string | null = "UNSET";
setActive({
  type: "select",
  message: "What do you want to do?",
  options: [
    {
      value: "integrate",
      label: "Integrate the SDK",
      hint: "install + configure",
    },
    { value: "review", label: "Review placements" },
  ],
  index: 0,
  resolve: (v) => {
    resolved = v;
  },
});
await new Promise((r) => setTimeout(r, 40));
console.log("\n=== SELECT (initial) ===");
console.log(lastFrame());
stdin.write("[B"); // ↓
await new Promise((r) => setTimeout(r, 40));
console.log("\n=== SELECT (after ↓) ===");
console.log(lastFrame());
stdin.write("\r"); // ⏎
await new Promise((r) => setTimeout(r, 40));
console.log("\n=== resolved:", resolved, "===");
console.log(lastFrame());
process.exit(0);
