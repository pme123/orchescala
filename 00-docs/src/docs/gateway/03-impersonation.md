# Impersonation Solution

## Overview

The Impersonation Solution provides a secure way to propagate user identity information through long-running BPMN process instances in Orchescala. It addresses the challenge of maintaining user context beyond JWT token expiration while preventing replay attacks and tampering.

## Problem Statement

### The Challenge

Long-running BPMN processes (days, weeks, or months) need to maintain user identity information beyond the typical JWT token expiration period. The identity information is stored in an `IdentityCorrelation` object as a process variable in Camunda.

### Security Risk

The `IdentityCorrelation` stored in process variables is accessible to anyone who can query the Camunda engine. This creates a security vulnerability:

- **Replay Attacks**: Someone could copy the correlation from one process and use it in another
- **Tampering**: The correlation data could be modified without detection
- **Unauthorized Access**: Stolen correlations could be used to impersonate users

### Solution Requirements

- Cryptographically bind identity to specific process instances
- Prevent replay attacks across different processes
- Detect any tampering with the correlation data
- Work seamlessly with long-running processes
- Maintain backward compatibility

## Architecture

### Core Components

#### 1. IdentityCorrelation (Domain Object)

The `IdentityCorrelation` case class contains user identity information with signature fields:

```scala
case class IdentityCorrelation(
    username: String,
    email: Option[String] = None,
    impersonateProcessValue: Option[String] = None,
    issuedAt: Long = System.currentTimeMillis(),
    processInstanceId: Option[String] = None,
    signature: Option[String] = None
)
```

**Fields:**
- `username`: The authenticated user's username
- `email`: Optional email address
- `impersonateProcessValue`: Optional value for impersonation scenarios, e.g. the client id for additional service authorizations.
- `issuedAt`: Timestamp when the correlation was created
- `processInstanceId`: The Camunda process instance ID this correlation is bound to
- `signature`: HMAC-SHA256 signature binding the correlation to the process instance

#### 2. IdentityCorrelationSigner (Utility)

Provides cryptographic signing and verification using HMAC-SHA256:

```scala
object IdentityCorrelationSigner:
  def sign(
      correlation: IdentityCorrelation,
      processInstanceId: String,
      signingKey: String
  ): IdentityCorrelation

  def verify(
      correlation: IdentityCorrelation,
      processInstanceId: String,
      signingKey: String
  ): Boolean
```

**Algorithm**: HMAC-SHA256
**Encoding**: Base64 for storage in process variables

#### 3. EngineConfig (Configuration)

Configuration object with signing key support:

```scala
case class EngineConfig(
    tenantId: Option[String] = None,
    impersonateProcessKey: Option[String] = None,
    identitySigningKey: Option[String] = sys.env.get("ORCHESCALA_IDENTITY_SIGNING_KEY")
)
```

**Default**: Reads from `ORCHESCALA_IDENTITY_SIGNING_KEY` environment variable
**Override**: Can be customized in `EngineConfig` implementations

## Implementation Flow 
Handled by the gateway and engine services. If you are interested in the internal stuff:).

### Process Start Flow

The two-step approach solves the chicken-and-egg problem of not having the `processInstanceId` before starting the process:

**Step 1: Start Process**
```scala
// Start process to get processInstanceId
val processInstance = processInstanceApi.startProcessInstanceByKey(..., unsignedCorrelation)
val processInstanceId = processInstance.getId
```

**Step 2: Sign and Update**
```scala
// Sign the correlation with the processInstanceId
val signedCorrelation = signCorrelation(unsignedCorrelation, processInstanceId)

// Update process variables with signed correlation
runtimeService.setVariable(processInstanceId, "_identityCorrelation", signedCorrelation)
```

**Implemented in:**
- `C7ProcessInstanceService.start()`
- `C8ProcessInstanceService.start()`

### User Task Completion Flow

Similar two-step approach for task completion:

**Step 1: Get Process Instance ID**
```scala
// Get processInstanceId from task
val processInstanceId = getProcessInstanceIdFromTask(taskId)
```

**Step 2: Sign and Complete**
```scala
// Sign the correlation
val signedCorrelation = signCorrelation(identityCorrelation, processInstanceId)

// Complete task with signed correlation
taskService.complete(taskId, variables)
```

**Implemented in:**
- `C7UserTaskService.complete()`
- `C8UserTaskService.complete()`

### Worker Verification Flow

Automatic signature verification for ServiceWorkers:

```scala
override def runWorkZIO(inputObject: In): RunnerOutputZIO =
  for
    // Automatic verification before service call
    _ <- verifyIdentityCorrelation()

    // Continue with service call
    rRequest <- createRequest(inputObject)
    response  <- sendRequest(rRequest)
    result    <- mapResponse(response)
  yield result
```

**Verification Logic:**
1. Extract `IdentityCorrelation` from process variables
2. Get `processInstanceId` from context
3. Verify signature matches using signing key from `EngineConfig`
4. Log warnings if verification fails (optional verification)

**Applies to:** ServiceWorkers only (not CustomWorkers)

## Security Features

### Prevents Replay Attacks

The signature binds the `IdentityCorrelation` to a specific `processInstanceId`. If someone copies the correlation to another process, the signature verification will fail because the `processInstanceId` won't match.

**Example Attack Scenario (Prevented):**
```
Process A (ID: 12345) - User: alice@example.com
Process B (ID: 67890) - Attacker copies alice's correlation

Verification in Process B:
- Correlation says: processInstanceId = "12345"
- Actual process: processInstanceId = "67890"
- Signature verification: FAILS ❌
```

### Prevents Tampering

Any modification to the correlation data invalidates the HMAC signature.

**Example Attack Scenario (Prevented):**
```
Original: username = "alice@example.com"
Modified: username = "admin@example.com"

Verification:
- Signature was computed with "alice@example.com"
- Current data contains "admin@example.com"
- Signature verification: FAILS ❌
```

### Works for Long-Running Processes

Unlike JWT tokens that expire, the signature remains valid for the entire process lifetime. No expiration or renewal needed.

**Timeline:**
```
Day 1:  Process starts → Correlation signed
Day 30: ServiceWorker executes → Signature verified ✓
Day 60: Another worker executes → Signature verified ✓
Day 90: Process completes → Signature still valid ✓
```

### Graceful Degradation

The default verification is "optional" - it logs warnings but doesn't fail the worker execution. This ensures:
- Existing processes without signatures continue to work
- Gradual migration path
- No breaking changes

**Verification Modes:**

1. **Optional Verification** (Default in ServiceHandler):
   ```scala
   IdentityVerification.verifySignatureOptional(correlation, processInstanceId, signingKey)
   // Logs warnings but doesn't fail
   ```

2. **Strict Verification** (Available for custom use):
   ```scala
   IdentityVerification.verifySignature(correlation, processInstanceId, signingKey)
   // Fails with WorkerError.BadSignatureError if invalid
   ```

## Usage Examples
This is handled by the gateway and general variable `_identityCorrelation`.

### Example 1: Starting a Process with Identity

```scala
// In your gateway or engine service
val identityCorrelation = IdentityCorrelation(
  username = "alice@example.com",
  email = Some("alice@example.com"),
  impersonateProcessValue = Some("department-123")
)

// Start process (two-step flow happens automatically)
val result = processInstanceService.start(
  processKey = "my-process",
  variables = Map("someData" -> "value"),
  identityCorrelation = Some(identityCorrelation)
)

// Result contains processInstanceId with signed correlation
```

### Example 2: Completing a User Task

```scala
// In your gateway or engine service
val identityCorrelation = IdentityCorrelation(
  username = "bob@example.com",
  email = Some("bob@example.com")
)

// Complete task (two-step flow happens automatically)
val result = userTaskService.complete(
  taskId = "task-123",
  variables = Map("approved" -> true),
  identityCorrelation = Some(identityCorrelation)
)

// Correlation is signed with processInstanceId and set as variable
```

### Example 3: ServiceWorker with Automatic Verification

```scala
// Your ServiceWorker implementation
class MyServiceWorker extends ServiceHandler[MyInput, MyOutput]:

  override def createRequest(input: MyInput)(using context: EngineRunContext): IO[WorkerError, RunnableRequest[MyServiceInput]] =
    // Identity verification happens automatically before this
    // Access the verified identity if needed
    val identity = context.generalVariables._identityCorrelation

    // Create your service request
    ZIO.succeed(RunnableRequest(...))

  // ... rest of implementation
```

### Example 4: Custom EngineConfig with Signing Key

```scala
// Your custom context implementation
class ProductionC7Context extends C7Context:

  override def engineConfig: EngineConfig =
    EngineConfig(
      tenantId = Some("production"),
      identitySigningKey = Some(loadSigningKeyFromVault())
    )

  private def loadSigningKeyFromVault(): String =
    // Load from your secret management system
    SecretVault.get("camunda-identity-signing-key")

  // ... other methods
```

### Example 5: Manual Verification in CustomWorker

```scala
// If you need strict verification in a CustomWorker
class MyCustomWorker extends CustomHandler[MyInput, MyOutput]:

  override def runWorkZIO(input: MyInput)(using context: EngineRunContext): RunnerOutputZIO =
    for
      // Get correlation from context
      correlation <- ZIO.fromOption(context.generalVariables.identityCorrelation)
                        .orElseFail(WorkerError.UnexpectedError("No identity correlation"))

      // Get processInstanceId
      processInstanceId <- ZIO.fromOption(correlation.processInstanceId)
                              .orElseFail(WorkerError.UnexpectedError("No process instance ID"))

      // Strict verification
      _ <- IdentityVerification.verifySignature(
             correlation,
             processInstanceId,
             context.engineContext.engineConfig.identitySigningKey
           )

      // Continue with your custom logic
      result <- doCustomWork(input, correlation)
    yield result
```

## Troubleshooting

### Signature Verification Fails

**Symptom:** Logs show "Signature verification failed"

**Possible Causes:**
1. **Different signing keys** - Gateway and workers using different keys
2. **Correlation modified** - Someone manually edited the process variables
3. **Wrong processInstanceId** - Correlation copied from another process

**Solution:**
```bash
# Verify all services use the same key
echo $ORCHESCALA_IDENTITY_SIGNING_KEY

# Check process variables in Camunda
# Ensure identityCorrelation.processInstanceId matches actual process ID
```

### No Signing Key Configured

**Symptom:** Logs show "No signing key configured"

**Possible Causes:**
1. Environment variable not set
2. EngineContext not overriding `engineConfig`

**Solution:**
```bash
# Set environment variable
export ORCHESCALA_IDENTITY_SIGNING_KEY="your-key"

# Or override in EngineContext
class MyContext extends C7Context:
  override def engineConfig: EngineConfig =
    EngineConfig(identitySigningKey = Some("your-key"))
```

### Correlation Not Bound to Process

**Symptom:** Logs show "IdentityCorrelation present but not bound to a process instance"

**Possible Causes:**
1. Old process started before signature implementation
2. Correlation created manually without signature

**Solution:**
- This is expected for existing processes
- New processes will automatically have signatures
- Consider migrating old processes if needed

### Key Rotation Issues

**Symptom:** Verification fails after key rotation

**Possible Causes:**
1. Running processes have signatures with old key
2. Workers updated with new key before gateway

**Solution:**
- Support dual-key verification during rotation period
- Update all services simultaneously
- Or wait for old processes to complete before rotating

## Migration Guide
As soon you have the gateway running, you have the `_identityCorrelation` on your process.

Migrating the existing processes means:
 - Add the Input mapping: `_identityCorrelation` to the subprocesses that need it.
 

## Technical Details

### HMAC-SHA256 Algorithm

The signature is computed as follows:

```
message = username + email + impersonateProcessValue + issuedAt + processInstanceId
signature = HMAC-SHA256(message, signingKey)
encoded = Base64.encode(signature)
```

**Properties:**
- **Deterministic**: Same input always produces same signature
- **One-way**: Cannot derive key from signature
- **Tamper-proof**: Any change to input changes signature
- **Fast**: Efficient computation and verification

### Storage Format

The `IdentityCorrelation` is stored as a JSON object in Camunda process variables:

```json
{
  "username": "alice@example.com",
  "email": "alice@example.com",
  "impersonateProcessValue": "department-123",
  "issuedAt": 1701234567890,
  "processInstanceId": "12345",
  "signature": "dGVzdC1zaWduYXR1cmUtaGVyZQ=="
}
```

### Performance Considerations

**Signing:**
- Happens once per process start
- Happens once per task completion
- Minimal overhead (~1ms)

**Verification:**
- Happens once per ServiceWorker execution
- Minimal overhead (~1ms)
- No database queries needed

**Scalability:**
- No additional database tables
- No external service calls
- Stateless verification

## Summary

The Impersonation Solution provides:

✅ **Security** - Cryptographic binding prevents replay attacks and tampering

✅ **Simplicity** - Automatic signing and verification, zero-touch for most use cases

✅ **Flexibility** - Optional vs strict verification, environment variable vs code configuration

✅ **Compatibility** - Works with both Camunda 7 and Camunda 8

✅ **Performance** - Minimal overhead, no external dependencies

✅ **Maintainability** - Clear separation of concerns, well-documented API

**Status:** ✅ Production Ready

**Version:** 1.0.0

**Last Updated:** December 2025

