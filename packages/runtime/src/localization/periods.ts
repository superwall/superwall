type PeriodKey =
  | "lifetime"
  | "year"
  | "6 month"
  | "quarter"
  | "2 month"
  | "month"
  | "week"
  | "day"
  | "yearly"
  | "monthly"
  | "weekly"
  | "daily"
  | "quarterly";

const periodTranslations: Record<string, Record<PeriodKey, string>> = {
  en: {
    lifetime: "lifetime",
    year: "year",
    "6 month": "6 months",
    quarter: "quarter",
    "2 month": "2 months",
    month: "month",
    week: "week",
    day: "day",
    yearly: "yearly",
    monthly: "monthly",
    weekly: "weekly",
    daily: "daily",
    quarterly: "quarterly",
  },
  es: {
    lifetime: "de por vida",
    year: "año",
    "6 month": "6 meses",
    quarter: "trimestre",
    "2 month": "2 meses",
    month: "mes",
    week: "semana",
    day: "día",
    yearly: "anual",
    monthly: "mensual",
    weekly: "semanal",
    daily: "diario",
    quarterly: "trimestral",
  },
  pt: {
    lifetime: "vitalício",
    year: "ano",
    "6 month": "6 meses",
    quarter: "trimestre",
    "2 month": "2 meses",
    month: "mês",
    week: "semana",
    day: "dia",
    yearly: "anual",
    monthly: "mensal",
    weekly: "semanal",
    daily: "diário",
    quarterly: "trimestral",
  },
  pt_BR: {
    lifetime: "vitalício",
    year: "ano",
    "6 month": "6 meses",
    quarter: "trimestre",
    "2 month": "2 meses",
    month: "mês",
    week: "semana",
    day: "dia",
    yearly: "anual",
    monthly: "mensal",
    weekly: "semanal",
    daily: "diário",
    quarterly: "trimestral",
  },
  pt_PT: {
    lifetime: "vitalício",
    year: "ano",
    "6 month": "6 meses",
    quarter: "trimestre",
    "2 month": "2 meses",
    month: "mês",
    week: "semana",
    day: "dia",
    yearly: "anual",
    monthly: "mensal",
    weekly: "semanal",
    daily: "diário",
    quarterly: "trimestral",
  },
  fr: {
    lifetime: "à vie",
    year: "année",
    "6 month": "6 mois",
    quarter: "trimestre",
    "2 month": "2 mois",
    month: "mois",
    week: "semaine",
    day: "jour",
    yearly: "annuel",
    monthly: "mensuel",
    weekly: "hebdomadaire",
    daily: "quotidien",
    quarterly: "trimestriel",
  },
  it: {
    lifetime: "a vita",
    year: "anno",
    "6 month": "6 mesi",
    quarter: "trimestre",
    "2 month": "2 mesi",
    month: "mese",
    week: "settimana",
    day: "giorno",
    yearly: "annuale",
    monthly: "mensile",
    weekly: "settimanale",
    daily: "giornaliero",
    quarterly: "trimestrale",
  },
  da: {
    lifetime: "livstid",
    year: "år",
    "6 month": "6 måneder",
    quarter: "kvartal",
    "2 month": "2 måneder",
    month: "måned",
    week: "uge",
    day: "dag",
    yearly: "årlig",
    monthly: "månedlig",
    weekly: "ugentlig",
    daily: "daglig",
    quarterly: "kvartalsvis",
  },
  tr: {
    lifetime: "ömür boyu",
    year: "yıl",
    "6 month": "6 ay",
    quarter: "çeyrek",
    "2 month": "2 ay",
    month: "ay",
    week: "hafta",
    day: "gün",
    yearly: "yıllık",
    monthly: "aylık",
    weekly: "haftalık",
    daily: "günlük",
    quarterly: "çeyreklik",
  },
  uk: {
    lifetime: "довічно",
    year: "рік",
    "6 month": "6 місяців",
    quarter: "квартал",
    "2 month": "2 місяці",
    month: "місяць",
    week: "тиждень",
    day: "день",
    yearly: "щорічно",
    monthly: "щомісячно",
    weekly: "щотижня",
    daily: "щодня",
    quarterly: "щоквартально",
  },
  nl: {
    lifetime: "levenslang",
    year: "jaar",
    "6 month": "6 maanden",
    quarter: "kwartaal",
    "2 month": "2 maanden",
    month: "maand",
    week: "week",
    day: "dag",
    yearly: "jaarlijks",
    monthly: "maandelijks",
    weekly: "wekelijks",
    daily: "dagelijks",
    quarterly: "kwartaallijks",
  },
  ru: {
    lifetime: "пожизненно",
    year: "год",
    "6 month": "6 месяцев",
    quarter: "квартал",
    "2 month": "2 месяца",
    month: "месяц",
    week: "неделя",
    day: "день",
    yearly: "ежегодно",
    monthly: "ежемесячно",
    weekly: "еженедельно",
    daily: "ежедневно",
    quarterly: "ежеквартально",
  },
  ar: {
    lifetime: "مدى الحياة",
    year: "سنة",
    "6 month": "6 أشهر",
    quarter: "ربع سنة",
    "2 month": "شهرين",
    month: "شهر",
    week: "أسبوع",
    day: "يوم",
    yearly: "سنوياً",
    monthly: "شهرياً",
    weekly: "أسبوعياً",
    daily: "يومياً",
    quarterly: "كل ربع سنة",
  },
  zh: {
    lifetime: "终身",
    year: "年",
    "6 month": "6个月",
    quarter: "季度",
    "2 month": "2个月",
    month: "月",
    week: "周",
    day: "天",
    yearly: "每年",
    monthly: "每月",
    weekly: "每周",
    daily: "每天",
    quarterly: "每季度",
  },
  de: {
    lifetime: "lebenslang",
    year: "jahr",
    "6 month": "6 monate",
    quarter: "quartal",
    "2 month": "2 monate",
    month: "monat",
    week: "woche",
    day: "tag",
    yearly: "jährlich",
    monthly: "monatlich",
    weekly: "wöchentlich",
    daily: "täglich",
    quarterly: "vierteljährlich",
  },
  hr: {
    lifetime: "doživotno",
    year: "godina",
    "6 month": "6 mjeseci",
    quarter: "kvartal",
    "2 month": "2 mjeseca",
    month: "mjesec",
    week: "tjedan",
    day: "dan",
    yearly: "godišnje",
    monthly: "mjesečno",
    weekly: "tjedno",
    daily: "dnevno",
    quarterly: "kvartalno",
  },
  he: {
    lifetime: "לכל החיים",
    year: "שנה",
    "6 month": "6 חודשים",
    quarter: "רבעון",
    "2 month": "חודשיים",
    month: "חודש",
    week: "שבוע",
    day: "יום",
    yearly: "שנתי",
    monthly: "חודשי",
    weekly: "שבועי",
    daily: "יומי",
    quarterly: "רבעוני",
  },
  sv: {
    lifetime: "livstid",
    year: "år",
    "6 month": "6 månader",
    quarter: "kvartal",
    "2 month": "2 månader",
    month: "månad",
    week: "vecka",
    day: "dag",
    yearly: "årlig",
    monthly: "månatlig",
    weekly: "veckovis",
    daily: "daglig",
    quarterly: "kvartalsvis",
  },
  el: {
    lifetime: "εφ' όρου ζωής",
    year: "έτος",
    "6 month": "6 μήνες",
    quarter: "τρίμηνο",
    "2 month": "2 μήνες",
    month: "μήνας",
    week: "εβδομάδα",
    day: "ημέρα",
    yearly: "ετησίως",
    monthly: "μηνιαίως",
    weekly: "εβδομαδιαίως",
    daily: "καθημερινά",
    quarterly: "τριμηνιαίως",
  },
  fi: {
    lifetime: "elinikäinen",
    year: "vuosi",
    "6 month": "6 kuukautta",
    quarter: "neljännesvuosi",
    "2 month": "2 kuukautta",
    month: "kuukausi",
    week: "viikko",
    day: "päivä",
    yearly: "vuosittainen",
    monthly: "kuukausittainen",
    weekly: "viikottainen",
    daily: "päivittäinen",
    quarterly: "neljännesvuosittainen",
  },
  ja: {
    lifetime: "生涯",
    year: "年",
    "6 month": "6ヶ月",
    quarter: "四半期",
    "2 month": "2ヶ月",
    month: "月",
    week: "週",
    day: "日",
    yearly: "年次",
    monthly: "毎月",
    weekly: "毎週",
    daily: "毎日",
    quarterly: "四半期毎",
  },
  ro: {
    lifetime: "pe viață",
    year: "an",
    "6 month": "6 luni",
    quarter: "trimestru",
    "2 month": "2 luni",
    month: "lună",
    week: "săptămână",
    day: "zi",
    yearly: "anual",
    monthly: "lunar",
    weekly: "săptămânal",
    daily: "zilnic",
    quarterly: "trimestrial",
  },
  hu: {
    lifetime: "életre szóló",
    year: "év",
    "6 month": "6 hónap",
    quarter: "negyedév",
    "2 month": "2 hónap",
    month: "hónap",
    week: "hét",
    day: "nap",
    yearly: "évi",
    monthly: "havi",
    weekly: "heti",
    daily: "napi",
    quarterly: "negyedévi",
  },
  pl: {
    lifetime: "dożywotni",
    year: "rok",
    "6 month": "6 miesięcy",
    quarter: "kwartał",
    "2 month": "2 miesiące",
    month: "miesiąc",
    week: "tydzień",
    day: "dzień",
    yearly: "roczny",
    monthly: "miesięczny",
    weekly: "tygodniowy",
    daily: "codzienny",
    quarterly: "kwartalny",
  },
  "ko-Kore": {
    lifetime: "평생",
    year: "년",
    "6 month": "6개월",
    quarter: "분기",
    "2 month": "2개월",
    month: "월",
    week: "주",
    day: "일",
    yearly: "매년",
    monthly: "매월",
    weekly: "매주",
    daily: "매일",
    quarterly: "분기별",
  },
  th: {
    lifetime: "ตลอดชีวิต",
    year: "ปี",
    "6 month": "6 เดือน",
    quarter: "ไตรมาส",
    "2 month": "2 เดือน",
    month: "เดือน",
    week: "สัปดาห์",
    day: "วัน",
    yearly: "รายปี",
    monthly: "รายเดือน",
    weekly: "รายสัปดาห์",
    daily: "รายวัน",
    quarterly: "รายไตรมาส",
  },
  cs: {
    lifetime: "celoživotní",
    year: "rok",
    "6 month": "6 měsíců",
    quarter: "čtvrtletí",
    "2 month": "2 měsíce",
    month: "měsíc",
    week: "týden",
    day: "den",
    yearly: "roční",
    monthly: "měsíční",
    weekly: "týdení",
    daily: "denní",
    quarterly: "čtvrtletní",
  },
  "zh-Hans": {
    lifetime: "终身",
    year: "年",
    "6 month": "6个月",
    quarter: "季度",
    "2 month": "2个月",
    month: "月",
    week: "周",
    day: "天",
    yearly: "每年",
    monthly: "每月",
    weekly: "每周",
    daily: "每天",
    quarterly: "每季度",
  },
  id: {
    lifetime: "seumur hidup",
    year: "tahun",
    "6 month": "6 bulan",
    quarter: "kuartal",
    "2 month": "2 bulan",
    month: "bulan",
    week: "minggu",
    day: "hari",
    yearly: "tahunan",
    monthly: "bulanan",
    weekly: "mingguan",
    daily: "harian",
    quarterly: "kuartalan",
  },
  "zh-Hant": {
    lifetime: "終身",
    year: "年",
    "6 month": "6個月",
    quarter: "季度",
    "2 month": "2個月",
    month: "月",
    week: "週",
    day: "天",
    yearly: "每年",
    monthly: "每月",
    weekly: "每週",
    daily: "每天",
    quarterly: "每季度",
  },
  ms: {
    lifetime: "seumur hidup",
    year: "tahun",
    "6 month": "6 bulan",
    quarter: "suku tahun",
    "2 month": "2 bulan",
    month: "bulan",
    week: "minggu",
    day: "hari",
    yearly: "tahunan",
    monthly: "bulanan",
    weekly: "mingguan",
    daily: "harian",
    quarterly: "suku tahunan",
  },
  vi: {
    lifetime: "trọn đời",
    year: "năm",
    "6 month": "6 tháng",
    quarter: "quý",
    "2 month": "2 tháng",
    month: "tháng",
    week: "tuần",
    day: "ngày",
    yearly: "hàng năm",
    monthly: "hàng tháng",
    weekly: "hàng tuần",
    daily: "hàng ngày",
    quarterly: "hàng quý",
  },
  sk: {
    lifetime: "celoživotný",
    year: "rok",
    "6 month": "6 mesiacov",
    quarter: "štvrťrok",
    "2 month": "2 mesiace",
    month: "mesiac",
    week: "týždeň",
    day: "deň",
    yearly: "ročne",
    monthly: "mesačne",
    weekly: "týždenne",
    daily: "denne",
    quarterly: "štvrťročne",
  },
  no: {
    lifetime: "livstid",
    year: "år",
    "6 month": "6 måneder",
    quarter: "kvartal",
    "2 month": "2 måneder",
    month: "måned",
    week: "uke",
    day: "dag",
    yearly: "årlig",
    monthly: "månedlig",
    weekly: "ukentlig",
    daily: "daglig",
    quarterly: "kvartalsvis",
  },
  nb: {
    lifetime: "livstid",
    year: "år",
    "6 month": "6 måneder",
    quarter: "kvartal",
    "2 month": "2 måneder",
    month: "måned",
    week: "uke",
    day: "dag",
    yearly: "årlig",
    monthly: "månedlig",
    weekly: "ukentlig",
    daily: "daglig",
    quarterly: "kvartalsvis",
  },
  ca: {
    lifetime: "de per vida",
    year: "any",
    "6 month": "6 mesos",
    quarter: "trimestre",
    "2 month": "2 mesos",
    month: "mes",
    week: "setmana",
    day: "dia",
    yearly: "anualment",
    monthly: "mensualment",
    weekly: "setmanalment",
    daily: "diàriament",
    quarterly: "trimestralment",
  },
  fa: {
    lifetime: "مادام‌العمر",
    year: "سال",
    "6 month": "6 ماه",
    quarter: "سه‌ماهه",
    "2 month": "2 ماه",
    month: "ماه",
    week: "هفته",
    day: "روز",
    yearly: "سالانه",
    monthly: "ماهانه",
    weekly: "هفتگی",
    daily: "روزانه",
    quarterly: "سه‌ماهه",
  },
  ko: {
    lifetime: "평생",
    year: "년",
    "6 month": "6개월",
    quarter: "분기",
    "2 month": "2개월",
    month: "월",
    week: "주",
    day: "일",
    yearly: "매년",
    monthly: "매월",
    weekly: "매주",
    daily: "매일",
    quarterly: "분기별",
  },
  lt: {
    lifetime: "visam gyvenimui",
    year: "metai",
    "6 month": "6 mėnesiai",
    quarter: "ketvirtis",
    "2 month": "2 mėnesiai",
    month: "mėnuo",
    week: "savaitė",
    day: "diena",
    yearly: "kasmet",
    monthly: "kas mėnesį",
    weekly: "kas savaitę",
    daily: "kasdien",
    quarterly: "kas ketvirtį",
  },
  af: {
    lifetime: "lewenslank",
    year: "jaar",
    "6 month": "6 maande",
    quarter: "kwartaal",
    "2 month": "2 maande",
    month: "maand",
    week: "week",
    day: "dag",
    yearly: "jaarliks",
    monthly: "maandeliks",
    weekly: "weekliks",
    daily: "daagliks",
    quarterly: "kwartaalliks",
  },
  be: {
    lifetime: "на ўсё жыццё",
    year: "год",
    "6 month": "6 месяцаў",
    quarter: "квартал",
    "2 month": "2 месяцы",
    month: "месяц",
    week: "тыдзень",
    day: "дзень",
    yearly: "штогод",
    monthly: "штомесяц",
    weekly: "штотыдзень",
    daily: "штодня",
    quarterly: "штоквартал",
  },
  bg: {
    lifetime: "доживотно",
    year: "година",
    "6 month": "6 месеца",
    quarter: "тримесечие",
    "2 month": "2 месеца",
    month: "месец",
    week: "седмица",
    day: "ден",
    yearly: "годишно",
    monthly: "месечно",
    weekly: "седмично",
    daily: "дневно",
    quarterly: "тримесечно",
  },
  hi: {
    lifetime: "जीवनभर",
    year: "वर्ष",
    "6 month": "6 महीने",
    quarter: "तिमाही",
    "2 month": "2 महीने",
    month: "महीना",
    week: "सप्ताह",
    day: "दिन",
    yearly: "वार्षिक",
    monthly: "मासिक",
    weekly: "साप्ताहिक",
    daily: "दैनिक",
    quarterly: "तिमाही",
  },
  gu: {
    lifetime: "આજીવન",
    year: "વર્ષ",
    "6 month": "6 મહિના",
    quarter: "ત્રિમાસ",
    "2 month": "2 મહિના",
    month: "મહિનો",
    week: "અઠવાડિયું",
    day: "દિવસ",
    yearly: "વાર્ષિક",
    monthly: "માસિક",
    weekly: "સાપ્તાહિક",
    daily: "દૈનિક",
    quarterly: "ત્રિમાસિક",
  },
};

const DYNAMIC_UNITS = ["day", "week", "month", "year"] as const;

type DynamicUnit = (typeof DYNAMIC_UNITS)[number];

const formatDynamicPeriod = (count: number, unit: DynamicUnit, locale: string): string => {
  try {
    return new Intl.NumberFormat(locale.replace(/_/g, "-"), {
      style: "unit",
      unit,
      unitDisplay: "long",
    })
      .format(count)
      .replace(/\u00a0/g, " ");
  } catch {
    return `${count} ${count === 1 ? unit : `${unit}s`}`;
  }
};

type DynamicPeriodlyFormatter = (localizedPeriod: string, unit: string) => string;

const dynamicPeriodlyFormatters: Record<string, DynamicPeriodlyFormatter> = {
  en: (localizedPeriod) => `every ${localizedPeriod}`,
  de: (localizedPeriod) => `alle ${localizedPeriod}`,
  es: (localizedPeriod) => `cada ${localizedPeriod}`,
  fr: (localizedPeriod, unit) =>
    `${unit === "week" ? "toutes les" : "tous les"} ${localizedPeriod}`,
  it: (localizedPeriod) => `ogni ${localizedPeriod}`,
  pt: (localizedPeriod) => `cada ${localizedPeriod}`,
};

const getDynamicPeriodlyFormatter = (locale: string): DynamicPeriodlyFormatter | null => {
  const normalizedLocale = locale.trim();
  if (!normalizedLocale) {
    return null;
  }

  return (
    dynamicPeriodlyFormatters[normalizedLocale] ??
    dynamicPeriodlyFormatters[normalizedLocale.split(/[-_]/)[0]!] ??
    null
  );
};

const formatDynamicLocalizedValue = (
  count: number,
  unit: DynamicUnit,
  languages: string[],
): string => {
  const preferredLocale = languages.find((language) => language.trim());
  return formatDynamicPeriod(count, unit, preferredLocale || "en");
};

const formatDynamicPeriodly = (count: number, unit: DynamicUnit, languages: string[]): string => {
  for (const language of languages) {
    const formatter = getDynamicPeriodlyFormatter(language);
    if (!formatter) {
      continue;
    }

    return formatter(formatDynamicPeriod(count, unit, language), unit);
  }

  return dynamicPeriodlyFormatters.en(formatDynamicPeriod(count, unit, "en"), unit);
};

const getDynamicLocalizedPeriod = (value: string, languages: string[]): string | null => {
  const normalizedValue = value.trim().toLowerCase();
  const recurringMatch = normalizedValue.match(/^(\d+)\s+([a-z]+)$/);
  const periodlyMatch = normalizedValue.match(/^every\s+(\d+)\s+([a-z]+)$/);
  const match = periodlyMatch || recurringMatch;

  if (!match) {
    return null;
  }

  const count = Number.parseInt(match[1]!, 10);
  const rawUnit = match[2]!;
  const singular = rawUnit.endsWith("s") ? rawUnit.slice(0, -1) : rawUnit;
  const unit = DYNAMIC_UNITS.find((candidate) => candidate === singular);

  if (!unit) {
    return null;
  }

  if (periodlyMatch) {
    return formatDynamicPeriodly(count, unit, languages);
  }

  return formatDynamicLocalizedValue(count, unit, languages);
};

export const languageCandidates = (locale: string | undefined): string[] => {
  if (!locale) return ["en"];
  const normalized = locale.replace(/-/g, "_");
  const [language] = normalized.split("_");
  return language && language !== normalized ? [normalized, language.toLowerCase()] : [normalized];
};

export function getLocalizedPeriod(value: string, languages: string[]): string {
  for (const lang of languages) {
    const translations = periodTranslations[lang];
    if (translations && translations[value as PeriodKey]) {
      return translations[value as PeriodKey];
    }
  }

  const lowerValue = value.toLowerCase();
  for (const [, translations] of Object.entries(periodTranslations)) {
    for (const [canonicalKey, localizedValue] of Object.entries(translations)) {
      if (localizedValue.toLowerCase() === lowerValue) {
        for (const lang of languages) {
          const targetTranslations = periodTranslations[lang];
          if (targetTranslations && targetTranslations[canonicalKey as PeriodKey]) {
            return targetTranslations[canonicalKey as PeriodKey];
          }
        }
      }
    }
  }

  const dynamicPeriod = getDynamicLocalizedPeriod(value, languages);
  if (dynamicPeriod) {
    return dynamicPeriod;
  }

  return value;
}
