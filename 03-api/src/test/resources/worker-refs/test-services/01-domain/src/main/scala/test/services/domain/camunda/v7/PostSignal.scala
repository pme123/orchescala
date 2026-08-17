package test.services.domain.camunda.v7

object CamundaV7:
  final val serviceLabel = "Camunda V7"

object PostSignal extends CamundaV7:
  final val topicName = "test-services-camundaV7.PostSignal"
  val descr           = "Delivers a signal to the process engine."
end PostSignal

object GetProcessInstance extends CamundaV7:
  final val topicName = "test-services-camundaV7.GetProcessInstance"
  val descr           = "Reads a process instance."
end GetProcessInstance
