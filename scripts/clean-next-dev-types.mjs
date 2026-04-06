import { rmSync } from "node:fs";
import path from "node:path";

const target = path.join(process.cwd(), ".next", "dev");

rmSync(target, {
  force: true,
  recursive: true,
});
