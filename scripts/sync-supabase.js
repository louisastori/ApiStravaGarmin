import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const srcDir = path.join(rootDir, "src");
const targetDir = path.join(rootDir, "supabase", "functions", "src");

const sync = async () => {
  console.log(`Synchronizing ${srcDir} -> ${targetDir}`);

  const exists = await fs
    .access(srcDir)
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    throw new Error("Source directory 'src' is missing.");
  }

  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
  await fs.cp(srcDir, targetDir, { recursive: true });

  console.log("Sync complete.");
};

sync().catch((error) => {
  console.error("Failed to sync Supabase sources:", error);
  process.exit(1);
});
