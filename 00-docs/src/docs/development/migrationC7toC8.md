# Migration C7 > C8

This guide provides step-by-step instructions for migrating your Orchescala application from Camunda 7 to Camunda 8.
The migration involves changes to BPMNs/ DMNs, Engine-, Worker- and Simulation configuration.

@:callout(info)
This is a work in progress. I will add more details as I go along.

For now, it describes running C7 and C8 next to each other.

The documentation is based on the [Demo Company](https://github.com/pme123/orchescala-democompany). 
Check it out for the whole context.
@:@

## Overview

Camunda 8 introduces significant architectural changes compared to Camunda 7:

- **Architecture**: Camunda 8 uses Zeebe as the process engine (cloud-native, distributed)
- **Variables**: JSON-only variable handling (no Java objects)
- **Deployment**: Different deployment mechanisms and APIs

## Migration Checklist

### Each Project

- Update BPMNs/ DMNs for Camunda 8 compatibility
    - Replace Scripts with FEEL or Workers
    - Convert JUEL expressions to FEEL

### Company Project

- Configure for Camunda 8:
    - Engine settings
    - Worker settings
    - Simulation settings

### What works out of the box

In your projects you don't need to change anything in:

- Domain Models
- API Documentation
- Workers
- Simulations
- Helper

### Preparation

Before you migrate a process, make sure you have:
- migrated every logic to workers.
- that all your subprocesses are migrated.

### Future Work

- Postman Open API
- DMN Tester
- Deploy to C8 by Simulation

---

## 1. BPMNs

### Key Differences

**Camunda 7 vs Camunda 8 BPMN Changes:**

| Aspect          | Camunda 7                  | Camunda 8                   |
|-----------------|----------------------------|-----------------------------|
| **Task Types**  | External Tasks with topics | Job Types                   |
| **Variables**   | Java objects + JSON        | JSON only                   |
| **Forms**       | Embedded/Generated Forms   | Tasklist Forms              |
| **Expressions** | JUEL expressions           | FEEL expressions            |
| **Scripts**     | Inline/External Scripts    | FEEL expressions or Workers |
| **Listeners**   | Execution/Task Listeners   | Workers                     |

### Migration Steps
Use the [Migration Guide](https://docs.camunda.io/docs/next/guides/migrating-from-camunda-7) to update your BPMNs

1. Create a Camunda 8 directory in your project:

     ```bash
     mkdir src/main/resources/camunda8
     ```
   
1. Use the [Migration Analyzer](https://migration-analyzer.consulting-sandbox.camunda.cloud)
    - This creates a Camunda 8 compatible BPMN.
    - And a report with stuff you need to adjust manually.

1. Adjust the BPMN manually.
    - Use the report from the Migration Analyzer.
    - Or just go through the BPMN.
    - Replace Scripts with FEEL or Workers.
    - Convert JUEL expressions to FEEL.

1. Deploy the BPMN to Camunda 8. (manually for now)

1. Run the Simulation.

---

## 2. Engine Configuration
This depends on your Camunda 8 setup.

### Migration Steps

1. **Create C8 Engine Configuration**

   Create a new engine configuration class for Camunda 8:

   ```scala
   package mycompany.orchescala.engine

   import orchescala.engine.EngineConfig
   import orchescala.engine.c8.C8SaasClient

   trait CompanyEngineC8Config extends C8SaasClient:

     // Provide EngineConfig as a given instance
     given EngineConfig = EngineConfig(
       tenantId = None // Set your tenant ID if needed
     )

     // C8 SaaS Configuration
     protected def zeebeGrpc: String = sys.env.getOrElse("ZEEBE_GRPC_ADDRESS", "https://bru-2.zeebe.camunda.io:443")
     protected def zeebeRest: String = sys.env.getOrElse("ZEEBE_REST_ADDRESS", "https://bru-2.zeebe.camunda.io/v1")
     protected def audience: String = sys.env.getOrElse("ZEEBE_AUDIENCE", "zeebe.camunda.io")
     protected def clientId: String = sys.env.getOrElse("ZEEBE_CLIENT_ID", "your-client-id")
     protected def clientSecret: String = sys.env.getOrElse("ZEEBE_CLIENT_SECRET", "your-client-secret")
     protected def oAuthAPI: String = sys.env.getOrElse("ZEEBE_OAUTH_URL", "https://login.cloud.camunda.io/oauth/token")
   ```

2. **Environment Variables**

   Set up the following environment variables for Camunda 8:

   ```bash
   # Camunda 8 SaaS Configuration
   export ZEEBE_GRPC_ADDRESS="https://your-cluster.zeebe.camunda.io:443"
   export ZEEBE_REST_ADDRESS="https://your-cluster.zeebe.camunda.io/v1"
   export ZEEBE_AUDIENCE="zeebe.camunda.io"
   export ZEEBE_CLIENT_ID="your-client-id"
   export ZEEBE_CLIENT_SECRET="your-client-secret"
   export ZEEBE_OAUTH_URL="https://login.cloud.camunda.io/oauth/token"
   ```

3. **Update Dependencies**

   Add Camunda 8 dependencies to your `project/Settings.scala`:

   ```scala
    lazy val engineDeps = Seq(
      "io.github.pme123" %% "orchescala-engine-gateway" % orchescalaV
    )
   ```
   With the `engine-gateway` we can abstract our engines, and we can use both engines at the same time.

---

## 3. Worker Configuration
Workers are independent of the engine. So you can use the same workers for both engines.

### Migration Steps

1. **Update Worker Base Class**

   ```scala
    trait CompanyWorker[In <: Product : InOutCodec, Out <: Product : InOutCodec]
      extends C7Worker[In, Out], C8Worker[In, Out]:
        protected def c7Context: C7Context = CompanyEngineC7Context(CompanyRestApiC7Client())
        protected def c8Context: C8Context = CompanyEngineC8Context(CompanyRestApiC7Client())
   ```
   
2. **Update Worker Registry**

   ```scala
   trait CompanyWorkerApp extends WorkerApp:
     lazy val workerRegistries: Seq[WorkerRegistry] =
       Seq(
         C7WorkerRegistry(CompanyC7Client),
         C8WorkerRegistry(CompanyC8Client)
       )
   ```

3. **Update Context Implementation**

   Create a C8-compatible context (just extend the `C8Context`):

   ```scala
   package mycompany.orchescala.worker

   import orchescala.worker.c8.C8Context
   import scala.reflect.ClassTag

   class CompanyEngineContext(restApiClient: CompanyRestApiClient) extends C8Context:

     override def sendRequest[ServiceIn: InOutEncoder, ServiceOut: {InOutDecoder, ClassTag}](
       request: RunnableRequest[ServiceIn]
     ): SendRequestType[ServiceOut] =
       restApiClient.sendRequest(request)
   ```


---

## 4. Simulation Configuration
This is a bit more involved;).

### Migration Steps

1. **Update Simulation Configuration**
```scala
case class SimulationConfig(
    @description("define tenant if you have one")
    tenantId: Option[String] = None,
    @description(
      """there are Requests that wait until the process is ready - like getTask.
        |the Simulation waits 1 second between the Requests.
        |so with a timeout of 10 sec it will try 10 times (retryDuration = 1.second)""".stripMargin)
    maxCount: Int = 10,
    @description("Cockpit URL - to provide a link to the process instance. you can provide a different URL for each engine type with a Map")
    cockpitUrl: String | Map[EngineType, String] = ProcessEngine.c7CockpitUrl,
    @description("the maximum LogLevel you want to print the LogEntries")
    logLevel: LogLevel = LogLevel.INFO
)
```
Example for the `CompanySimulation`:
```scala
trait CompanySimulation extends SimulationRunner, C8SaasClient, CompanyEngineC7Config,
      CompanyEngineC8Config:
      
    given EngineConfig = EngineConfig(tenantId = config.tenantId)

  // Override this to provide the ZIO layers required by this simulation
  lazy val requiredLayers: Seq[ZLayer[Any, Nothing, Any]]  = Seq(
    SharedC8ClientManager.layer,
    SharedC7ClientManager.layer
  )
  // Override engineZIO to create the engine within the SharedC8ClientManager environment
  override def engineZIO: ZIO[Any, Nothing, ProcessEngine] =
    (for
      c8Engine: ProcessEngine <- C8ProcessEngine.withClient(this)
      c7Engine: ProcessEngine <- CompanyC7Simulation.engineZIO
      given Seq[ProcessEngine] = Seq(c8Engine,c7Engine)
    yield GProcessEngine())
      .provideLayer(SharedC8ClientManager.layer)
      .provideLayer(SharedC7ClientManager.layer)

  override lazy val config: SimulationConfig =
    SimulationConfig(
      cockpitUrl = Map(
        EngineType.C7 -> camundaCockpitUrl,
        EngineType.C8 -> zeebeOperateUrl
      )
    )
end CompanySimulation
```
What you need to do is:
- add the ZIO layers for both engines.
- create the engines.
- provide the `cockpitUrl` in the `SimulationConfig` for both engines.

## 5. Testing and Validation

### Testing Strategy

Just run both C7 and C8 **Simulations** side by side.

```scala
  override def engineZIO: ZIO[Any, Nothing, ProcessEngine] =
  (for
    c8Engine: ProcessEngine <- C8ProcessEngine.withClient(this)
    c7Engine: ProcessEngine <- CompanyC7Simulation.engineZIO
    given Seq[ProcessEngine] = Seq(c8Engine,c7Engine) // -> change order to change default engine
  yield GProcessEngine())
    ...
```
You can just change the order in your `CompanySimulation` to change the default engine.
Or you provide separate _Simulations_ for both engines (examples from `democompany-cards`).

C7:
```scala
class OrderCreditcardC7Simulation extends OrderCreditcardSimulation, CompanyC7Simulation
```
C8:
```scala
class OrderCreditcardC8Simulation extends OrderCreditcardSimulation, CompanyC8Simulation
```
Both (gateway):
```scala
class OrderCreditcardGSimulation extends OrderCreditcardSimulation, CompanyGSimulation
```
Using the same _Simulation_:
```scala
abstract class OrderCreditcardSimulation extends CompanySimulation:

simulate(
  scenario(`OrderCreditcard`)(
    `Check Order approved UT`
  ),
  ...
```

---

## 6. Resources

- [Camunda 8 Migration Guide](https://docs.camunda.io/docs/next/guides/migrating-from-camunda-7)
- [Demo Company Repository](https://github.com/pme123/orchescala-democompany)
- Create issues in the [Orchescala GitHub repository](https://github.com/pme123/orchescala/issues)
