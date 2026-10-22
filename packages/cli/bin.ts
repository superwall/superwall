#!/usr/bin/env node
import { main } from "@/entry";

const NODE_MIN = 20;
const major = Number(process.versions.node.split(".")[0]);
if (Number.isFinite(major) && major < NODE_MIN) {
  process.stderr.write(
    `The Superwall CLI requires Node.js ${NODE_MIN} or later. You are using ${process.version}.\n`,
  );
  process.exit(1);
}

await main();
