import fs from "node:fs/promises";
import path from "node:path";
const root = "dist/types";
async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (file.endsWith(".d.ts")) {
            let text = await fs.readFile(file, "utf8");
            text = text.replace(
                /(from\s+["'])(\.[^"']+)(["'])/g,
                (_, a, b, c) => a + (b.endsWith(".js") ? b : b + ".js") + c,
            );
            await fs.writeFile(file, text);
        }
    }
}
await walk(root);
