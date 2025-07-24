package orchescala.helper.dev.update

import orchescala.domain.BpmnProcessType

case class BpmnProcessGenerator(processType: BpmnProcessType)(using config: DevConfig):

  def createBpmn(setupElement: SetupElement): Unit =
    val name = s"${setupElement.identifierShort}.bpmn"
    if !os.exists(os.pwd / processType.diagramPath) then
       os.makeDir.all(os.pwd / processType.diagramPath)
    os.write.over(
      os.pwd / processType.diagramPath / name,
      processType match
        case _ : BpmnProcessType.C7 => bpmnC7(setupElement)
        case _ : BpmnProcessType.C8 => bpmnC8(setupElement)
    )
  end createBpmn

  private def bpmnC7(setupElement: SetupElement) =
    val processId = setupElement.identifier
    s"""<?xml version="1.0" encoding="UTF-8"?>
       |<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0"  xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="Definitions_0phxlok" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="5.23.0" modeler:executionPlatform="Camunda Platform" modeler:executionPlatformVersion="7.23.0">
       |  <bpmn:collaboration id="Collaboration_1nchi5w">
       |    <bpmn:participant id="democompany-cards-orderCreditcardV1-Participant" name="democompany-cards-orderCreditcardV1" processRef="democompany-cards-orderCreditcardV1" />
       |  </bpmn:collaboration>
       |  <bpmn:process id="democompany-cards-orderCreditcardV1" name="democompany-cards-orderCreditcardV1" isExecutable="true">
       |    <bpmn:serviceTask id="InitProcessTask" name="Init Process" camunda:type="external" camunda:topic="democompany-cards-orderCreditcardV1">
       |      <bpmn:extensionElements>
       |        <camunda:inputOutput>
       |          <camunda:inputParameter name="handledErrors">output-mocked</camunda:inputParameter>
       |        </camunda:inputOutput>
       |      </bpmn:extensionElements>
       |      <bpmn:incoming>Flow_1jqb7g9</bpmn:incoming>
       |      <bpmn:outgoing>Flow_151h2k5</bpmn:outgoing>
       |    </bpmn:serviceTask>
       |    <bpmn:intermediateThrowEvent id="OutputmockedEvent1" name="output-mocked">
       |      <bpmn:incoming>Flow_1tnbvod</bpmn:incoming>
       |      <bpmn:linkEventDefinition id="LinkEventDefinition_147ix62" name="output-mocked" />
       |    </bpmn:intermediateThrowEvent>
       |    <bpmn:endEvent id="SucceededEndEvent" name="succeeded">
       |      <bpmn:extensionElements>
       |        <camunda:executionListener expression="#{execution.setVariable(&#34;processStatus&#34;, &#34;succeeded&#34;)}" event="start" />
       |      </bpmn:extensionElements>
       |      <bpmn:incoming>Flow_151h2k5</bpmn:incoming>
       |    </bpmn:endEvent>
       |    <bpmn:boundaryEvent id="MockedBoundaryEvent" name="output-mocked" attachedToRef="InitProcessTask">
       |      <bpmn:outgoing>Flow_1tnbvod</bpmn:outgoing>
       |      <bpmn:errorEventDefinition id="ErrorEventDefinition_11vypoq" errorRef="Error_1rvzdyr" />
       |    </bpmn:boundaryEvent>
       |    <bpmn:sequenceFlow id="Flow_1jqb7g9" sourceRef="StartProcessStartEvent" targetRef="InitProcessTask" />
       |    <bpmn:sequenceFlow id="Flow_151h2k5" sourceRef="InitProcessTask" targetRef="SucceededEndEvent" />
       |    <bpmn:sequenceFlow id="Flow_1tnbvod" sourceRef="MockedBoundaryEvent" targetRef="OutputmockedEvent1" />
       |    <bpmn:startEvent id="StartProcessStartEvent" name="Start Process" camunda:asyncAfter="true">
       |      <bpmn:outgoing>Flow_1jqb7g9</bpmn:outgoing>
       |    </bpmn:startEvent>
       |    <bpmn:sequenceFlow id="Flow_0vdwlr8" sourceRef="OutputmockedEvent" targetRef="OutputmockedEndEvent" />
       |    <bpmn:endEvent id="OutputmockedEndEvent" name="output-mocked">
       |      <bpmn:extensionElements>
       |        <camunda:executionListener expression="#{execution.setVariable(&#34;processStatus&#34;, &#34;output-mocked&#34;)}" event="start" />
       |      </bpmn:extensionElements>
       |      <bpmn:incoming>Flow_0vdwlr8</bpmn:incoming>
       |    </bpmn:endEvent>
       |    <bpmn:intermediateCatchEvent id="OutputmockedEvent" name="output-mocked">
       |      <bpmn:outgoing>Flow_0vdwlr8</bpmn:outgoing>
       |      <bpmn:linkEventDefinition id="LinkEventDefinition_17cwbts" name="output-mocked" />
       |    </bpmn:intermediateCatchEvent>
       |  </bpmn:process>
       |  <bpmn:error id="Error_1rvzdyr" name="output-mocked" errorCode="output-mocked" />
       |  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
       |    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collaboration_1nchi5w">
       |      <bpmndi:BPMNShape id="Participant_1wuaud6_di" bpmnElement="$processId-Participant" isHorizontal="true">
       |        <dc:Bounds x="160" y="80" width="1450" height="630" />
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape id="Activity_1luk2dc_di" bpmnElement="InitProcessTask" color:background-color="#D5D5D5">
       |        <dc:Bounds x="310" y="257" width="100" height="80" />
       |        <bpmndi:BPMNLabel />
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape id="Event_084c0k8_di" bpmnElement="OutputmockedEvent1" color:background-color="#D5D5D5">
       |        <dc:Bounds x="392" y="399" width="36" height="36" />
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds x="374" y="442" width="73" height="14" />
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape id="Event_1vr44rw_di" bpmnElement="SucceededEndEvent">
       |        <dc:Bounds x="1502" y="279" width="36" height="36" />
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds x="1494" y="322" width="54" height="14" />
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape id="Event_0pv6a42_di" bpmnElement="StartProcessStartEvent">
       |        <dc:Bounds x="222" y="279" width="36" height="36" />
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds x="207" y="322" width="67" height="14" />
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape id="BPMNShape_0leg8xy" bpmnElement="OutputmockedEndEvent" color:background-color="#D5D5D5">
       |        <dc:Bounds x="1502" y="622" width="36" height="36" />
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds x="1483" y="668" width="73" height="14" />
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape id="BPMNShape_1km6s3c" bpmnElement="OutputmockedEvent" color:background-color="#D5D5D5">
       |        <dc:Bounds x="1392" y="622" width="36" height="36" />
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds x="1376" y="665" width="73" height="14" />
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape id="Event_047id8n_di" bpmnElement="MockedBoundaryEvent" color:background-color="#D5D5D5">
       |        <dc:Bounds x="392" y="319" width="36" height="36" />
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds x="453" y="193" width="73" height="14" />
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNEdge id="Flow_1jqb7g9_di" bpmnElement="Flow_1jqb7g9">
       |        <di:waypoint x="258" y="297" />
       |        <di:waypoint x="310" y="297" />
       |      </bpmndi:BPMNEdge>
       |      <bpmndi:BPMNEdge id="Flow_151h2k5_di" bpmnElement="Flow_151h2k5">
       |        <di:waypoint x="410" y="297" />
       |        <di:waypoint x="1502" y="297" />
       |      </bpmndi:BPMNEdge>
       |      <bpmndi:BPMNEdge id="Flow_1tnbvod_di" bpmnElement="Flow_1tnbvod">
       |        <di:waypoint x="410" y="355" />
       |        <di:waypoint x="410" y="399" />
       |      </bpmndi:BPMNEdge>
       |      <bpmndi:BPMNEdge id="BPMNEdge_0a6fs7m" bpmnElement="Flow_0vdwlr8">
       |        <di:waypoint x="1428" y="640" />
       |        <di:waypoint x="1502" y="640" />
       |      </bpmndi:BPMNEdge>
       |    </bpmndi:BPMNPlane>
       |  </bpmndi:BPMNDiagram>
       |</bpmn:definitions>
       |""".stripMargin
  end bpmnC7
  private def bpmnC8(setupElement: SetupElement) =
    val processId = setupElement.identifier
    s"""<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:conversion="http://camunda.org/schema/conversion/1.0" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:modeler="http://camunda.org/schema/modeler/1.0" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" conversion:converterVersion="0.13.1" exporter="Camunda Modeler" exporterVersion="5.23.0" expressionLanguage="http://www.w3.org/1999/XPath" id="Definitions_0phxlok" modeler:executionPlatform="Camunda Cloud" modeler:executionPlatformVersion="8.7.0" targetNamespace="http://bpmn.io/schema/bpmn" typeLanguage="http://www.w3.org/2001/XMLSchema">
       |  <bpmn:collaboration id="Collaboration_1nchi5w" isClosed="false">
       |    <bpmn:participant id="$processId-Participant" name="$processId" processRef="$processId"/>
       |  </bpmn:collaboration>
       |  <bpmn:process id="$processId" isClosed="false" isExecutable="true" name="$processId" processType="None">
       |    <bpmn:serviceTask completionQuantity="1" id="InitProcessTask" implementation="##WebService" isForCompensation="false" name="Init Process" startQuantity="1">
       |      <bpmn:extensionElements>
       |        <conversion:message severity="REVIEW">Attribute 'topic' on 'serviceTask' was mapped. Is set as job type.</conversion:message>
       |        <conversion:message severity="INFO">Unused attribute 'type' on 'serviceTask' is removed.</conversion:message>
       |        <zeebe:ioMapping>
       |          <zeebe:input source="output-mocked" target="handledErrors"/>
       |        </zeebe:ioMapping>
       |        <zeebe:taskDefinition type="$processId"/>
       |      </bpmn:extensionElements>
       |      <bpmn:incoming>Flow_1jqb7g9</bpmn:incoming>
       |      <bpmn:outgoing>Flow_151h2k5</bpmn:outgoing>
       |    </bpmn:serviceTask>
       |    <bpmn:intermediateThrowEvent id="OutputmockedEvent1" name="output-mocked">
       |      <bpmn:incoming>Flow_1tnbvod</bpmn:incoming>
       |      <bpmn:linkEventDefinition id="LinkEventDefinition_147ix62" name="output-mocked"/>
       |    </bpmn:intermediateThrowEvent>
       |    <bpmn:endEvent id="SucceededEndEvent" name="succeeded">
       |      <bpmn:extensionElements>
       |        <conversion:message severity="TASK">Listener at 'start' with implementation '#{execution.setVariable("processStatus", "succeeded")}' can be transformed to a job worker. Please adjust the job type.</conversion:message>
       |        <zeebe:executionListeners>
       |          <zeebe:executionListener eventType="start" type="#{execution.setVariable(&quot;processStatus&quot;, &quot;succeeded&quot;)}"/>
       |        </zeebe:executionListeners>
       |      </bpmn:extensionElements>
       |      <bpmn:incoming>Flow_151h2k5</bpmn:incoming>
       |    </bpmn:endEvent>
       |    <bpmn:boundaryEvent attachedToRef="InitProcessTask" cancelActivity="true" id="MockedBoundaryEvent" name="output-mocked" parallelMultiple="false">
       |      <bpmn:extensionElements>
       |        <conversion:reference>Error_1rvzdyr</conversion:reference>
       |      </bpmn:extensionElements>
       |      <bpmn:outgoing>Flow_1tnbvod</bpmn:outgoing>
       |      <bpmn:errorEventDefinition errorRef="Error_1rvzdyr" id="ErrorEventDefinition_11vypoq"/>
       |    </bpmn:boundaryEvent>
       |    <bpmn:sequenceFlow id="Flow_1jqb7g9" sourceRef="StartProcessStartEvent" targetRef="InitProcessTask"/>
       |    <bpmn:sequenceFlow id="Flow_151h2k5" sourceRef="InitProcessTask" targetRef="SucceededEndEvent"/>
       |    <bpmn:sequenceFlow id="Flow_1tnbvod" sourceRef="MockedBoundaryEvent" targetRef="OutputmockedEvent1"/>
       |    <bpmn:startEvent id="StartProcessStartEvent" isInterrupting="true" name="Start Process" parallelMultiple="false">
       |      <bpmn:extensionElements>
       |        <conversion:message severity="INFO">Unused attribute 'asyncAfter' on 'startEvent' is removed.</conversion:message>
       |      </bpmn:extensionElements>
       |      <bpmn:outgoing>Flow_1jqb7g9</bpmn:outgoing>
       |    </bpmn:startEvent>
       |    <bpmn:sequenceFlow id="Flow_0vdwlr8" sourceRef="OutputmockedEvent" targetRef="OutputmockedEndEvent"/>
       |    <bpmn:endEvent id="OutputmockedEndEvent" name="output-mocked">
       |      <bpmn:extensionElements>
       |        <conversion:message severity="TASK">Listener at 'start' with implementation '#{execution.setVariable("processStatus", "output-mocked")}' can be transformed to a job worker. Please adjust the job type.</conversion:message>
       |        <zeebe:executionListeners>
       |          <zeebe:executionListener eventType="start" type="#{execution.setVariable(&quot;processStatus&quot;, &quot;output-mocked&quot;)}"/>
       |        </zeebe:executionListeners>
       |      </bpmn:extensionElements>
       |      <bpmn:incoming>Flow_0vdwlr8</bpmn:incoming>
       |    </bpmn:endEvent>
       |    <bpmn:intermediateCatchEvent id="OutputmockedEvent" name="output-mocked" parallelMultiple="false">
       |      <bpmn:outgoing>Flow_0vdwlr8</bpmn:outgoing>
       |      <bpmn:linkEventDefinition id="LinkEventDefinition_17cwbts" name="output-mocked"/>
       |    </bpmn:intermediateCatchEvent>
       |  </bpmn:process>
       |  <bpmn:error errorCode="output-mocked" id="Error_1rvzdyr" name="output-mocked">
       |    <bpmn:extensionElements>
       |      <conversion:referencedBy>MockedBoundaryEvent</conversion:referencedBy>
       |    </bpmn:extensionElements>
       |  </bpmn:error>
       |  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
       |    <bpmndi:BPMNPlane bpmnElement="Collaboration_1nchi5w" id="BPMNPlane_1">
       |      <bpmndi:BPMNShape bpmnElement="$processId-Participant" id="Participant_1wuaud6_di" isHorizontal="true">
       |        <dc:Bounds height="630" width="1450" x="160" y="80"/>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape color:background-color="#D5D5D5" bpmnElement="InitProcessTask" id="Activity_1luk2dc_di">
       |        <dc:Bounds height="80" width="100" x="310" y="257"/>
       |        <bpmndi:BPMNLabel/>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape color:background-color="#D5D5D5" bpmnElement="OutputmockedEvent1" id="Event_084c0k8_di">
       |        <dc:Bounds height="36" width="36" x="392" y="399"/>
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds height="14" width="73" x="374" y="442"/>
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape bpmnElement="SucceededEndEvent" id="Event_1vr44rw_di">
       |        <dc:Bounds height="36" width="36" x="1502" y="279"/>
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds height="14" width="54" x="1494" y="322"/>
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape bpmnElement="StartProcessStartEvent" id="Event_0pv6a42_di">
       |        <dc:Bounds height="36" width="36" x="222" y="279"/>
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds height="14" width="67" x="207" y="322"/>
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape color:background-color="#D5D5D5" bpmnElement="OutputmockedEndEvent" id="BPMNShape_0leg8xy">
       |        <dc:Bounds height="36" width="36" x="1502" y="622"/>
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds height="14" width="73" x="1483" y="668"/>
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape color:background-color="#D5D5D5" bpmnElement="OutputmockedEvent" id="BPMNShape_1km6s3c">
       |        <dc:Bounds height="36" width="36" x="1392" y="622"/>
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds height="14" width="73" x="1376" y="665"/>
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape color:background-color="#D5D5D5" bpmnElement="MockedBoundaryEvent" id="Event_047id8n_di">
       |        <dc:Bounds height="36" width="36" x="392" y="319"/>
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds height="14" width="73" x="453" y="193"/>
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNEdge bpmnElement="Flow_1jqb7g9" id="Flow_1jqb7g9_di">
       |        <di:waypoint x="258" y="297"/>
       |        <di:waypoint x="310" y="297"/>
       |      </bpmndi:BPMNEdge>
       |      <bpmndi:BPMNEdge bpmnElement="Flow_151h2k5" id="Flow_151h2k5_di">
       |        <di:waypoint x="410" y="297"/>
       |        <di:waypoint x="1502" y="297"/>
       |      </bpmndi:BPMNEdge>
       |      <bpmndi:BPMNEdge bpmnElement="Flow_1tnbvod" id="Flow_1tnbvod_di">
       |        <di:waypoint x="410" y="355"/>
       |        <di:waypoint x="410" y="399"/>
       |      </bpmndi:BPMNEdge>
       |      <bpmndi:BPMNEdge bpmnElement="Flow_0vdwlr8" id="BPMNEdge_0a6fs7m">
       |        <di:waypoint x="1428" y="640"/>
       |        <di:waypoint x="1502" y="640"/>
       |      </bpmndi:BPMNEdge>
       |    </bpmndi:BPMNPlane>
       |  </bpmndi:BPMNDiagram>
       |</bpmn:definitions>
       |""".stripMargin
  end bpmnC8
  
end BpmnProcessGenerator

