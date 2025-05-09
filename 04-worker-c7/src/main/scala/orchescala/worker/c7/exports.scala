package orchescala.worker.c8

import org.camunda.bpm.client.task.ExternalTask
import sttp.client3.{HttpClientSyncBackend, Identity, SttpBackend}

type HelperContext[T] = ExternalTask ?=> T
