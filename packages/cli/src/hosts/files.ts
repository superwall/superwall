import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "@/core/state/store";

export function fileStore(dir: () => string): Store {
  return {
    read(name) {
      const file = join(dir(), name);
      return existsSync(file) ? readFileSync(file, "utf8") : undefined;
    },
    write(name, text) {
      mkdirSync(dir(), { recursive: true, mode: 0o700 });
      const file = join(dir(), name);
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, text, { mode: 0o600 });
      renameSync(temporary, file);
    },
    remove(name) {
      rmSync(join(dir(), name), { force: true });
    },
  };
}
