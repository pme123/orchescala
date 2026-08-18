package test.services.worker
package camunda.v7

import test.services.domain.camunda.v7.GetProcessInstance.*

class GetProcessInstanceWorker
    extends CompanyServiceWorkerDsl[In, Out, ServiceIn, ServiceOut]:

  lazy val serviceTask = example

end GetProcessInstanceWorker
