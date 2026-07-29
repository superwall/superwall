import clip from "../../assets/clip.mp4";
import tiny from "../../assets/tiny.mp4";

export default function OfferPage() {
  return (
    <>
      <video src={clip} muted playsInline />
      <video src={tiny} muted playsInline />
    </>
  );
}
