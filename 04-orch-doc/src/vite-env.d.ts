/// <reference types="vite/client" />

// dmn-js ships without type definitions
declare module 'dmn-js/lib/NavigatedViewer' {
  const DmnViewer: new (options: { container: HTMLElement }) => unknown;
  export default DmnViewer;
}
