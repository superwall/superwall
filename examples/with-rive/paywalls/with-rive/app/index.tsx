import { useHaptics } from "superwall/hooks";
import { RiveArt } from "../components/RiveArt";
import smiley from "../assets/smiley-switch.riv";
import stars from "../assets/star-rating.riv";
import water from "../assets/water-bar.riv";

export default function Index() {
  const haptics = useHaptics();

  return (
    <main className="page">
      <div className="lede">
        <h1>Rive</h1>
        <p>Vector animation you can drive from the paywall.</p>
      </div>

      <RiveArt
        src={smiley}
        title="Switch"
        hint="Tap it"
        stateMachine="Remember Start SM"
        input="Toggle"
        control="tap"
        height={200}
        onChange={() => haptics.light()}
      />

      <RiveArt
        src={stars}
        title="Rating"
        hint="Tap a star"
        stateMachine="State Machine 1"
        control="self"
        height={150}
      />

      <RiveArt
        src={water}
        title="Level"
        hint="Drag to fill"
        stateMachine="State Machine"
        input="Level"
        control="slider"
        height={260}
        onChange={() => haptics.selection()}
      />

      <p className="note">
        Every file names its own state machine and inputs. Set an input and the animation follows —
        a purchase landing, a plan changing, anything you like.
      </p>
    </main>
  );
}
