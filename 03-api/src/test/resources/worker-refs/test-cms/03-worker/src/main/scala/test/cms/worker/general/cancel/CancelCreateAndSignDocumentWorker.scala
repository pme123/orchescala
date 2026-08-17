package test.cms.worker.general.cancel

import test.cms.domain.general.cancel.CancelCreateAndSignDocument.*
import test.services.worker.camunda.v7.{GetProcessInstanceWorker, PostSignalWorker}
import other.company.worker.client.v1.GetClientWorker

class CancelCreateAndSignDocumentWorker(
    getProcessInstanceWorker: GetProcessInstanceWorker,
    postSignalWorker: PostSignalWorker,
    getClientWorker: GetClientWorker,
    notAWorker: SomeOtherService
) extends CompanyCustomWorkerDsl[In, Out]:

  lazy val customTask = example

end CancelCreateAndSignDocumentWorker
