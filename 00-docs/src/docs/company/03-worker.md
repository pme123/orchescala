# 03-worker
Use this to add Company specific Worker stuff like the configuration of the auth method.

@:callout(info)
Workers are a bit more complex as there is a specific implementation you have to provide.

This will hopefully be simplified in the future.

For now, you have to provide a couple of files, as explained below.
@:@

The following structure is generated by `./helperCompany.scala init`:

```bash
03-worker/src
          | main/resources
          | main/scala/orchescala/worker
          |                        | CompanyWorker.scala         
          | main/scala/mycompany/orchescala/worker
          |                                | CompanyEngineContext.scala 
          |                                | CompanyPasswordFlow.scala         
          |                                | CompanyRestApiClient.scala    
          |                                | CompanyWorkerApp.scala     
          | test/scala/mycompany/worker       
```

## CompanyEngineContext
Depending on the Camunda Engine and Authentication you use, you have to provide the EngineContext.

```scala
package mycompany.orchescala.worker

import orchescala.worker.c7.C7Context
import scala.compiletime.uninitialized
import scala.reflect.ClassTag

class CompanyEngineContext(restApiClient: CompanyRestApiClient) extends C7Context:


  override def sendRequest[ServiceIn: Encoder, ServiceOut: {Decoder, ClassTag}](
                                                                                 request: RunnableRequest[ServiceIn]
                                                                               ): SendRequestType[ServiceOut] =
    restApiClient.sendRequest(request)

end CompanyEngineContext
```
Basically you override the sendRequest to use your RestApiClient with the specific auth-method.

## CompanyPasswordFlow
Configure the Token Service - this is tested only with Keycloak.

```scala
import orchescala.worker.c7.OAuth2WorkerClient

trait CompanyPasswordFlow extends OAuth2WorkerClient:

  def fssoRealm: String = ???
  def fssoBaseUrl: String = ???

  // override the config if needed or change the WorkerClient

end CompanyPasswordFlow
```
## CompanyRestApiClient
Some specific configuration or authentication for the RestApiClient.

```scala
package mycompany.orchescala.worker

import orchescala.worker.WorkerError.ServiceAuthError
import sttp.client3.*

class CompanyRestApiClient extends RestApiClient, CompanyPasswordFlow:

  override protected def auth(
                               request: Request[Either[String, String], Any]
                             )(using
                               context: EngineRunContext
                             ): IO[ServiceAuthError, Request[Either[String, String], Any]] = ???

  end auth

end CompanyRestApiClient
```
## CompanyWorker

The Company's base class, you can provide super classes for each Worker type.
See [Workers] for more information on these types.

Example (generated by `./helperCompany.scala init`):

```scala
package mycompany.orchescala.worker

import orchescala.camunda7.worker.C7WorkerHandler
import scala.reflect.ClassTag

/**
 * Add here company specific stuff, to run the Workers.
 * You also define the implementation of the WorkerHandler here.
 */
trait CompanyWorker extends C7WorkerHandler

trait CompanyValidationWorkerDsl[
  In <: Product: InOutCodec
] extends CompanyWorker, ValidationWorkerDsl[In]

trait CompanyInitWorkerDsl[
    In <: Product: InOutCodec,
    Out <: Product: InOutCodec,
    InitIn <: Product: InOutCodec,
    InConfig <: Product: InOutCodec
] extends CompanyWorker, InitWorkerDsl[In, Out, InitIn, InConfig]

trait CompanyCustomWorkerDsl[
    In <: Product: InOutCodec,
    Out <: Product: InOutCodec
] extends CompanyWorker, CustomWorkerDsl[In, Out]

trait CompanyServiceWorkerDsl[
    In <: Product: InOutCodec,
    Out <: Product: InOutCodec,
    ServiceIn: InOutEncoder,
    ServiceOut: InOutDecoder: ClassTag
] extends CompanyWorker, ServiceWorkerDsl[In, Out, ServiceIn, ServiceOut]
```

## CompanyWorkerApp
The Company's base class to run the Workers.

Example (generated by `./helperCompany.scala init`):

```scala
package mycompany.orchescala.worker

import orchescala.worker.c7.C7WorkerRegistry // Camunda 7 support
import orchescala.worker.c8.C8WorkerRegistry // Camunda 8 support

trait CompanyWorkerApp extends WorkerApp:

  lazy val workerRegistries: Seq[WorkerRegistry] =
    Seq(C7WorkerRegistry(CompanyOAuth2Client), C7WorkerRegistry(CompanyOAuth2Client))

```