import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "jira-dev-proxy",
      configureServer(server) {
        server.middlewares.use("/__jira_proxy__", async (req, res) => {
          const targetBase = req.headers["x-jira-base-url"];

          if (typeof targetBase !== "string" || targetBase.length === 0) {
            res.statusCode = 400;
            res.end("Missing x-jira-base-url header.");
            return;
          }

          const body = await new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            req.on("end", () => resolve(Buffer.concat(chunks)));
            req.on("error", reject);
          });

          try {
            const blockedHeaders = new Set([
              "host",
              "content-length",
              "origin",
              "referer",
              "cookie",
              "connection",
              "user-agent",
              "x-jira-base-url",
              "sec-fetch-dest",
              "sec-fetch-mode",
              "sec-fetch-site",
              "sec-ch-ua",
              "sec-ch-ua-mobile",
              "sec-ch-ua-platform",
            ]);

            const headers = new Headers();
            Object.entries(req.headers).forEach(([headerName, headerValue]) => {
              const lowered = headerName.toLowerCase();
              if (blockedHeaders.has(lowered) || typeof headerValue === "undefined") {
                return;
              }

              if (Array.isArray(headerValue)) {
                headers.set(headerName, headerValue.join(", "));
                return;
              }

              headers.set(headerName, headerValue);
            });

            headers.set("x-atlassian-token", "no-check");
            headers.set("user-agent", "JiraQuickManagerDevProxy/1.0");

            const targetUrl = new URL(req.url ?? "", targetBase);
            const response = await fetch(targetUrl, {
              method: req.method,
              headers,
              body:
                req.method === "GET" || req.method === "HEAD" || body.length === 0
                  ? undefined
                  : body,
            });

            res.statusCode = response.status;
            response.headers.forEach((value, key) => {
              if (key.toLowerCase() === "content-encoding") {
                return;
              }
              res.setHeader(key, value);
            });

            const arrayBuffer = await response.arrayBuffer();
            res.end(Buffer.from(arrayBuffer));
          } catch (error) {
            res.statusCode = 502;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                message:
                  error instanceof Error ? error.message : "Failed to proxy Jira request.",
              }),
            );
          }
        });
      },
    },
  ],
  base: "./",
});
