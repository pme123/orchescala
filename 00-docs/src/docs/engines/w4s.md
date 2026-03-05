# Workflows4s (W4S) Engine

[Workflows4s](https://business4s.github.io/workflows4s/) is a **Scala-native workflow engine** that runs **in-process** — 
unlike Camunda 7/8 or Operaton, there is no external BPMN engine to deploy or connect to.

Workflows are defined directly in Scala code, not in BPMN XML.

## Key Differences to BPMN Engines

| Aspect                | BPMN Engines (C7/C8/Op)                        | Workflows4s (W4S)                              |
|-----------------------|-------------------------------------------------|------------------------------------------------|
| **Engine**            | External process (REST API / gRPC)              | In-process (runs inside your application)      |
| **Process Definition**| BPMN XML files                                  | Scala code (type-safe workflow DSL)            |
| **Deployment**        | Deploy BPMN to engine, connect workers           | Single application, no separate engine needed  |
| **Worker Execution**  | Engine polls workers / workers poll engine        | Engine calls workers directly in-process       |
| **State Management**  | Engine manages state externally                  | In-memory or persistent storage (configurable) |
| **Type Safety**       | Variable names as strings, runtime validation    | Compile-time type checking                     |
| **Scalability**       | Horizontal via engine cluster                    | Vertical (single process), horizontal via app  |

## When to Use W4S

W4S is a good fit when:

- You want **type-safe workflow definitions** in Scala
- You prefer **no external infrastructure** (no BPMN engine to manage)
- Your workflows are **application-internal** (not shared across teams via BPMN)
- You want **fast startup** and **simple deployment**

BPMN engines remain the better choice when:

- You need **visual process modeling** with BPMN diagrams
- **Business analysts** need to design or review processes
- You require **cross-team process orchestration**
- You need the **Camunda ecosystem** (Tasklist, Optimize, etc.)

## Architecture

```
┌─────────────────────────────────────────────┐
│              Your Application               │
│                                             │
│  ┌─────────────┐    ┌────────────────────┐  │
│  │  W4S Engine  │───▶│  W4S Workers       │  │
│  │  (in-process)│    │  (direct calls)    │  │
│  └─────────────┘    └────────────────────┘  │
│         │                                   │
│  ┌──────▼──────┐                            │
│  │  State Store │                            │
│  │  (memory or  │                            │
│  │   persistent)│                            │
│  └─────────────┘                            │
└─────────────────────────────────────────────┘
```

Compared to BPMN engines:

```
┌──────────────┐         ┌──────────────────┐
│ BPMN Engine  │◀─REST──▶│  Worker App      │
│ (external)   │         │  (separate)      │
└──────────────┘         └──────────────────┘
```

## Module Overview

| Module                  | Description                                      |
|-------------------------|--------------------------------------------------|
| `orchescala-engine-w4s`  | ProcessEngine implementation for W4S             |
| `orchescala-worker-w4s`  | Worker registry and worker traits for W4S        |

## CompanyWorkerApp with W4S

To use W4S in your `CompanyWorkerApp`, add the `W4SWorkerRegistry` alongside or instead of the BPMN engine registries:

```scala
package mycompany.orchescala.worker

import orchescala.worker.c7.C7WorkerRegistry   // Camunda 7 support
import orchescala.worker.c8.C8WorkerRegistry   // Camunda 8 support
import orchescala.worker.w4s.{W4SWorkerRegistry, W4SInMemoryWorkerClient} // W4S support

trait CompanyWorkerApp extends WorkerApp:

  // W4S only (no external engine needed)
  lazy val workerRegistries: Seq[WorkerRegistry] =
    Seq(W4SWorkerRegistry(W4SInMemoryWorkerClient))

  // Or mixed: BPMN workers + W4S workers side by side
  // lazy val workerRegistries: Seq[WorkerRegistry] =
  //   Seq(
  //     C7WorkerRegistry(CompanyC7Client),
  //     W4SWorkerRegistry(W4SInMemoryWorkerClient)
  //   )
```

### W4S Worker Client Options

| Client                      | Description                                    |
|-----------------------------|------------------------------------------------|
| `W4SInMemoryWorkerClient`   | In-memory engine, no persistence (development) |
| `W4SPersistentWorkerClient` | Persistent storage for durable workflow state   |

```scala
// In-memory (default, simplest setup)
W4SWorkerRegistry(W4SInMemoryWorkerClient)

// Persistent storage
W4SWorkerRegistry(W4SPersistentWorkerClient(storagePath = Some("w4s-data")))
```

## W4S Context

Unlike BPMN engines that require authentication and REST API configuration,
the W4S context is simpler — no external connection is needed:

```scala
trait W4SContext extends EngineContext:
  // Logging via SLF4J
  def getLogger(clazz: Class[?]): OrchescalaLogger =
    Slf4JLogger.logger(clazz.getName)

  // REST calls for service workers use the default client
  def sendRequest[ServiceIn: InOutEncoder, ServiceOut: {InOutDecoder, ClassTag}](
      request: RunnableRequest[ServiceIn]
  ): SendRequestType[ServiceOut] =
    DefaultRestApiClient.sendRequest(request)
```

There is no `CompanyEngineContext`, `CompanyPasswordFlow`, or `CompanyRestApiClient` needed for W4S — 
the engine runs locally and does not require authentication to a remote engine.

## Workflow Definition (Scala, not BPMN)

With W4S, workflows are defined in Scala code instead of BPMN XML.
This gives you compile-time type safety and IDE support.

**Example — a simple approval workflow:**

```scala
// Instead of a BPMN file, define the workflow in Scala:
import workflows4s.dsl.*

val approvalWorkflow = Workflow("approval-process")
  .step("validate-request")    // calls a validation worker
  .step("manager-approval")    // a user task / decision point
  .branch(
    on("approved") -> Workflow.step("execute-order"),
    on("rejected") -> Workflow.step("notify-rejection")
  )
  .step("send-confirmation")
  .end
```

@:callout(info)
The exact W4S workflow DSL syntax depends on the [Workflows4s library](https://business4s.github.io/workflows4s/).
The example above illustrates the concept — refer to the Workflows4s documentation for the actual API.
@:@

## Comparison: Same Process in BPMN vs W4S

**BPMN approach** (Camunda 7/8/Operaton):
1. Design process in BPMN Modeler → `approval-process.bpmn`
2. Deploy BPMN to engine
3. Implement workers that connect to the engine via REST/gRPC
4. Engine orchestrates the flow

**W4S approach:**
1. Define workflow in Scala code (type-safe, refactorable)
2. Workers run in the same application
3. No deployment step — workflow is part of your application
4. Engine runs in-process, calling workers directly

