package mycompany.orchescala.worker

import orchescala.worker.{WorkerApp, WorkerRegistry}
import orchescala.worker.c7.C7WorkerRegistry
import orchescala.worker.c8.C8WorkerRegistry

/**
 * Example of a WorkerApp that composes both C7 and C8 workers in one application.
 * The WorkerApp automatically detects which engine layers are needed and provides them.
 */
class MixedEngineWorkerApp extends WorkerApp:

  // Define workers for both C7 and C8 engines
  override def workerRegistries: Seq[WorkerRegistry] = Seq(
    // C7 workers
    C7WorkerRegistry(myC7Client),
    
    // C8 workers  
    C8WorkerRegistry(myC8Client)
  )

  // The WorkerApp will automatically:
  // 1. Detect that we have C8WorkerRegistry instances
  // 2. Provide the SharedC8ClientManager.layer automatically
  // 3. No need to extend C8WorkerApp or manually provide layers!

  // Define your workers
  workers(
    // C7 workers
    MyC7InvoiceWorker,
    MyC7PaymentWorker,
    
    // C8 workers
    MyC8OrderWorker,
    MyC8ShippingWorker
  )

  // Optional: provide additional custom layers if needed
  // override def additionalLayers = MyCustomLayer.live

end MixedEngineWorkerApp

/**
 * Pure C8 WorkerApp example - also works without extending C8WorkerApp
 */
class PureC8WorkerApp extends WorkerApp:

  override def workerRegistries: Seq[WorkerRegistry] = Seq(
    C8WorkerRegistry(myC8Client)
  )

  workers(
    MyC8OrderWorker,
    MyC8ShippingWorker,
    MyC8PaymentWorker
  )

  // SharedC8ClientManager.layer is automatically provided!

end PureC8WorkerApp

/**
 * Pure C7 WorkerApp example - no additional layers needed
 */
class PureC7WorkerApp extends WorkerApp:

  override def workerRegistries: Seq[WorkerRegistry] = Seq(
    C7WorkerRegistry(myC7Client)
  )

  workers(
    MyC7InvoiceWorker,
    MyC7PaymentWorker
  )

  // No additional layers needed for C7

end PureC7WorkerApp
