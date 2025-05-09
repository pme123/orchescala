package orchescala.worker.c7

import org.camunda.bpm.client.task.ExternalTask
import sttp.client3.{HttpClientSyncBackend, Identity, SttpBackend}

type HelperContext[T] = ExternalTask ?=> T
