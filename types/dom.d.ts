// The vault looks elements up by ID and class from markup it controls. TypeScript
// would otherwise type every lookup as a bare HTMLElement and reject `.value`,
// `.showModal()` and similar. These overloads keep checkJs focused on logic.
interface Document {
  getElementById(elementId: string): any;
}
interface ParentNode {
  querySelector(selectors: string): any;
  querySelectorAll(selectors: string): NodeListOf<any>;
}
interface Element {
  closest(selectors: string): any;
}
interface Event {
  readonly target: any;
  readonly currentTarget: any;
}
