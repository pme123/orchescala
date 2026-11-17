import { existsSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { defineConfig } from "vite";

function isDev() {
  return process.env.NODE_ENV !== "production";
}

// Where sbt links the Scala.js output to - see build.sbt (dmnTesterClient):
//   fastLinkJS -> <target>/scalajs/dev      fullLinkJS -> <target>/scalajs/prod
// `sbt dmnTesterClient/bundleClient` passes the directory (SCALAJS_OUTPUT). Without it
// (`npm run dev`) it is looked up in sbt's target of the build:
// target/out/sjs1/scala-<version>/orchescala-dmntester-client - after a Scala update the
// one of the old version may still be there: the most recently linked one wins
const stage = isDev() ? "dev" : "prod";
function sbtTarget() {
  const base = resolve(__dirname, "..", "target", "out", "sjs1");
  const scalaDirs = existsSync(base) ? readdirSync(base).filter((d) => d.startsWith("scala-")) : [];
  const linked = scalaDirs
    .map((d) => resolve(base, d, "orchescala-dmntester-client", "scalajs", stage))
    .filter((c) => existsSync(resolve(c, "main.js")))
    .sort((a, b) => statSync(resolve(b, "main.js")).mtimeMs - statSync(resolve(a, "main.js")).mtimeMs);
  // none: the check below names the directory and how to link it
  return linked[0] ?? resolve(base, "scala-<version>", "orchescala-dmntester-client", "scalajs", stage);
}
const scalaJSOutput = process.env.SCALAJS_OUTPUT || sbtTarget();

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
  // a Scala.js bundle is ~1MB - that is expected, no need to warn about it
  build: { outDir: "dist/webapp", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    proxy: { "/api": "http://localhost:8883", "/info": "http://localhost:8883" }
  },
  resolve: {
    alias: [{ find: "@scalaJSOutput", replacement: scalaJSOutput }]
  }
});
