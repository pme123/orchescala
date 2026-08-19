# DMN Tester

Test your DMN decision tables - in a web UI and in your project's JVM.

Business people define the **test inputs** for a DMN table; the tester
evaluates **every combination** of those inputs against the real DMN engine and
reports which rule matched, which rules were never reached, errors, and whether
the outputs are the ones you expected.

## Try it

```bash
sbt dmnTesterClient/fullLinkJS                       # links the Scala.js UI
npm --prefix 04-dmntester-client ci                  # once
npm --prefix 04-dmntester-client run build           # bundles it
sbt dmnTester                                        # -> http://localhost:8883
```

`sbt dmnTester` runs [`ExampleDmnTesterApp`](src/test/scala/orchescala/dmntester/ExampleDmnTesterApp.scala)
with the example DMNs of this repository - the dropdown offers the C7 and the
C8 examples. Stop it with Ctrl-C.

That example is written exactly like a project writes it, see
[the docs](../00-docs/src/docs/functionalityDsls/dmnTester.md):

```scala
// company level
trait CompanyDmnTester extends DmnTesterApp:
  override protected def starterConfig: DmnTesterStarterConfig =
    DmnTesterStarterConfig(companyName = "mycompany")

// project level - `dmn/runMain mycompany.myproject.dmn.ProjectDmnTester`
object ProjectDmnTester extends CompanyDmnTester:
  override protected def dmnTesterObjects = Seq(
    DocumentInfoDmn.example.testUnit
      .testValues(_.docId, "Basisvertrag", "QR-Rechnung")
      .acceptMissingRules
  )
```

It writes the `*.conf` test definitions, starts the tester **in this JVM** and
keeps it running until you stop it. There is no Docker any more.

## DMNs of several platforms

Name your DMN sources and one tester covers them all:

```scala
DmnTesterStarterConfig(
  companyName = "mycompany",
  dmnSources = Map(
    "c7" -> projectBasePath / "src" / "main" / "resources" / "camunda",
    "c8" -> projectBasePath / "c8" / "src" / "main" / "resources"
  )
)

// in the project - ONE line per decision, whatever platforms it exists on
MyDmn.example.testUnit
```

A decision is looked up in every source; each source that has the DMN gets its
own configuration (`dmnConfigs/c7/...`, `dmnConfigs/c8/...`), and the tester
shows one group per sub directory. So the same test inputs run against both
versions of a DMN - the migration case.

What is missing is reported, not guessed: a decision whose DMN is in no source,
and a DMN that no decision covers. Pin a decision to one platform with
`.from("c8")`.

### One configuration, several DMNs - the migration diff

A decision that exists on both platforms gets **one** configuration that
references both DMNs:

```hocon
decisionId = documents-documentInfo
dmnPaths {
  c7 = "src/main/resources/camunda/documents-documentInfo.dmn"
  c8 = "c8/src/main/resources/documents-documentInfo.dmn"
}
```

A run evaluates every referenced DMN and shows one result per platform (with a
`c7` / `c8` badge). Because there is only ONE set of `testCases`, the migration
workflow falls out of it:

1. accept the results of the old version (`c7`) - they become the expectation,
2. the same expectation is checked against `c8` in the very same run,
3. a difference between the versions shows up as a red row.

## Which engine?

**dmn-scala 1.11.0 / feel-scala 1.20.0** - the DMN engine that is embedded in
Camunda 8. So what you test here is what Camunda 8 does, including its FEEL
semantics (an unknown variable evaluates to `null` instead of failing).

- DMNs from the **Camunda 8 Modeler** (DMN 1.3) are supported.
- FEEL-only DMNs of the **Camunda 7 family** are covered too - the same FEEL
  engine evaluates them.
- **JUEL / script expressions are out of scope** - FEEL only.

The engine sits behind the `DmnEvalEngine` SPI, so a second implementation
could be added without touching the tester. `org.camunda.*` appears only in
`server/engine`.

## The modules

| Module                | Artifact                       | What it is |
|-----------------------|--------------------------------|------------|
| `02-dmntester`        | `orchescala-dmntester`         | the model - cross built, because the Scala.js UI shares it |
| `03-dmn`              | `orchescala-dmn`               | the DSL to describe what shall be tested |
| `04-dmntester-server` | `orchescala-dmntester-server`  | engine, http server, config handling, `DmnTesterApp` |
| `04-dmntester-client` | not published                  | the UI (Scala.js + Laminar), bundled into the server jar |

## Test definitions (`*.conf`)

```hocon
decisionId = c8-dish
dmnPath = "04-dmntester-server/src/test/resources/dmn/c8/c8-dish.dmn"
isActive = true
testUnit = true             # ignore required decisions - test this table alone
acceptMissingRules = false  # true: rules that no input reaches are fine
data {
  inputs = [
    { key = season,     values = [Fall, Winter, Summer] },
    { key = guestCount, values = [4, 12] }
  ]
  variables = []            # other variables the DMN uses
  testCases = [             # what you expect - see below
    { inputs { season = Winter, guestCount = 4 }
      results = [ { rowIndex = 2, outputs { desiredDish = Roastbeef } } ] }
  ]
}
```

A configuration names its DMN **once**: `dmnPath` for a single one, `dmnPaths`
for several (see the migration section above) - never both.

`values` may be strings, numbers, booleans, ISO date-times
(`2021-12-23T00:00:00`) or `_NULL_`; `nullValue = true` adds `null` as an extra
input value. A config with `testUnit = false` is stored as `<decisionId>-INT.conf`.

## Test mode: accept what is correct

After a run every input row has an **OK** checkbox; everything green is
pre-checked. **Save n Test Case(s)** writes those rows into the `*.conf`, so the
evaluated outputs become the *expected* ones. From then on:

- output as expected -> green, output differs -> red with `expected / actual`,
  no expectation -> grey.

A decision tested together with its required decisions (`testUnit = false`)
shows one table per decision - only the main table is compared with your
expectations.

## Developing

```bash
sbt dmnTesterServer/test                     # engine, config handling, http api
sbt "~dmnTesterClient/fastLinkJS"            # UI, terminal 1
npm --prefix 04-dmntester-client run dev     # UI on :5173, proxies /api to :8883
```

sbt links the Scala.js output to `04-dmntester-client/target/scalajs/{dev,prod}`
(`fastLinkJS` / `fullLinkJS`); vite bundles it into
`04-dmntester-client/dist/webapp`, which is packaged into
`orchescala-dmntester-server` as `webapp/...` resources. If the link step is
missing, the vite build says so instead of producing a broken bundle.
`packageBin` fails if it is missing, so a published tester always has its UI -
CI builds it (see `.github/workflows`).
