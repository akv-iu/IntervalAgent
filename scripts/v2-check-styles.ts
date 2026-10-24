import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Check the served assets, not Vite's CSS mock; never call a workspace or model endpoint.
async function main() {
  const origin = "http://127.0.0.1:3012";
  const built = process.argv.includes("--build");
  let html: string;
  if (built) html = await readFile(".next/server/app/v2.html", "utf8");
  else {
    const page = await fetch(`${origin}/v2`);
    assert.equal(page.status, 200, "Start npm run v2:dev before checking styles");
    html = await page.text();
  }
  const classNames = [...html.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/));
  const workspaceClass = classNames.find((name) => /(?:^|[_-])workspace$/.test(name));
  assert.ok(workspaceClass, "The workspace CSS module exported no class names; the page will be unstyled");
  const links = [...html.matchAll(/<link\b[^>]*href="([^"]+\.css(?:\?[^"]*)?)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
  assert.ok(links.length, "No stylesheet links were emitted");
  let styles = "";
  for (const link of new Set(links)) {
    assert.ok(link.startsWith("/_next/static/"), "Only local compiled stylesheets may be checked");
    if (built) styles += await readFile(`.next${decodeURIComponent(link.split("?")[0].slice("/_next".length))}`, "utf8");
    else {
      const asset = await fetch(`${origin}${link}`);
      assert.equal(asset.status, 200, "A compiled stylesheet could not be loaded");
      styles += await asset.text();
    }
  }
  assert.ok(styles.includes(`.${workspaceClass}`), "The rendered class has no matching stylesheet selector");
  assert.ok(styles.includes("--workspace-blue"), "Workspace design tokens were lost");
  assert.ok(styles.includes(".bg-accent-ink"), "Shared Tailwind utilities were lost");
  const pageClass = classNames.find((name) => /(?:^|[_-])page$/.test(name));
  assert.ok(pageClass && styles.replace(/\s+/g, "").includes(`main:has(>.${pageClass})`), "V2's full-width page rule is missing");
  assert.match(styles, /grid-template-columns:\s*minmax\(0,\s*1\.12fr\)/, "The two-column workspace layout was lost");
  console.log(`PASS (${built ? "build artifacts" : "served assets"}): CSS-module class and selector match; design tokens, two-column grid and shared Tailwind utilities exist. No browser or model calls.`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Stylesheet check failed"); process.exitCode = 1; });
