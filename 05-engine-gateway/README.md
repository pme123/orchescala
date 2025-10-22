# Engine Gateway HTTP API

This module provides an HTTP REST API for the Engine Gateway using ZIO HTTP and Tapir.

## Overview

The Engine Gateway HTTP API allows you to interact with the Gateway through REST endpoints. The Gateway automatically routes requests to the appropriate Camunda engine (C7 or C8) based on the process definition and configured engines.

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
import orchescala.engine.gateway.http.GatewayServer
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
import orchescala.engine.gateway.http.GatewayServer
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

### POST /process/{processDefId}/async

Starts a new process instance asynchronously.

**Path Parameters:**
- `processDefId` (string): Process definition ID or key

**Request Body:**
```json
{
  "variables": {
    "myVar": "myValue",
    "anotherVar": 123
  },
  "businessKey": "optional-business-key"
}
```

**Response (200 OK):**
```json
{
  "processInstanceId": "f150c3f1-13f5-11ec-936e-0242ac1d0007",
  "businessKey": "optional-business-key",
  "status": "Active",
  "engineType": "C7"
}
```

**Error Response (400/500):**
```json
{
  "message": "Error description",
  "code": "ERROR_CODE"
}
```

### Example cURL Request

```bash
curl -X POST http://localhost:8080/process/my-process-id/async \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "customerName": "John Doe",
      "orderAmount": 1500
    },
    "businessKey": "order-12345"
  }'
```

## Architecture

The HTTP API is structured as follows:

```
05-engine-gateway/src/main/scala/orchescala/engine/gateway/http/
├── GatewayDtos.scala          # Request/Response DTOs
├── GatewayEndpoints.scala     # Tapir endpoint definitions
├── GatewayRoutes.scala        # ZIO HTTP route implementations
├── GatewayServer.scala        # HTTP server setup
└── GatewayServerApp.scala     # Example application
```

### Components

1. **GatewayDtos**: Type-safe data transfer objects with JSON codecs and API schemas
2. **GatewayEndpoints**: Tapir endpoint definitions with OpenAPI documentation
3. **GatewayRoutes**: ZIO HTTP routes that implement the endpoints
4. **GatewayServer**: Server configuration and startup logic
5. **GatewayServerApp**: Example application demonstrating usage

## Integration with Existing Code

The HTTP API integrates seamlessly with the existing Gateway infrastructure:

- Uses `GProcessEngine` for engine orchestration
- Leverages `GProcessInstanceService` for process operations
- Supports both C7 and C8 engines through the Gateway pattern
- Maintains the same error handling and caching mechanisms

## Future Enhancements

Potential additions to the API:

- Additional endpoints for:
  - Getting process variables
  - Querying process instances
  - Handling incidents
  - Managing user tasks
  - Sending messages and signals
- WebSocket support for real-time updates
- GraphQL API alternative
- Rate limiting and authentication
- Metrics and monitoring endpoints

## Testing

To test the API:

1. Start your Camunda engines (C7 and/or C8)
2. Run the Gateway server
3. Use curl, Postman, or any HTTP client to interact with the endpoints

Example test:
```bash
# Start a process
curl -X POST http://localhost:8080/process/test-process/async \
  -H "Content-Type: application/json" \
  -d '{"variables": {"test": true}}'
```

## See Also

- [Engine Gateway Documentation](../README.md)
- [Tapir Documentation](https://tapir.softwaremill.com/)
- [ZIO HTTP Documentation](https://zio.dev/zio-http/)

