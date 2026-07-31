# localization

The same paywall in English, Spanish, German and French, chosen by the device.

```bash
superwall create --example localization
superwall dev
```

Switch locale in the studio's footer to see it change. There is deliberately no
language picker in the paywall: on a device the locale is the person's system
setting, so a control for it would be a button that does nothing where it
matters.

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

**Message catalogs need no wiring.** A file at `messages/<locale>.ts` is
discovered by its name — that is all `fr.ts` did.

**`t()` resolves against the device locale**, falling back to
`localization.defaultLocale` when the device asks for one you do not have.

```tsx
const { t, locale } = useTranslation();
t("paywall.title");
t("paywall.cta", { price }); // {price} in the string
```

**Prices are not translated — they are localized by the store.** The SDK
returns the right currency and format for the user's region, so never write a
price into a catalog.

**Copy expands.** German runs long, so nothing here is sized to fit English.

## Next

- [`minimal`](../minimal) — the same paywall without the localization
- [`multi-page`](../multi-page) — more than one screen
