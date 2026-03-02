# BPMN Engine Support

Orchescala is designed to be **engine-agnostic**. The Gateway abstracts away the differences between
BPMN engines and provides a unified REST API regardless of which engine runs your processes.

## Supported Engines

Currently, Orchescala supports three BPMN engines:

| Engine        | Module                 | Client     | Description                                                        | State            |
|---------------|------------------------|------------|--------------------------------------------------------------------|------------------|
| **Camunda 7** | `orchescala-engine-c7` | `C7Client` | The classic Camunda Platform via REST API                          | Production       |
| **Camunda 8** | `orchescala-engine-c8` | `C8Client` | Zeebe Engine via REST API                                          | Proof of Concept |
| **Operaton**  | `orchescala-engine-op` | `OpClient` | [Operaton](https://operaton.org/) – the open-source Camunda 7 fork | Proof of Concept |

### Camunda 7

Camunda 7 is the classic, well-established BPMN engine with a REST API.
Orchescala communicates via the community REST client library.

**Authentication Options:**

- `C7LocalClient` – No authentication (local development)
- `C7BasicAuthClient` – Username/password authentication
- `C7OAuth2Client` – OAuth2 client credentials flow

```scala
// Local development
object MyC7Client extends C7LocalClient:
  val camundaRestUrl = "http://localhost:8080/engine-rest"

// Basic Auth
object MyC7Client extends C7BasicAuthClient:
  val camundaRestUrl = "http://localhost:8080/engine-rest"
  val username = "demo"
  val password = "demo"
```

### Camunda 8

Camunda 8 (Zeebe) uses gRPC for command execution and REST for queries.
Orchescala uses the official Camunda Java Client.

**Authentication Options:**

- `C8SaasClient` – For Camunda 8 SaaS (OAuth2)
- `C8BearerTokenClient` – For self-managed with Bearer token authentication
- Direct client – For local development without authentication

```scala
// SaaS
object MyC8Client extends C8SaasClient:
  val zeebeGrpc = "https://xxx.zeebe.camunda.io:443"
  val zeebeRest = "https://xxx.operate.camunda.io:443"
  val audience = "zeebe.camunda.io"
  val clientId = "your-client-id"
  val clientSecret = "your-secret"
  val oAuthAPI = "https://login.cloud.camunda.io/oauth/token"

// Self-managed with Bearer token
object MyC8Client extends C8BearerTokenClient:
  val zeebeGrpc = "http://localhost:26500"
  val zeebeRest = "http://localhost:8080"
```

### Operaton

[Operaton](https://operaton.org/) is the open-source fork of Camunda 7, maintained by the community.
Since Operaton keeps the Camunda 7 REST API, Orchescala reuses the same client library internally.

**Authentication Options:**

- `OpLocalClient` – No authentication (local development)
- `OpBasicAuthClient` – Username/password authentication
- `OpOAuth2Client` – OAuth2 client credentials flow

```scala
// Local development
object MyOpClient extends OpLocalClient:
  val operatonRestUrl = "http://localhost:8080/engine-rest"
```

## Unified Architecture

All three engines implement the same `ProcessEngine` trait, which defines a common interface
for process operations:

```
ProcessEngine (trait)
├── processInstanceService     – Start processes, query variables
├── historicProcessInstanceService – Query process history
├── historicVariableService    – Query historic variables
├── incidentService            – Manage incidents
├── jobService                 – Query and manage jobs
├── messageService             – Correlate messages
├── signalService              – Broadcast signals
└── userTaskService            – Query and complete user tasks
```

Each engine provides its own implementation:

- `C7ProcessEngine` → uses the Camunda 7 REST API
- `C8ProcessEngine` → uses the Camunda 8 Java Client (gRPC + REST)
- `OpProcessEngine` → uses the Operaton REST API

## Gateway: Automatic Engine Routing

The **Engine Gateway** (`GProcessEngine`) sits on top of the engine-specific implementations.
It enables you to run **multiple engines simultaneously** and routes each request to the correct engine automatically.

### How Routing Works

1. **Try all configured engines** – The Gateway tries each engine in sequence until one succeeds.
2. **Cache the result** – Once a process instance is found on a specific engine,
   the mapping is cached (15 minutes, max 100 entries) so subsequent requests go directly to the right engine.
3. **Heuristic optimization** – For known process instance IDs, the Gateway can often determine the engine type
   without querying:
    - **UUID format** (e.g., `f150c3f1-13f5-11ec-936e-0242ac1d0007`) → likely **Camunda 8**
    - **Numeric format** (e.g., `12345`) → likely **Camunda 7 / Operaton**

### Configuration Example

```scala
import orchescala.gateway.*
import orchescala.engine.*
import orchescala.engine.c7.C7Client
import orchescala.engine.c8.C8Client

object MyGatewayApp extends GatewayServer

:

def config: GatewayConfig = DefaultGatewayConfig(
  engineConfig = DefaultEngineConfig(),
  workerConfig = DefaultWorkerConfig(DefaultEngineConfig()),
  gatewayPort = 8888
)

// Configure which engines are available
override def c7Clients: Seq[C7Client] = Seq(myC7Client)

override def c8Clients: Seq[C8Client] = Seq(myC8Client)
```

With this setup, the Gateway provides a **single REST API** that transparently handles processes
on Camunda 7/ Operaton and Camunda 8.

## Worker Support per Engine

Workers also have engine-specific implementations, following the same pattern:

| Engine        | Worker Module          | Description                                | State            |
|---------------|------------------------|--------------------------------------------|------------------|
| **Camunda 7** | `orchescala-worker-c7` | External Task workers via Camunda 7 Worker | Production       |
| **Camunda 8** | `orchescala-worker-c8` | Job workers via Camunda 8 Worker           | Proof of Concept |
| **Operaton**  | `orchescala-worker-op` | External Task workers via Operaton Worker  | Proof of Concept |

All workers share the same base `Worker` abstraction from `orchescala-worker`,
so your business logic remains **engine-independent**.

## Worker Forwarding

The Gateway supports **forwarding worker requests** to remote Worker applications via HTTP.
This allows you to deploy workers as independent microservices.

The `EngineConfig.workerAppUrl` function determines where a worker request should be sent,
based on the topic name. If it returns `None`, the worker is executed locally.

```scala
// Default: forward to microservice based on topic name
workerAppUrl = topicName =>
  Some(s"http://${topicName.split('-').take(2).mkString("-")}:5555")

// Local development: all workers run locally
workerAppUrl = _ => Some("http://localhost:5555")
```

## Adding a New Engine

The modular architecture makes it straightforward to add support for additional BPMN engines.
The key steps are:

1. **Implement `ProcessEngine`** – Provide implementations for all service traits
   (`ProcessInstanceService`, `UserTaskService`, etc.)
2. **Create a Client** – Define a client trait for connection management
3. **Register in the Gateway** – Add the new engine to the `GProcessEngine` configuration
4. **Implement Workers** (optional) – Provide engine-specific worker implementations

The shared `orchescala-engine` module defines all interfaces, ensuring that any new engine
integrates seamlessly with the existing Gateway, API documentation, and simulation infrastructure.

