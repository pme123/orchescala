# Gateway HTTP API

This module provides an HTTP REST API for the Gateway using ZIO HTTP and Tapir.

## Overview

The Gateway HTTP API allows you to interact with the Gateway through REST endpoints. The Gateway automatically routes requests to the appropriate Camunda engine (C7 or C8) based on the process definition and configured engines.

## Features

- **RESTful API**: Clean HTTP endpoints for process operations
- **Automatic Engine Routing**: Gateway automatically selects the right engine (C7/C8)
- **OpenAPI Documentation**: Full API documentation via Tapir
- **Type-Safe**: Leverages Scala 3 and Tapir for compile-time safety
- **ZIO Integration**: Built on ZIO for composable, type-safe effects

## Getting Started

### Dependencies

The module includes:
- `zio-http` for the HTTP server
- `tapir-zio-http-server` for endpoint integration
- `tapir-openapi-docs` for API documentation

### Running the Server

#### Simple Example

```scala
import orchescala.gateway.http.GatewayServer
import orchescala.engine.c7.C7Client
import orchescala.engine.c8.C8Client
import zio.*

object MyApp extends ZIOAppDefault:
  def run =
    GatewayServer.start(
      port = 8080,
      c7Clients = Seq(C7Client.local),
      c8Clients = Seq(C8Client.local)
    )
```

#### With Custom Configuration

```scala
import orchescala.engine.EngineConfig
import orchescala.gateway.http.GatewayServer
import orchescala.engine.c7.C7Client
import orchescala.engine.c8.C8Client

object MyApp extends ZIOAppDefault:
  def run =
    val engineConfig = EngineConfig(
      tenantId = Some("my-tenant"),
      engineType = EngineType.Gateway
    )
    
    GatewayServer.start(
      port = 8080,
      c7Clients = Seq(
        C7Client("http://localhost:8080/engine-rest")
      ),
      c8Clients = Seq(
        C8Client.local
      ),
      engineConfig = engineConfig
    )
```

## API Endpoints

All endpoints require Bearer token authentication via the `Authorization` header.

### POST /process/{processDefId}/async

Starts a new process instance asynchronously.

**Path Parameters:**
- `processDefId` (string): Process definition ID or key

**Query Parameters:**
- `businessKey` (optional string): Business Key (not supported in Camunda 8)
- `tenantId` (optional string): Tenant ID for multi-tenant setups

**Request Body:**
```json
{
  "customerName": "John Doe",
  "orderAmount": 1500
}
```

**Response (200 OK):**
```json
{
  "processInstanceId": "f150c3f1-13f5-11ec-936e-0242ac1d0007",
  "businessKey": "order-12345",
  "status": "Active",
  "engineType": "C7"
}
```

**Example cURL Request:**
```bash
curl -X POST "http://localhost:8080/process/my-process-id/async?businessKey=order-12345" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "John Doe",
    "orderAmount": 1500
  }'
```

## Architecture

The HTTP API is structured as follows:

```
06-gateway/src/main/scala/orchescala/gateway/
├── http/
│   ├── GatewayDtos.scala              # Request/Response DTOs
│   ├── GatewayRoutes.scala            # ZIO HTTP route implementations
│   ├── GatewayServer.scala            # HTTP server setup
│   ├── ProcessInstanceEndpoints.scala # Process instance endpoints
│   ├── UserTaskEndpoints.scala        # User task endpoints
│   ├── MessageEndpoints.scala         # Message correlation endpoints
│   ├── SignalEndpoints.scala          # Signal endpoints
│   ├── OpenApiGenerator.scala         # OpenAPI specification generator
│   ├── OpenApiRoutes.scala            # Documentation routes
│   └── GenerateOpenApiYaml.scala      # CLI tool to generate OpenAPI YAML
└── exports.scala                      # Package exports
```

### Components

1. **GatewayDtos**: Type-safe data transfer objects with JSON codecs and API schemas
2. **ProcessInstanceEndpoints**: Tapir endpoint definitions for process instance operations
3. **UserTaskEndpoints**: Tapir endpoint definitions for user task operations
4. **MessageEndpoints**: Tapir endpoint definitions for message correlation
5. **SignalEndpoints**: Tapir endpoint definitions for signal broadcasting
6. **GatewayRoutes**: ZIO HTTP routes that implement all endpoints with authentication
7. **GatewayServer**: Server configuration and startup logic
8. **OpenApiGenerator**: Generates OpenAPI specification from Tapir endpoints
9. **OpenApiRoutes**: Serves OpenAPI documentation at `/docs`

## Authentication

All API endpoints require Bearer token authentication. By default, the server uses a simple token validator that accepts any non-empty token. You can provide a custom token validator:

```scala
import orchescala.gateway.http.GatewayRoutes
import zio.*

val customValidator: String => IO[ErrorResponse, String] = token =>
  if token == "valid-token" then
    ZIO.succeed(token)
  else
    ZIO.fail(ErrorResponse("Invalid token", Some("UNAUTHORIZED")))

val routes = GatewayRoutes.routes(
  processInstanceService,
  userTaskService,
  signalService,
  messageService,
  validateToken = customValidator
)
```

The validated token is stored in `AuthContext` and can be accessed by engine services for downstream authentication.

## Integration with Existing Code

The HTTP API integrates seamlessly with the existing Gateway infrastructure:

- Uses `GProcessEngine` for engine orchestration
- Leverages service interfaces (`ProcessInstanceService`, `UserTaskService`, `MessageService`, `SignalService`)
- Supports both C7 and C8 engines through the Gateway pattern
- Maintains the same error handling and caching mechanisms
- Bearer token is propagated via `AuthContext` for downstream service calls

## OpenAPI Documentation

The server automatically generates and serves OpenAPI documentation:

- **HTML Documentation**: Available at `http://localhost:8080/docs`
- **OpenAPI YAML**: Available at `http://localhost:8080/docs/openapi.yml`

You can also generate the OpenAPI YAML file using the CLI tool:

```bash
scala-cli run 06-gateway/src/main/scala/orchescala/gateway/http/GenerateOpenApiYaml.scala
```

## Future Enhancements

Potential additions to the API:

- Additional endpoints for:
  - Querying process instances
  - Handling incidents
  - Getting process variables
  - Canceling process instances
- WebSocket support for real-time updates
- GraphQL API alternative
- Advanced rate limiting
- Metrics and monitoring endpoints

## Testing

To test the API:

1. Start your Camunda engines (C7 and/or C8)
2. Run the Gateway server
3. Use curl, Postman, or any HTTP client to interact with the endpoints

Example test workflow:
```bash
# 1. Start a process
curl -X POST "http://localhost:8080/process/test-process/async?businessKey=test-123" \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{"customerName": "Test User", "amount": 1000}'

# 2. Get user task variables (wait up to 30 seconds for task to become active)
curl -X GET "http://localhost:8080/process/PROCESS_INSTANCE_ID/userTask/approve-task/variables?timeoutInSec=30" \
  -H "Authorization: Bearer test-token"

# 3. Complete the user task
curl -X POST "http://localhost:8080/process/PROCESS_INSTANCE_ID/userTask/approve-task/TASK_ID/complete" \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{"approved": true}'
```

## See Also

- [Engine Gateway Documentation](../05-engine-gateway/README.md)
- [Tapir Documentation](https://tapir.softwaremill.com/)
- [ZIO HTTP Documentation](https://zio.dev/zio-http/)

