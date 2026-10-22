import type { PropsWithChildren } from "react";
import type { Entry } from "superwall/navigation";

export const entry: Entry = ({ params }) => (params.resume === "no" ? "index" : ["index", "goal"]);

export default function Layout({ children }: PropsWithChildren) {
  return <div className="resume-shell">{children}</div>;
}
