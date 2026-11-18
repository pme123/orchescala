// The DOM of the browser in Node with linkedom - for the tools that write BPMN (spec2export) and for
// the tests. The installer is in src/core (the studio passes its own parser); here linkedom.
import { DOMParser } from 'linkedom';
import { installNodeDom as installWith, installXmlNamespaces as namespacesWith } from '../../src/core/nodeDom.ts';

export const installNodeDom = () => installWith(DOMParser);
export const installXmlNamespaces = () => namespacesWith(DOMParser);
