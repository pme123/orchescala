# Technologies

Our goal is to keep the dependencies to a minimum.
We group them to our Modules.
The following Open Source Projects are great and are worth the extra dependency:

## orchescala-domain
### Tapir
_With [tapir](https://tapir.softwaremill.com/en/latest/), you can describe HTTP API endpoints as immutable Scala values._ 

We are using this to describe our domain models. 
Tapir allows us to generate the Open API specification from the models.

### Circe
_[circe](https://circe.github.io/circe/) (pronounced SUR-see, or KEER-kee in classical Greek, or CHEER-chay in Ecclesiastical Latin) is a JSON library for Scala (and Scala.js)._

We use Circe to encode our domain models to JSON and decode them back.
This is used by Tapir to generate the specifications and the Simulations to run 
the REST calls.

## orchescala-bpmn
Depends on: _orchescala-domain_
### OS-Lib

_[OS-Lib](https://github.com/com-lihaoyi/os-lib) is a simple Scala interface to common OS filesystem and subprocess APIs. 
OS-Lib aims to make working with files and processes in Scala as simple as any scripting language, while still providing the safety, 
flexibility and performance you would expect from Scala._

## orchescala-api
Depends on: _orchescala-bpmn_

### scala-xml
_The standard [Scala XML](https://github.com/scala/scala-xml) library._ 

We use it for the reference resolutions in the BPMNs.

### Typesafe Config
_[Configuration library](https://github.com/lightbend/config) for JVM languages._

For all configurations, that are not directly in Scala, we use this library. 
At the moment this is _PROJECT.conf_ (Project Documentation) and _RELEASE.conf_ (Company Documentation).

## orchescala-simulation
Depends on: _orchescala-bpmn_

### sttp Client
_[sttp client](https://sttp.softwaremill.com/en/stable/) is an open-source library which provides a clean, programmer-friendly API to describe HTTP requests and how to handle responses._

We use it to call the REST API from Camunda

## orchescala-dmn
Depends on: _orchescala-bpmn_

### DMN Tester
A little DMN Table tester with the following goals:

- _As a developer I want to test the DMNs that I get from the Business, even not knowing the concrete rules._
- _Business people can create their own tests._
- _They can easily adjust the tests to the dynamic nature of DMN Tables._

`orchescala-dmn` is the DSL to describe the tests; the tester itself lives in
_orchescala-dmntester-server_ and runs in your project's JVM.

## orchescala-dmntester
Depends on: nothing (it is cross built for the JVM and for Scala.js)

The model of the DMN Tester: `DmnConfig` (the test definition, persisted as
HOCON), `DmnTable` and `DmnEvalResult` (what a test run produced). Server and
UI share it, JSON is the only contract between them.

## orchescala-dmntester-server
Depends on: _orchescala-dmn_, _orchescala-dmntester_

The DMN Tester as an app - no Docker needed:

- **dmn-scala** (`org.camunda.bpm.extension.dmn.scala:dmn-engine`) - the DMN
  engine that is embedded in Camunda 8, so you test the FEEL semantics you get
  in production. DMNs of the Camunda 7 family are covered too, as long as they
  are FEEL only (JUEL and script expressions are out of scope).
- **http4s** - serves the API and the UI on `http://localhost:8883`.
- The UI (Scala.js + Laminar) ships inside the jar.

