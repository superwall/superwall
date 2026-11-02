export default {
  title: "Pro werden",
  subtitle: "Mit Apple Pay in zwei Schritten bezahlen. Jederzeit kündbar.",
  plans: {
    label: "Tarife",
    trial: "3 Tage kostenlos testen",
    trialNote: "danach monatliche Abrechnung",
    intro: "3 Tage für {price}",
    introBare: "3 Tage zum Einstiegspreis",
    introNote: "danach monatliche Abrechnung",
    monthly: "Monatlich",
    monthlyNote: "monatliche Abrechnung",
    empty: "—",
  },
  promo: {
    placeholder: "Gutscheincode",
    apply: "Einlösen",
    applying: "Wird geprüft…",
    remove: "Entfernen",
    unknown: "Diesen Code kennen wir nicht.",
    ineligible: "Dieser Code gilt nicht für diese Tarife.",
    failed: "Der Code konnte nicht geprüft werden. Bitte erneut versuchen.",
    dropped: "Dieser Code ist nicht mehr gültig und wurde entfernt.",
  },
  purchase: {
    continue: "Weiter",
    applePay: "Mit Apple Pay bezahlen",
    restore: "Käufe wiederherstellen",
    failed: "Das hat nicht geklappt. Bitte erneut versuchen.",
  },
  wallet: {
    native: "Apple Pay: in dieser App nicht angeboten (undefined).",
    none: {
      unsupported_browser:
        "Apple Pay: dieser Browser kann die Wallet nicht selbst öffnen (false, unsupported_browser).",
      insecure_context:
        "Apple Pay: die Seite wird nicht über HTTPS geladen (false, insecure_context).",
      device_unsupported:
        "Apple Pay: dieses Gerät kann nicht mit Apple Pay zahlen (false, device_unsupported).",
      cross_origin_frame:
        "Apple Pay: in einem Frame einer anderen Seite blockiert (false, cross_origin_frame).",
      check_failed: "Apple Pay: die Prüfung des Browsers ist fehlgeschlagen (false, check_failed).",
    },
    preparing: "Apple Pay: verfügbar (true), Wallet wird vorbereitet…",
    ready: "Apple Pay: verfügbar (true), die Wallet öffnet sich beim Tippen.",
    unavailable:
      "Apple Pay: verfügbar (true), aber die Wallet ist nicht bereit ({reason}), daher öffnet sich das Kartenformular.",
  },
  restore: {
    restored: "Käufe wiederhergestellt.",
    failed:
      "Nichts wiederherzustellen, oder der Store hat nicht geantwortet. Bitte erneut versuchen.",
  },
  discount: {
    percentOff: "{percent}% Rabatt",
    amountOff: "{amount} Rabatt",
    once: "auf deine erste Zahlung",
    repeating: "für {months} Monate",
    forever: "dauerhaft",
    applied: "Code {code} aktiv",
  },
  common: {
    close: "Schließen",
  },
  footer: {
    builtWith: "Erstellt mit",
    superwall: "Superwall",
  },
} as const;
