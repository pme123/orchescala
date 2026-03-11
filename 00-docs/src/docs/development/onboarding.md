# Onboarding
**_Welcome to the Team 🚀_**

> This document guides you step by step through the key technologies and tools of our tech stack. The order is intentional: first you learn the domain fundamentals, then the technical platform, and finally our programming language and framework.


## Fundamentals: BPMN & DMN

Before diving into the tools, it's important to understand the underlying standards. BPMN and DMN are the **language** we use to describe business processes and decision logic.

### What is BPMN?

**Business Process Model and Notation (BPMN)** is a graphical standard for modeling business processes. It defines a unified notation that is understood by both domain experts and developers.

### What is DMN?

**Decision Model and Notation (DMN)** complements BPMN with the modeling of decision logic – typically in the form of **Decision Tables**.

### Installation & Tools (Mac)

```bash
# Option 1: Camunda Modeler (recommended – supports BPMN & DMN)
brew install --cask camunda-modeler
```

Or download manually: [https://camunda.com/download/modeler/](https://camunda.com/download/modeler/)

### Further Reading

- 📖 [BPMN Specification (OMG)](https://www.omg.org/spec/BPMN/2.0/)
- 📖 [DMN Specification (OMG)](https://www.omg.org/spec/DMN/)
- 🎓 [BPMN Tutorial – Camunda](https://camunda.com/bpmn/)
- 🎓 [DMN Tutorial – Camunda](https://camunda.com/dmn/)

---

## Process Engines – Overview

Orchescala is **engine-agnostic** – it supports multiple BPMN engines through a unified abstraction. For onboarding, it's important to understand the differences.

### Supported Engines

| Engine | Description | Status | Architecture |
|---|---|---|---|
| **Camunda 7** | The classic Camunda platform | Production | Embedded or standalone engine, REST API |
| **Camunda 8** | Zeebe-based cloud-native engine | Proof of Concept | Distributed engine, gRPC + REST API |
| **Operaton** | Open-source fork of Camunda 7 | Proof of Concept | Same as Camunda 7 (compatible REST API) |
| **Workflows4s** | Scala-native in-process engine | Proof of Concept | No external server, runs inside the application |

### Camunda 7

The **classic Camunda platform** – battle-tested for years and our **production standard**.

**Core Concepts:**
- **Process Engine**: Executes BPMN processes
- **Tasklist**: UI for human tasks (User Tasks)
- **Cockpit**: Monitoring & Operations
- **REST API**: External systems interact via HTTP
- **External Tasks**: Worker pattern for Service Tasks

**Installation (Mac):**

```bash
# Via Docker (recommended for local development)
docker run -d --name camunda7 \
  -p 8080:8080 \
  camunda/camunda-bpm-platform:latest

# Cockpit & Tasklist: http://localhost:8080/camunda
# Default login: demo / demo
```

**Links:**
- 📖 [Camunda 7 Docs](https://docs.camunda.org/manual/latest/)
- 📖 [REST API Reference](https://docs.camunda.org/manual/latest/reference/rest/)
- 🎓 [Camunda Academy (free)](https://academy.camunda.com/)

### Camunda 8

The **next generation** – cloud-native, based on **Zeebe** as a distributed workflow engine.

**Key Differences from Camunda 7:**

| Aspect | Camunda 7 | Camunda 8 |
|---|---|---|
| **Engine** | Embedded / Standalone | Zeebe (distributed engine) |
| **Communication** | REST API | gRPC + REST API |
| **Variables** | Java objects + JSON | JSON only |
| **Expressions** | JUEL | FEEL |
| **Scripts** | Inline Groovy/JS | FEEL or Workers |
| **Tasklist** | Classic Tasklist | New Tasklist (React) |

**Installation (Mac):**

```bash
# Via Docker Compose (recommended)
# See: https://github.com/camunda/camunda-platform

# Or: Camunda 8 SaaS (free trial)
# https://camunda.io
```

**Links:**
- 📖 [Camunda 8 Docs](https://docs.camunda.io/)
- 📖 [Zeebe Docs](https://docs.camunda.io/docs/components/zeebe/zeebe-overview/)
- 📖 [Migration C7 → C8](migrationC7toC8.md)

### Operaton

**[Operaton](https://operaton.org/)** is the **open-source fork of Camunda 7**, maintained by the community. The REST API is compatible with Camunda 7, allowing Orchescala to use the same client.

**Why Operaton?**
- 100% open source (no enterprise license required)
- API-compatible with Camunda 7
- Community-driven, independent development

**Installation (Mac):**

```bash
# Via Docker
docker run -d --name operaton \
  -p 8080:8080 \
  operaton/operaton:latest

# Web UI: http://localhost:8080/operaton
# Default login: demo / demo
```

**Links:**
- 📖 [Operaton Website](https://operaton.org/)
- 📖 [Operaton GitHub](https://github.com/operaton/operaton)

### Workflows4s (W4S)

**[Workflows4s](https://business4s.github.io/workflows4s/)** is a **Scala-native workflow engine** that runs **in-process** – no external BPMN server required. Workflows are defined directly in Scala code.

> 💡 W4S is especially suited when you want **type-safe workflows** without external infrastructure. For processes that need to be modeled by business analysts, BPMN engines remain the better choice.

**Links:**
- 📖 [Workflows4s Docs](https://business4s.github.io/workflows4s/)
- 📖 [W4S in Orchescala](../engines/w4s.md)

### Which Engine to Use?

| Use Case | Recommended Engine |
|---|---|
| **Production processes (established)** | Camunda 7 |
| **New projects / cloud-native** | Camunda 8 |
| **Open source without license costs** | Operaton |
| **Internal Scala workflows** | Workflows4s |

> 📖 Detailed technical documentation: [Engine Support](../gateway/04-engine-support.md) · [Engines](../engines/w4s.md)

---

## Scala – User

As a **user** of Orchescala, you need to be able to read and write Scala to describe processes and domain objects – 
without diving deep into the infrastructure libraries. These two concepts and three domain libraries are sufficient for that.

### Setup (Mac)

```bash
# Install Coursier (Scala Toolchain Manager)
brew install coursier/formulas/coursier

# Set up Scala toolchain (installs Java, Scala, sbt, scala-cli, etc.)
cs setup

# Install specific Java version (Temurin 21 LTS recommended)
cs java --jvm temurin:21 --setup

# Verify everything is installed
java -version
scala -version
sbt --version
```

> 💡 `cs setup` automatically installs a current JVM, Scala, sbt, and other useful tools. Use `cs java --jvm temurin:21 --setup` to set a specific JVM as the default.

**If Coursier doesn't work – Homebrew fallback:**

```bash
brew install --cask temurin@21
brew install scala sbt
```

```bash
# IntelliJ IDEA + Scala Plugin (recommended IDE)
brew install --cask intellij-idea
```

### Basics

The fundamentals of Scala – type system, collections, pattern matching, etc.

**Key Concepts:**
- `val` / `var` – immutable vs. mutable variables
- Case Classes & Sealed Traits – algebraic data types
- Pattern Matching – more powerful than `switch`
- Option, Either, Try – type-safe error handling
- Collections API – `map`, `filter`, `flatMap`, `fold`
- For-Comprehensions – syntactic sugar for monads

**Resources:**
- 🎓 [Scala 3 Book (official, free)](https://docs.scala-lang.org/scala3/book/introduction.html)
- 🎓 [Functional Programming in Scala (Coursera)](https://www.coursera.org/learn/scala-functional-programming)
- 📖 [Tour of Scala](https://docs.scala-lang.org/tour/tour-of-scala.html)

### DSLs (Domain Specific Languages)

Orchescala provides its own DSL for describing processes and workers. Scala is excellent for this thanks to its flexible syntax.

**Concepts:**
- Extension Methods – extend existing types
- Operator Overloading – readable expressions
- Builder Pattern – fluent APIs
- Typeclass-based DSLs

**Resources:**
- 📖 [Scala DSL Techniques](https://docs.scala-lang.org/scala3/reference/contextual/extension-methods.html)

### Iron

**Iron** is a Scala 3 library for **Refined Types** – types with embedded constraints that enable compile-time validation.

```scala
// Example: Type-safe amount – never negative
import io.github.iltotore.iron.*
import io.github.iltotore.iron.constraint.numeric.*

type PositiveAmount = Double :| Positive
val amount: PositiveAmount = 100.0.refineUnsafe
```

**Resources:**
- 📖 [Iron Documentation](https://iltotore.github.io/iron/docs/)
- 📖 [Iron GitHub](https://github.com/Iltotore/iron)

### Tapir

**Tapir** enables **type-safe HTTP API definitions** in Scala. Endpoints are described as values and can be interpreted as server, client, or OpenAPI documentation.

```scala
// Define endpoint
val bookListing: PublicEndpoint[Unit, String, List[Book], Any] =
  endpoint.get
    .in("books" / "list" / "all")
    .errorOut(stringBody)
    .out(jsonBody[List[Book]])
```

**Resources:**
- 📖 [Tapir Documentation](https://tapir.softwaremill.com/)
- 🎓 [Tapir Quickstart](https://tapir.softwaremill.com/en/latest/quickstart.html)
- 📖 [Tapir GitHub](https://github.com/softwaremill/tapir)

### Circe

**Circe** is the standard library for **JSON encoding/decoding** in our Scala stack.

```scala
import io.circe.*
import io.circe.generic.auto.*
import io.circe.syntax.*

case class Book(title: String, year: Int)

// Encoding: Scala → JSON
val json: Json = Book("Clean Code", 2008).asJson

// Decoding: JSON → Scala
val result: Either[Error, Book] = decode[Book]("""{"title":"Clean Code","year":2008}""")
```

**Resources:**
- 📖 [Circe Documentation](https://circe.github.io/circe/)
- 📖 [Circe GitHub](https://github.com/circe/circe)

---

## Orchescala – User

As a **user**, you use Orchescala to describe processes, domain objects, and workers – using the provided DSL. You don't need a deep understanding of the underlying libraries (ZIO, Tapir, etc.).

### What You Do as a User

- Describe processes and sub-processes in the Orchescala DSL
- Model domain objects (Input/Output) as Case Classes
- Implement workers for Service Tasks
- Reference DMN decisions

See **_[Orchescala - Introduction](/index.md)_**

---

## Backend Development

Our backend is built on modern principles of distributed systems and cloud-native development.

### Key Concepts

- **REST / HTTP APIs** – Communication between services
- **Event-driven Architecture** – Messaging via Kafka, etc.
- **Domain-Driven Design (DDD)** – Structuring business logic
- **Hexagonal Architecture** – Separation of domain and infrastructure

### Recommended Reading

- 📖 [Building Microservices – Sam Newman](https://samnewman.io/books/building_microservices/)
- 📖 [Domain-Driven Design Reference – Eric Evans](https://www.domainlanguage.com/ddd/reference/)
- 🎓 [Microservices.io – Patterns & Best Practices](https://microservices.io/)

---

## Open API

We use **OpenAPI (formerly Swagger)** for describing and documenting our REST APIs. API-first is our standard approach.

### Concepts

- **OpenAPI Specification (OAS 3.x)** – YAML/JSON-based API description
- **Code Generation** – Generate client/server stubs from the spec (e.g. via Tapir)
- **API-first** – Spec is defined first, implementation follows

### Tools (Mac)

```bash
# Swagger UI locally (via Docker)
docker run -p 8081:8080 swaggerapi/swagger-ui

# OpenAPI Generator CLI
brew install openapi-generator

# Example: Generate Scala client
openapi-generator generate -i openapi.yaml -g scala-sttp -o ./client
```

### Further Reading

- 📖 [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- 🛠️ [Swagger Editor (online)](https://editor.swagger.io/)
- 📖 [OpenAPI Generator](https://openapi-generator.tech/)

---

## Functional Programming

Functional programming (FP) is a fundamental paradigm in our stack – especially in Scala. It's worth understanding the concepts before diving deep into the developer libraries.

### Core Concepts

| Concept | Meaning |
|---|---|
| **Pure Functions** | No side effects, same input → same output |
| **Immutability** | Data is not modified, but recreated |
| **Higher-Order Functions** | Functions as parameters or return values |
| **Typeclasses** | Abstraction over types (Functor, Monad, etc.) |
| **Monads** | Structured chaining of computations (Option, Either, IO) |
| **Referential Transparency** | Expression can be replaced by its result |

### Recommended Resources

- 📖 [Scala with Cats (free)](https://www.scalawithcats.com/) – FP concepts with Scala
- 🎓 [Functional Programming in Scala (Coursera)](https://www.coursera.org/learn/scala-functional-programming)
- 📖 [Cats Documentation](https://typelevel.org/cats/)

---

## Groovy

**Groovy** is primarily used for **Camunda scripts** and **build scripts (Gradle)**. It is a dynamic JVM language with Scala/Java interoperability.

### Installation (Mac)

```bash
# Via Homebrew
brew install groovy

# Check version
groovy --version

# Interactive shell
groovysh
```

### Typical Usage in the Camunda Context

```groovy
// Example: Set process variable in a Script Task
execution.setVariable("approved", true)

// Read variables
def amount = execution.getVariable("amount") as Double

// Decision
if (amount > 10000) {
  execution.setVariable("requiresApproval", true)
}
```

### Further Reading

- 📖 [Groovy Documentation](https://groovy-lang.org/documentation.html)
- 📖 [Groovy in Camunda](https://docs.camunda.org/manual/latest/user-guide/process-engine/scripting/)
- 🎓 [Groovy Tutorial (TutorialsPoint)](https://www.tutorialspoint.com/groovy/index.htm)

---

## Scala – Developer

As a **developer** of the Orchescala framework, you need next to the basic Scala 3 stuff from above, 
an understanding of the Effect libraries like ZIO and Scala 3 Macros.

### Additional Setup (Mac)

```bash
# Scala CLI (already installed via `cs setup`, alternatively via Homebrew)
brew install Virtuslab/scala-cli/scala-cli

# List available JVMs
cs java --available

# Switch between JVM versions
cs java --jvm temurin:21 --setup   # Temurin 21 as default
cs java --jvm temurin:17 --setup   # Temurin 17 as default
```

### Scala 3 Macros

**Scala 3 Macros** enable **compile-time metaprogramming** in Scala – code that inspects or generates other code during compilation, before the program ever runs.

This is fundamentally different from runtime reflection: errors are caught at compile-time, there is no runtime overhead, and the generated code is fully type-safe.

**Key Macro Mechanisms:**

| Mechanism | Purpose |
|---|---|
| `inline` | Forces inlining at call-site; prerequisite for most macros |
| `Expr[T]` | Typed representation of a code expression |
| `Quotes` | The compile-time context needed to inspect/build expressions |
| `scala.quoted.*` | The standard macro API |

**How We Use It in Orchescala:**

The most visible use case is **automatic variable name extraction** in Simulations. Instead of specifying field names as strings (fragile, not refactor-safe), we extract them directly from the variable reference at compile-time:

```scala
// Without macros – fragile string, breaks silently on rename:
variable("amount", myProcess.amount)

// With macros – name is extracted from the val reference itself:
variable(myProcess.amount)  // name "amount" extracted at compile-time
```

Under the hood, a macro inspects the `Expr` of the argument, reads the symbol name from the AST, and injects it as a compile-time constant – no strings, no runtime cost.

**Inline + Macro pattern (simplified):**

```scala
import scala.quoted.*

inline def nameOf[T](inline value: T): String =
  ${ nameOfImpl('value) }

def nameOfImpl[T](expr: Expr[T])(using Quotes): Expr[String] =
  import quotes.reflect.*
  val name = expr.asTerm match
    case Select(_, name) => name
    case _               => report.errorAndAbort("Expected a field reference")
  Expr(name)
```

> 💡 You don't need to write macros as an Orchescala user – but understanding the concept helps you make sense of why the DSL can "magically" know variable names.

**Resources:**
- 📖 [Scala 3 Macros Guide](https://docs.scala-lang.org/scala3/guides/macros/macros.html)
- 📖 [Inline & Compile-time Ops](https://docs.scala-lang.org/scala3/guides/macros/inline.html)
- 📖 [Quoted Code – `Expr` and `Quotes`](https://docs.scala-lang.org/scala3/guides/macros/quotes.html)
- 🎓 [Macro Tutorial by Adam Warski](https://softwaremill.com/scala-3-macros-tips-and-tricks/)

### ZIO

**ZIO** is our primary framework for asynchronous and functional effects. It replaces Future and enables type-safe, composable effect management.

```bash
# Add to build.sbt
libraryDependencies += "dev.zio" %% "zio" % "2.x.x"
```

**Core Concepts:**
- `ZIO[R, E, A]` – Description of an effect (Environment, Error, Success)
- `ZLayer` – Dependency Injection
- `ZStream` – Streaming
- Fiber-based concurrency

**Resources:**
- 📖 [ZIO Documentation](https://zio.dev/)
- 🎓 [ZIO Quickstart](https://zio.dev/overview/getting-started)
- 📖 [ZIO GitHub](https://github.com/zio/zio)

---

## Orchescala – Developer

As a **developer** of Orchescala itself, you work on the framework core: designing the DSL, extending library integrations, and maintaining the infrastructure.

### What You Do as a Developer

- Design and implement Orchescala DSL constructs
- Build ZIO layers and services for new integrations
- Extend Tapir endpoints and OpenAPI generation
- Define Iron constraints for domain validation
- Implement Circe codecs for new data types
- Write framework tests and maintain CI/CD

### Architecture Overview

- Built on **Scala 3 + ZIO 2 + Tapir + Camunda REST API**
- Defines conventions for process workers, API endpoints, and data models
- Integrates domain concepts into a type-safe Scala API
- Uses **Iron** for validated domain objects and **Circe** for JSON serialization

### Getting Started

> ⚠️ **Internal framework**: Documentation and source code are available in the internal Git repository.

1. Request repository access from the team lead
2. Read the architecture documentation and Developer Guide (internal Confluence)
3. Build the framework module locally and run tests
4. Implement your first framework contribution via pair programming

---


*Questions? Don't hesitate to ask the team – nobody expects you to learn everything at once! 🙌*
