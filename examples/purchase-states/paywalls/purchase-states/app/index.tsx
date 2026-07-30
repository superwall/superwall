import * as React from "react";
import {
  useActions,
  useHaptics,
  useProducts,
  usePurchase,
  useSuperwallEvent,
} from "superwall/hooks";

type Entry = { name: string; detail?: string };

export default function Index() {
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const haptics = useHaptics();

  const [log, setLog] = React.useState<Entry[]>([]);
  const add = React.useCallback((entry: Entry) => setLog((all) => [entry, ...all]), []);

  useSuperwallEvent("transaction_complete", () => {
    haptics.success();
    add({ name: "transaction_complete", detail: "Bought or restored." });
  });
  useSuperwallEvent("transaction_abandon", () => {
    add({ name: "transaction_abandon", detail: "Closed the sheet." });
  });
  useSuperwallEvent("freeTrial_start", () => {
    haptics.success();
    add({ name: "freeTrial_start", detail: "Trial started." });
  });

  const annual = getProduct("annual");

  return (
    <main className="page">
      <div className="lede">
        <h1>Purchase states</h1>
        <p>Get the outcome of a purchase and act on it. Pick the result in the studio.</p>
      </div>

      <div className="log">
        {log.length === 0 ? (
          <span className="log-empty">Nothing yet.</span>
        ) : (
          log.map((entry, index) => (
            <div className="log-row" key={`${entry.name}-${index}`}>
              <span className="log-name">{entry.name}</span>
              <span className="log-detail">{entry.detail}</span>
            </div>
          ))
        )}
      </div>

      <p className="note">
        <code>purchase()</code> resolves with the outcome of that call. Events fire for anything the
        SDK reports — a successful restore arrives as <code>transaction_complete</code> too.
      </p>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            void purchase("annual").then((result) => {
              if (result.status === "failed") haptics.error();
              add({
                name: `purchase() → ${result.status}`,
                detail: "What the call resolved with.",
              });
            });
          }}
        >
          {annual?.variables.price ? `Subscribe · ${annual.variables.price}` : "Subscribe"}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            haptics.light();
            restore();
          }}
        >
          Restore purchases
        </button>
      </div>
    </main>
  );
}
