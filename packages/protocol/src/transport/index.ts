import { TransportKind } from "../initializationParams";
import { buildAndroidTransport } from "./android";
import { EditorTransport } from "./editor";
import { ITransport } from "./shared";
import { buildWebKitTransport } from "./webkit";

export * from "./shared";
export * from "./webkit";
export * from "./editor";

export const buildTransport = (transport: TransportKind): ITransport => {
  switch (transport) {
    case TransportKind.Android: {
      return buildAndroidTransport();
    }
    case TransportKind.WebKitPostMessage: {
      return buildWebKitTransport();
    }
    case TransportKind.EditorIframe: {
      return new EditorTransport({
        targetWindow: window.parent,
        targetOrigin: "*",
      });
    }
  }
};
