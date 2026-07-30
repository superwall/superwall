import { useRouter } from "superwall/navigation";
import hero from "../assets/hero.png";
import spark from "../assets/spark.svg";
import spinner from "../assets/spinner.lottie";
import rive from "../assets/hero.riv";
import "../styles.css";

export default function Index() {
  const router = useRouter();
  return (
    <main>
      <img src={hero} alt="" width={120} height={120} />
      <img src={spark} alt="" width={8} height={8} />
      <div data-lottie={spinner} data-rive={rive} />
      <button type="button" onClick={() => router.push("offer")}>
        See the offer
      </button>
    </main>
  );
}
