declare module "jsdom" {
  export class VirtualConsole {
    on(event: string, listener: (...args: unknown[]) => void): this;
  }
  export class JSDOM {
    constructor(
      html: string,
      options: {
        runScripts: "dangerously" | "outside-only";
        url: string;
        pretendToBeVisual?: boolean;
        virtualConsole?: VirtualConsole;
      },
    );
    readonly window: Window & typeof globalThis;
  }
}
