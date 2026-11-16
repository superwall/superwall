import { useTeleport, useTranslation } from "superwall/hooks";

export default function Checkout() {
  const { locale } = useTranslation();
  const teleport = useTeleport();
  if (locale === "de") throw new Error("this route reads the browser");
  const tapped = "productReference" in teleport ? teleport.productReference : undefined;
  return <main>{tapped === "monthly" ? "x".repeat(300 * 1024) : "Checkout"}</main>;
}
