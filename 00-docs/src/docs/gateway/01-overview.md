# Overview

The Engine Gateway provides a RESTful interface to interact with process engines, 
automatically routing requests to the appropriate BPMN engine based on the process definition and the configured engines.

![Gateway Architecture](architecture.png)

## Features

- **RESTful API**: Clean HTTP endpoints for all process operations
- **Automatic Engine Routing**: Gateway automatically selects the right engine (for now C7 and/or C8)
- **OpenAPI Documentation**: Full API documentation
- **Type-Safe**: Leverages Scala 3 and Tapir for compile-time safety
- **ZIO Integration**: Built on ZIO for composable, type-safe effects
- **Bearer Token Authentication**: Secure token-based authentication with pass-through to the engines REST API.
- **Identity Correlation**: JWT-based user identity extraction for process security
- **Domain Driven**: The API leverages the Domain Driven nature of Orchescala. 
  Meaning the bodies represent the Domain Objects - In-/Out-Objects of the process interactions.

## Architecture

The Gateway module is built on three main components:

### 1. GatewayServer

The `GatewayServer` is an abstract class that extends `EngineApp` and `ZIOAppDefault`. It provides the HTTP server infrastructure and combines all route handlers.

```scala mdoc
import orchescala.gateway.*
import orchescala.engine.*
import orchescala.worker.*
import zio.*

abstract class MyGatewayApp extends GatewayServer:
  def config: GatewayConfig = DefaultGatewayConfig(
    engineConfig = DefaultEngineConfig(),
    workerConfig = DefaultWorkerConfig(DefaultEngineConfig()),
    gatewayPort = 8888
  )
```

### 2. GatewayConfig

The `GatewayConfig` trait defines the configuration interface for the gateway:

- `engineConfig: EngineConfig` - Engine configuration (tenantId, parallelism, etc.)
- `workerConfig: WorkerConfig` - Worker configuration for init worker pattern
- `gatewayPort: Int` - HTTP server port (default: 8888)
- `validateToken(token: String)` - Custom token validation logic
- `extractCorrelation(token: String, in: JsonObject)` - Extract identity correlation from JWT

The `DefaultGatewayConfig` provides a basic implementation with JWT-based token extraction.

### 3. Route Handlers

The gateway provides five main route handlers:

- **ProcessInstanceRoutes**: Starting processes and querying instances
- **UserTaskRoutes**: Getting task variables and completing tasks
- **WorkerRoutes**: Triggering workers via gateway
- **MessageRoutes**: Sending messages to processes
- **SignalRoutes**: Broadcasting signals

## Getting Started

### Basic Setup

```scala mdoc:reset
import orchescala.gateway.*
import orchescala.engine.*
import orchescala.worker.*
import zio.*

object MyGatewayApp extends GatewayServer:
  
  def config: GatewayConfig = DefaultGatewayConfig(
    engineConfig = DefaultEngineConfig(),
    workerConfig = DefaultWorkerConfig(DefaultEngineConfig()),
    gatewayPort = 8888
  )
```

### Custom Configuration

You can customize the gateway configuration by overriding the `validateToken` and `extractCorrelation` methods:

```scala mdoc:reset
import orchescala.gateway.*
import orchescala.engine.*
import orchescala.worker.*
import orchescala.domain.*
import zio.*

case class CustomGatewayConfig(
    engineConfig: EngineConfig,
    workerConfig: WorkerConfig,
    gatewayPort: Int = 8888
) extends GatewayConfig:
  
  override def validateToken(token: String): IO[GatewayError, String] =
    // Custom validation logic (e.g., verify JWT signature, check database)
    if token.startsWith("valid-") then
      ZIO.succeed(token)
    else
      ZIO.fail(GatewayError.TokenValidationError("Invalid token format"))
  
  override def extractCorrelation(
      token: String,
      in: JsonObject
  ): IO[GatewayError, IdentityCorrelation] =
    // Custom correlation extraction logic
    ZIO.succeed(IdentityCorrelation(
      username = "extracted-user",
      email = Some("user@example.com")
    ))
```

## OpenAPI Documentation

The gateway automatically generates and serves OpenAPI documentation:

- **HTML Documentation**: `http://localhost:8888/docs`
- **OpenAPI YAML**: `http://localhost:8888/docs/openapi.yml`

## Next Steps

- [Authentication & Security](02-authentication.md) - Learn about token validation and identity correlation
- [Impersonation](03-impersonation.md) - Understand identity correlation and process security

