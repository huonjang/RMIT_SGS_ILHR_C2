import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

function tideDpop() {
  const adapter = JSON.parse(
    readFileSync("public/tidecloak.json", "utf8")
  );

  const html = readFileSync(
    "public/tide_dpop_auth.html",
    "utf8"
  );

  const issuer =
    adapter["auth-server-url"].replace(/\/+$/, "") +
    "/realms/" + adapter.realm;

  const toHex = (value) =>
    Buffer.from(value, "utf8").toString("hex");

  const expectedPath =
    `/tide_dpop/iss/${toHex(issuer)}` +
    `/aud/${toHex(adapter.resource)}` +
    `/tide_dpop_auth.html`;

  function hashInline(tag) {
    const match = html.match(
      new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i")
    );

    if (!match) {
      throw new Error(`Missing inline ${tag}`);
    }

    return (
      "'sha256-" +
      createHash("sha256")
        .update(match[1], "utf8")
        .digest("base64") +
      "'"
    );
  }

  const csp =
    "default-src 'self'; " +
    `script-src 'self' ${hashInline("script")}; ` +
    `style-src 'self' ${hashInline("style")}`;

  const serve = (server) => {
    server.middlewares.use((req, res, next) => {
      const pathname = (req.url || "").split("?")[0];

      if (
        pathname.toLowerCase() !== expectedPath.toLowerCase()
      ) {
        return next();
      }

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Security-Policy", csp);
      res.setHeader("Allow-CSP-From", "*");
      res.end(html);
    });
  };

  return {
    name: "tide-dpop",
    configureServer: serve,
    configurePreviewServer: serve
  };
}

export default defineConfig({
  plugins: [react(), tideDpop()],
  server: {
    host: "localhost",
    port: 5137,
    strictPort: true
  }
});