package orchescala.helper.dev.update

import orchescala.domain.BpmnProcessType

case class BpmnProcessGenerator(processType: BpmnProcessType)(using config: DevConfig):

  def createBpmn(setupElement: SetupElement): Unit =
    val name = s"${setupElement.identifierShort}.bpmn"
    if !os.exists(os.pwd / processType.diagramPath) then
       os.makeDir.all(os.pwd / processType.diagramPath)
    createIfNotExists(
      os.pwd / processType.diagramPath / name,
      processType match
        case _ : BpmnProcessType.C7 => bpmnC7(setupElement)
        case _ : BpmnProcessType.C8 => bpmnC8(setupElement)
        case _ : BpmnProcessType.Op => bpmnC7(setupElement)
    )
  end createBpmn

  private def bpmnC7(setupElement: SetupElement) =
    val processId = setupElement.identifier
    s"""<?xml version="1.0" encoding="UTF-8"?>
       |<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0"  xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="Definitions_0phxlok" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="5.23.0" modeler:executionPlatform="Camunda Platform" modeler:executionPlatformVersion="7.23.0">
       |  <bpmn:collaboration id="Collaboration_1nchi5w">
       |    <bpmn:participant id="$processId-Participant" name="$processId" processRef="$processId" />
       |  </bpmn:collaboration>
       |  <bpmn:process id="$processId" name="$processId" isExecutable="true">
       |    <bpmn:serviceTask id="InitProcessTask" name="Init Process" camunda:type="external" camunda:topic="$processId">
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
    s"""<?xml version="1.0" encoding="UTF-8"?>
       |<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="Definitions_169pkpp" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="5.34.0" modeler:executionPlatform="Camunda Cloud" modeler:executionPlatformVersion="8.6.0">
       |  <bpmn:collaboration id="Collaboration_0bb63t1">
       |    <bpmn:participant id="Participant_$processId" name="$processId" processRef="$processId" />
       |  </bpmn:collaboration>
       |  <bpmn:process id="$processId" name="$processId" isExecutable="true">
       |    <bpmn:startEvent id="StartEvent_1" name="start">
       |      <bpmn:extensionElements>
       |        <zeebe:executionListeners>
       |          <zeebe:executionListener eventType="end" retries="0" type="$processId" />
       |        </zeebe:executionListeners>
       |      </bpmn:extensionElements>
       |      <bpmn:outgoing>Flow_1gt1qt5</bpmn:outgoing>
       |    </bpmn:startEvent>
       |    <bpmn:endEvent id="Event_1p66wzz" name="succeded">
       |      <bpmn:extensionElements>
       |        <zeebe:ioMapping>
       |          <zeebe:output source="=&#34;succeeded&#34;" target="processStatus" />
       |        </zeebe:ioMapping>
       |      </bpmn:extensionElements>
       |      <bpmn:incoming>Flow_0d9xarg</bpmn:incoming>
       |    </bpmn:endEvent>
       |    <bpmn:exclusiveGateway id="Gateway_11ph763" name="mocked?" default="Flow_0d9xarg">
       |      <bpmn:incoming>Flow_1gt1qt5</bpmn:incoming>
       |      <bpmn:outgoing>Flow_0d9xarg</bpmn:outgoing>
       |      <bpmn:outgoing>Flow_1guvmo2</bpmn:outgoing>
       |    </bpmn:exclusiveGateway>
       |    <bpmn:endEvent id="Event_0icvc39" name="mocked">
       |      <bpmn:extensionElements>
       |        <zeebe:ioMapping>
       |          <zeebe:output source="=&#34;mocked&#34;" target="processStatus" />
       |        </zeebe:ioMapping>
       |      </bpmn:extensionElements>
       |      <bpmn:incoming>Flow_1guvmo2</bpmn:incoming>
       |    </bpmn:endEvent>
       |    <bpmn:sequenceFlow id="Flow_1gt1qt5" sourceRef="StartEvent_1" targetRef="Gateway_11ph763" />
       |    <bpmn:sequenceFlow id="Flow_0d9xarg" name="no" sourceRef="Gateway_11ph763" targetRef="Event_1p66wzz" />
       |    <bpmn:sequenceFlow id="Flow_1guvmo2" name="yes" sourceRef="Gateway_11ph763" targetRef="Event_0icvc39">
       |      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">=processStatus is outputMocked</bpmn:conditionExpression>
       |    </bpmn:sequenceFlow>
       |  </bpmn:process>
       |  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
       |    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collaboration_0bb63t1">
       |      <bpmndi:BPMNShape id="Participant_1byvi7a_di" bpmnElement="Participant_$processId" isHorizontal="true">
       |        <dc:Bounds x="160" y="68" width="600" height="250" />
       |        <bpmndi:BPMNLabel />
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
       |        <dc:Bounds x="242" y="162" width="36" height="36" />
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds x="249" y="205" width="22" height="14" />
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape id="Event_1p66wzz_di" bpmnElement="Event_1p66wzz">
       |        <dc:Bounds x="652" y="162" width="36" height="36" />
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds x="646" y="205" width="48" height="14" />
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape id="Gateway_11ph763_di" bpmnElement="Gateway_11ph763" isMarkerVisible="true" color:background-color="#cccccc">
       |        <dc:Bounds x="325" y="155" width="50" height="50" />
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds x="328" y="125" width="45" height="14" />
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNShape id="Event_0icvc39_di" bpmnElement="Event_0icvc39" color:background-color="#cccccc">
       |        <dc:Bounds x="332" y="262" width="36" height="36" />
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds x="331" y="305" width="39" height="14" />
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNShape>
       |      <bpmndi:BPMNEdge id="Flow_1gt1qt5_di" bpmnElement="Flow_1gt1qt5">
       |        <di:waypoint x="278" y="180" />
       |        <di:waypoint x="325" y="180" />
       |      </bpmndi:BPMNEdge>
       |      <bpmndi:BPMNEdge id="Flow_0d9xarg_di" bpmnElement="Flow_0d9xarg">
       |        <di:waypoint x="375" y="180" />
       |        <di:waypoint x="652" y="180" />
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds x="403" y="162" width="13" height="14" />
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNEdge>
       |      <bpmndi:BPMNEdge id="Flow_1guvmo2_di" bpmnElement="Flow_1guvmo2">
       |        <di:waypoint x="350" y="205" />
       |        <di:waypoint x="350" y="262" />
       |        <bpmndi:BPMNLabel>
       |          <dc:Bounds x="361" y="213" width="18" height="14" />
       |        </bpmndi:BPMNLabel>
       |      </bpmndi:BPMNEdge>
       |    </bpmndi:BPMNPlane>
       |  </bpmndi:BPMNDiagram>
       |</bpmn:definitions>
       |""".stripMargin
  end bpmnC8
  
end BpmnProcessGenerator

