package orchescala.worker.operaton

import org.operaton.bpm.client.task.ExternalTask
import sttp.client3.{HttpClientSyncBackend, Identity, SttpBackend}

type HelperContext[T] = ExternalTask ?=> T

