import type { PropsWithChildren } from "react";

export default function Layout({ children }: PropsWithChildren) {
  return <div className="demo-shell">{children}</div>;
}
