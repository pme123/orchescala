import { spawnSync } from "child_process";
import { defineConfig } from "vite";

function isDev() {
  return process.env.NODE_ENV !== "production";
}

/** asks sbt where it linked the Scala.js output to */
function printSbtTask(task) {
  const args = ["--error", `print ${task}`];
  const options = { stdio: ["pipe", "pipe", "inherit"], cwd: ".." };
  const result =
    process.platform === "win32"
      ? spawnSync("sbt.bat", args.map((x) => `"${x}"`), { shell: true, ...options })
      : spawnSync("sbt", args, options);
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`sbt process failed with exit code ${result.status}`);
  const output = result.stdout.toString("utf8").trim().split("\n");
  const path = output[output.length - 1].trim();
  console.log("Scala.js output path: " + path);
  return path;
}

const scalaJSOutput = printSbtTask(
  isDev() ? "dmnTesterClient/fastLinkJSOutput" : "dmnTesterClient/fullLinkJSOutput"
);

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
