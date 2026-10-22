declare module "jsdom" {
  export class JSDOM {
    constructor(html: string, options: { runScripts: "dangerously"; url: string });
    readonly window: Window & typeof globalThis;
  }
}
