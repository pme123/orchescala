# updateVersions

Check all dependencies in this sbt project for available updates, then apply all safe (backwards-compatible) updates and report breaking changes that need manual attention.

## Steps

1. **Read current versions** from these files:
   - `project/build.properties` (sbt version)
   - `project/plugins.sbt` (sbt plugins)
   - `project/Dependencies.scala` (all library versions and plugin version vals)
   - `project/Settings.scala` (Scala version via `scalaV`)

2. **Search for the latest version** of every dependency using web search.
   Search for each one individually: `"<artifactId> latest version <current year> maven"`.
   Always use the current date to judge recency.

3. **Classify each dependency** into one of three groups:

   ### 🟢 Already up-to-date
   No action needed.

   ### 🟡 Safe update (backwards-compatible)
   Criteria: same major version, patch or minor bump, no documented breaking changes.
   Includes: Scala patch releases, sbt patch releases, sbt plugins (patch/minor), library patch/minor updates within the same stable series.

   ### 🔴 Breaking change / larger effort
   Criteria: major version bump, documented API changes, EOL notices, alpha→stable transitions requiring migration, or dependency on a discontinued project.
   Do NOT apply these automatically — only report them with a brief explanation.

4. **Apply all 🟡 safe updates** by editing:
   - `project/build.properties` for sbt
   - `project/plugins.sbt` for plugin versions
   - `project/Dependencies.scala` for library version vals and plugin version vals (the `val sbtNativePackager`, `val sbtCiRelease`, etc. at the bottom)
   - `project/Settings.scala` for `scalaV`

   Only edit the version string itself — do not change structure, formatting, or comments.

5. **Output a summary table** with three sections:
   - ✅ Already up-to-date (list)
   - 🟡 Updates applied (table: dependency | old → new)
   - 🔴 Breaking changes to handle manually (table: dependency | current | latest | reason)
