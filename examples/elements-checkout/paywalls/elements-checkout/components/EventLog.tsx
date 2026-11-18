import { useTranslation } from "superwall/hooks";

export type LoggedEvent = {
  id: number;
  /** `paywall`: heard by `usePurchase`. `form`: heard by `<StripeCheckout>`. */
  source: "paywall" | "form";
  name: "onStart" | "onSubmit" | "onComplete" | "onAbandon" | "onFailure";
  product: string;
  /** The failure's reason, for `onFailure`. */
  detail?: string;
};

/**
 * The purchase callbacks as they fire, newest last. Each line says which
 * listener heard it: the page's `usePurchase`, which hears every purchase,
 * or the form's `<StripeCheckout>`, which hears only its own.
 */
export function EventLog({ events, onClear }: { events: LoggedEvent[]; onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="events" aria-label={t("events.label")}>
      <div className="events-head">
        <span>{t("events.label")}</span>
        {events.length > 0 ? (
          <button type="button" className="link" onClick={onClear}>
            {t("events.clear")}
          </button>
        ) : null}
      </div>
      {events.length === 0 ? (
        <p className="events-empty">{t("events.empty")}</p>
      ) : (
        <ol className="events-list">
          {events.map((event) => (
            <li key={event.id} className="event">
              <span className="event-source">{t(`events.${event.source}`)}</span>
              <span className="event-name">{event.name}</span>
              <span className="event-detail">
                {event.detail ? `${event.product} · ${event.detail}` : event.product}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
