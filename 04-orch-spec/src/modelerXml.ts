// BPMN and DMN written as the Camunda Modeler writes them - with its own serializer (bpmn-moddle,
// dmn-moddle and the extensions of Camunda 7 and 8). The merge from Orch Spec
// (`processFromSpec --merge`) brings base, new and code into this form before it compares them,
// and what it writes is in this form: a file the Modeler saved stays as it is, the next save in the
// Modeler gives no diff.
//
// What the Modeler would not write is dropped on the way (an attribute with its default value,
// `cancelActivity="true"`); the content stays. If moddle does not know something in the document
// (a warning) or an id would get lost: `formatXml` - as for anything that is not BPMN or DMN.
import { BpmnModdle } from 'bpmn-moddle';
import { DmnModdle } from 'dmn-moddle';
import camundaBpmn from 'camunda-bpmn-moddle/resources/camunda.json' with { type: 'json' };
import zeebe from 'zeebe-bpmn-moddle/resources/zeebe.json' with { type: 'json' };
import camundaDmn from 'camunda-dmn-moddle/resources/camunda.json' with { type: 'json' };
import { formatXml } from './xmlFormat.ts';

const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const DMN_NS = /https?:\/\/www\.omg\.org\/spec\/DMN\/\d+\/MODEL\/?/;

/** The namespace of the root element - decides between BPMN and DMN. */
function rootNamespace(xml: string): string | null {
  const root = /<([\w.-]+:)?(definitions)\b([^>]*)>/.exec(xml);
  if (!root) return null;
  const prefix = root[1]?.slice(0, -1);
  const ns = new RegExp(`\\sxmlns${prefix ? `:${prefix}` : ''}="([^"]*)"`).exec(root[3]);
  return ns?.[1] ?? null;
}

type Moddle = {
  fromXML(xml: string, type: string): Promise<{ rootElement: unknown; warnings: unknown[] }>;
  toXML(element: unknown, options: { format: boolean; preamble?: boolean }): Promise<{ xml: string }>;
};

// one engine per moddle, as in the Modeler - camunda: and zeebe: define the same properties
let c7: Moddle | null = null;
let c8: Moddle | null = null;
let dmn: Moddle | null = null;
const ZEEBE_NS = 'http://camunda.org/schema/zeebe/1.0';
const bpmnModdle = (xml: string) => xml.includes(ZEEBE_NS)
  ? (c8 ??= new BpmnModdle({ zeebe }) as unknown as Moddle)
  : (c7 ??= new BpmnModdle({ camunda: camundaBpmn }) as unknown as Moddle);
const dmnModdle = () => (dmn ??= new DmnModdle({ camunda: camundaDmn }) as unknown as Moddle);

/** the ids of a document - none may get lost on the way through moddle */
const ids = (xml: string) => [...xml.matchAll(/\sid="([^"]*)"/g)].map(m => m[1]).sort().join(' ');

/** The document as the Camunda Modeler writes it - `formatXml` for anything that is not BPMN or DMN. */
export async function modelerXml(xml: string): Promise<string> {
  const ns = rootNamespace(xml);
  const moddle = ns === BPMN_NS ? bpmnModdle(xml) : ns && DMN_NS.test(ns) ? dmnModdle() : null;
  if (!moddle) return formatXml(xml);
  try {
    const { rootElement, warnings } = await moddle.fromXML(xml, ns === BPMN_NS ? 'bpmn:Definitions' : 'dmn:Definitions');
    // something moddle does not know would be lost - then only the form of formatXml
    if (warnings.length) return formatXml(xml);
    const { xml: written } = await moddle.toXML(rootElement, { format: true });
    const out = written.endsWith('\n') ? written : `${written}\n`;
    return ids(out) === ids(xml) ? out : formatXml(xml);
  } catch {
    return formatXml(xml);
  }
}
