import { existsSync } from "fs";
import { resolve } from "path";
import { defineConfig } from "vite";

function isDev() {
  return process.env.NODE_ENV !== "production";
}

// Where sbt links the Scala.js output to - see build.sbt (dmnTesterClient):
//   fastLinkJS -> target/scalajs/dev      fullLinkJS -> target/scalajs/prod
const stage = isDev() ? "dev" : "prod";
const scalaJSOutput = resolve(__dirname, "target", "scalajs", stage);

if (!existsSync(resolve(scalaJSOutput, "main.js"))) {
  throw new Error(
    `The Scala.js output is missing: ${scalaJSOutput}/main.js\n` +
      `Link it first:  sbt dmnTesterClient/${isDev() ? "fastLinkJS" : "fullLinkJS"}`
  );
}
console.log(`Scala.js output: ${scalaJSOutput}`);

export default defineConfig({
  // the server packages this into its jar (see build.sbt: dmnTesterServer).
  // `dist` is the resource directory, so ONLY `webapp` ends up in the jar -
  // never the rest of target/. It is next to target/ on purpose: `sbt clean`
  // must not throw the built UI away.
  build: { outDir: "dist/webapp", emptyOutDir: true },
  server: {
    proxy: { "/api": "http://localhost:8883", "/info": "http://localhost:8883" }
  },
  resolve: {
    alias: [{ find: "@scalaJSOutput", replacement: scalaJSOutput }]
  }
});
