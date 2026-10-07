// Regenerates the static site (../*.html) from the manuals and release notes.
// Usage:  node tools/build_site.mjs      (run from the site/ folder)
// Needs:  npm i marked   (anywhere resolvable; or set NODE_PATH)
// Edit site.config.json first (githubRepo, versions). Output is plain HTML:
// publish the site/ folder with GitHub Pages. No server code, no secrets.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(fs.readFileSync(path.join(root, "site.config.json"), "utf8"));
const docsDir = path.resolve(root, "..", "xtblock-console", "src", "docs");
const relNotes = path.resolve(root, "..", "RELEASE-NOTES-testnet.md");
const repoUrl = `https://github.com/${cfg.githubRepo}`;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (t) => t.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function render(md) {
  const toc = [];
  const used = new Set();
  const r = new marked.Renderer();
  r.heading = function (token) {
    const html = this.parser.parseInline(token.tokens);
    let id = slug(token.text) || "section";
    while (used.has(id)) id += "-x";
    used.add(id);
    if (token.depth === 2 || token.depth === 3) toc.push({ depth: token.depth, id, text: token.text.replace(/[*`]/g, "") });
    return `<h${token.depth} id="${id}">${html}</h${token.depth}>\n`;
  };
  const body = marked.parse(md, { renderer: r, gfm: true });
  return { body, toc };
}

const nav = (active) => `
<header class="site-header"><div class="wrap">
  <a class="brand" href="index.html"><span class="logo">XT</span> <span>${cfg.productName}</span></a>
  <nav>
    <a href="index.html#downloads" class="${active === "dl" ? "on" : ""}">Download</a>
    <a href="operator.html" class="${active === "op" ? "on" : ""}">Operator manual</a>
    <a href="developer.html" class="${active === "dev" ? "on" : ""}">Developer manual</a>
    <a href="release-notes.html" class="${active === "rel" ? "on" : ""}">Release notes</a>
    <a href="${repoUrl}" rel="noopener">GitHub</a>
    <button id="theme" aria-label="Toggle theme" title="Toggle theme">◐</button>
  </nav>
</div></header>`;

const page = (title, active, inner, desc = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${cfg.productName}</title><meta name="description" content="${esc(desc || cfg.tagline)}">
<link rel="icon" href="data:,"><link rel="stylesheet" href="assets/style.css"></head>
<body>${nav(active)}${inner}
<footer class="site-footer"><div class="wrap"><span>© ${new Date().getFullYear()} ${cfg.orgName}</span><span>${cfg.productName} · xtcn ${cfg.xtcnVersion} · Console ${cfg.consoleVersion}</span></div></footer>
<script src="assets/site.js"></script></body></html>`;

function docPage(file, out, title, active) {
  const md = fs.readFileSync(path.join(docsDir, file), "utf8");
  const { body, toc } = render(md);
  const tocHtml = toc.map((t) => `<a class="d${t.depth}" href="#${t.id}">${esc(t.text)}</a>`).join("");
  fs.writeFileSync(path.join(root, out), page(title, active,
    `<div class="wrap doc"><aside class="toc"><input id="tocFilter" placeholder="Filter sections…" aria-label="Filter sections">${tocHtml}</aside><main class="prose">${body}</main></div>`,
    `${title} for ${cfg.productName}`));
  console.log("wrote", out, `(${toc.length} sections)`);
}

docPage("XTblock-Operator-Manual.md", "operator.html", "Operator manual", "op");
docPage("XTblock-Developer-Manual.md", "developer.html", "Developer manual", "dev");

// Release notes: public part only (drop the internal release checklist).
let rn = fs.readFileSync(relNotes, "utf8");
const cut = rn.indexOf("## Release checklist");
if (cut > 0) rn = rn.slice(0, cut);
{
  const { body } = render(rn);
  fs.writeFileSync(path.join(root, "release-notes.html"), page("Release notes", "rel", `<div class="wrap"><main class="prose narrow">${body}</main></div>`));
  console.log("wrote release-notes.html");
}

// Landing page.
const landing = `
<section class="hero"><div class="wrap">
  <h1>${esc(cfg.tagline)}</h1>
  <p class="lead">Run a delegate, operate a chain from the desktop Console, or just deploy and call contracts from a web page. No delegate access needed for developers.</p>
  <div class="cta"><a class="btn primary" href="#downloads">Download</a><a class="btn" href="developer.html">Developer manual</a><a class="btn" href="operator.html">Operator manual</a></div>
</div></section>

<section class="wrap grid3">
  <article><h3>Sharded EVM</h3><p>Accounts and contracts live on shards chosen by address hash. A coordinator chain anchors shard checkpoints and records cross-shard (2PC) outcomes.</p></article>
  <article><h3>Wallet compatible</h3><p>Send legacy (EIP-155) transactions with MetaMask, ethers or web3 through the xtgw gateway. Native token XTT, 18 decimals.</p></article>
  <article><h3>Developer portal</h3><p>Every gateway serves a web page with wallet, contract deploy and call, block explorer and a test faucet. Deploys align to your shard automatically.</p></article>
  <article><h3>Operator Console</h3><p>Desktop app to create and monitor instances, build genesis manifests and network maps, run 2PC transfers and browse the chain. A Developer mode hides node management.</p></article>
  <article><h3>Fault tolerant</h3><p>DPoS delegates with suspension and slashing, state sync, and automatic fork recovery with backups.</p></article>
  <article><h3>Atomic cross-shard</h3><p>Two-phase commit across shards: all legs commit or none are applied.</p></article>
</section>

<section class="wrap" id="downloads">
  <h2>Download</h2>
  <p class="muted">Releases are published on GitHub. Download the newest Console installer from the latest release. Every delegate of a chain must run the same version (xtcn ${cfg.xtcnVersion}, bundled).</p>
  <div class="dl">
    <a class="card" href="${repoUrl}/releases/latest"><strong>XTblock Console</strong><span>Desktop app for Windows. Includes the delegate node (xtcn) and gateway (xtgw), so there is nothing else to install. Version ${cfg.consoleVersion}.</span><em>Download latest →</em></a>
    <a class="card" href="${repoUrl}/releases"><strong>All releases</strong><span>Older versions and release notes.</span><em>Browse →</em></a>
  </div>
</section>

<section class="wrap" id="start">
  <h2>Start in five minutes</h2>
  <div class="grid2">
    <div class="panel"><h3>I am a developer</h3><ol>
      <li>Get the gateway address from your network operator.</li>
      <li>Open <code>http://&lt;gateway&gt;:&lt;port&gt;/</code> in a browser.</li>
      <li>Create a wallet, request test XTT from the faucet.</li>
      <li>Deploy and call your contract in the Deploy and Call tabs.</li>
    </ol><p><a href="developer.html">Read the developer manual →</a></p></div>
    <div class="panel"><h3>I run nodes</h3><ol>
      <li>Install the Console (it bundles the node and gateway).</li>
      <li>Create a delegate instance and start it.</li>
      <li>Build a genesis manifest and network map for a multi-delegate chain.</li>
      <li>Start the gateway and share its portal address with developers.</li>
    </ol><p><a href="operator.html">Read the operator manual →</a></p></div>
  </div>
</section>
`;
fs.writeFileSync(path.join(root, "index.html"), page(`${cfg.productName}`, "", landing));
console.log("wrote index.html");
