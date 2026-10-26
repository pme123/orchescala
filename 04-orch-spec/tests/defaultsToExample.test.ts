// A class without the `example` pattern keeps its example values as defaults in the constructor
// (`country: String = "CH"`). Orch Spec has defaults only where they are used (InConfig, InitIn,
// optional fields of the process input) - elsewhere the import takes them as example value, and
// the export writes them into `example` instead of the constructor.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { scanScala } from '../src/domainScan';
import { enrichSpec } from '../src/projectImport';
import { scalaFiles, checkTypes } from '../src/scala';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const PID = 'acme-demo-addressV1';
const PKG = 'acme.demo.domain.address.v1';

const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${PID}" name="${PID}" isExecutable="true">
    <bpmn:startEvent id="StartEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

const source = `package ${PKG}

object Address extends CompanyBpmnProcessDsl:
  val processName = "${PID}"
  val descr: String = ""

  case class In(
      street: String = "Bahnhofstrasse 1",
      country: Option[String] = Some("CH"),
      tags: Seq[String] = Seq.empty,
      zip: Int = 3000,
      place: Place
  )

  case class Place(
      name: String = "Bern",
      canton: String
  )

  case class InitIn(
      retries: Int = 3
  )

  lazy val example = process(In(place = Place(canton = "BE")), NoOutput())
end Address
`;

const enriched = () => {
  const domain = scanScala(source, 'Address.scala');
  return { domain, r: enrichSpec({ ...importBpmn(bpmn, 'address').spec, project: 'acme-demo' }, domain, null)! };
};

test('import: a constructor default is the example value where Orch Spec has no default', () => {
  const { r } = enriched();
  const field = (type: string, name: string) =>
    r.spec.types!.find(t => t.name === type)!.fields!.find(f => f.name === name)!;
  // the process input: a mandatory field has no default - its value is the example
  assert.equal(field('In', 'street').default, undefined);
  assert.equal(field('In', 'street').example, '"Bahnhofstrasse 1"');
  assert.equal(field('In', 'zip').default, undefined);
  assert.equal(field('In', 'zip').example, '3000');
  assert.equal(field('In', 'tags').example, 'Seq.empty');
  // an optional field of the process input keeps its default (the init worker sets it)
  assert.equal(field('In', 'country').default, 'Some("CH")');
  // another class: no defaults at all
  assert.equal(field('Place', 'name').default, undefined);
  assert.equal(field('Place', 'name').example, '"Bern"');
  // the InitIn keeps its default
  assert.equal(field('InitIn', 'retries').default, '3');
});

test('import: no «Vorgabe wird nicht verwendet» - export writes the value into `example`', () => {
  const { domain, r } = enriched();
  const model = { domainTypes: domain, services: [] } as never;
  const issues = checkTypes(r.spec.types ?? [], model).filter(i => /Vorgabe/.test(i.message));
  assert.deepEqual(issues, []);
  const all = scalaFiles(r.spec, model).map(f => f.content).join('\n');
  // no default in the class ...
  assert.doesNotMatch(all, /street: String = /);
  assert.doesNotMatch(all, /name: String = /);
  // ... the value in the example
  assert.match(all, /street = "Bahnhofstrasse 1"/);
  assert.match(all, /zip = 3000/);
  assert.match(all, /tags = Seq\.empty/);
  assert.match(all, /name = "Bern"/);
});

// The InConfig the other way round: no defaults, the values in `InConfig.example`
// (`defaultConfig = InConfig.example`) - for the configuration they are the defaults.
const configSource = `package ${PKG}

object Address extends CompanyBpmnProcessDsl:
  val processName = "${PID}"
  val descr: String = ""

  case class In(
      street: String,
      inConfig: Option[InConfig] = None
  ) extends WithConfig[InConfig]:
    lazy val defaultConfig = InConfig.example
  end In

  case class InConfig(
      // Process Configuration
      @description("Time to wait")
      timerInformKube: String,
      timerEscalationInform: Option[String],
      timerSendProcessEvent: Iso8601Duration,
      qmsRole: String = "6300--QMS"
  )
  object InConfig:
    given ApiSchema[InConfig]  = deriveApiSchema
    given InOutCodec[InConfig] = deriveInOutCodec
    lazy val example = InConfig(
      timerInformKube = "P1D",
      timerEscalationInform = Some("P5D"),
      timerSendProcessEvent = "PT5S"
    )
  end InConfig

  lazy val example = process(In(street = "x"), NoOutput())
end Address
`;

test('import: the values of `InConfig.example` are the defaults of the configuration', () => {
  const domain = scanScala(configSource, 'Address.scala');
  const r = enrichSpec({ ...importBpmn(bpmn, 'address').spec, project: 'acme-demo' }, domain, null)!;
  const cfg = r.spec.types!.find(t => t.inConfig)!;
  const field = (name: string) => cfg.fields!.find(f => f.name === name)!;
  assert.equal(field('timerInformKube').default, '"P1D"');
  assert.equal(field('timerEscalationInform').default, 'Some("P5D")');
  assert.equal(field('timerSendProcessEvent').default, '"PT5S"');
  assert.equal(field('qmsRole').default, '"6300--QMS"');
  // no example values - the InConfig has none
  assert.ok(cfg.fields!.every(f => !f.example), JSON.stringify(cfg.fields));
  const all = scalaFiles(r.spec, { domainTypes: domain, services: [] } as never).map(f => f.content).join('\n');
  assert.match(all, /timerInformKube: String = "P1D"/);
  assert.match(all, /timerEscalationInform: Option\[String\] = Some\("P5D"\)/);
  assert.match(all, /timerSendProcessEvent: Iso8601Duration = "PT5S"/);
  assert.match(all, /qmsRole: String = "6300--QMS"/);
});
