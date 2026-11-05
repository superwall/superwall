import { useIntroductoryOffer, useProducts, useTeleport, useTranslation } from "superwall/hooks";

export default function Checkout() {
  const { t } = useTranslation();
  const teleport = useTeleport();
  const { getProduct } = useProducts();
  const { eligible } = useIntroductoryOffer();
  const tapped = "productReference" in teleport ? teleport.productReference : undefined;
  return (
    <main>
      <h1>{t("checkout.title")}</h1>
      <p data-product={tapped ?? "none"}>{tapped === undefined ? "Pick a plan" : getProduct(tapped)?.variables.price}</p>
      <p>{eligible ? "Trial included" : "No trial"}</p>
    </main>
  );
}
