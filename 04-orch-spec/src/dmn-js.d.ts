// dmn-js ships no types — what the table editor needs from it (see DmnEditor.tsx)
declare module 'dmn-js/lib/Modeler' {
  export interface DmnView { type: string; element: { id: string; name?: string } }
  export default class DmnModeler {
    constructor(options: { container?: HTMLElement; moddleExtensions?: Record<string, unknown>; common?: Record<string, unknown> });
    importXML(xml: string): Promise<{ warnings: unknown[] }>;
    saveXML(options?: { format?: boolean }): Promise<{ xml?: string }>;
    getViews(): DmnView[];
    getActiveView(): DmnView | null;
    open(view: DmnView): Promise<unknown>;
    getActiveViewer(): { get: (name: string) => unknown; on: (event: string, cb: () => void) => void } | null;
    on(event: string, cb: (e: unknown) => void): void;
    destroy(): void;
  }
}
