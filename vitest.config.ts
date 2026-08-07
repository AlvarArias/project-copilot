import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    // reference-ui/ ships its own gantt.test.js + dom-fixture.js against a
    // vanilla-JS Gantt component; it is not part of the Next app and must
    // stay out of this runner (see /SETUP.md).
    exclude: ["node_modules/**", "reference-ui/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
