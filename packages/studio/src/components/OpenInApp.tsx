import * as React from "react";
import { devServerLink, readScheme, storeScheme } from "../lib/scheme";

export const OpenInApp = ({ origin, scheme }: { origin: string; scheme?: string }) => {
  const [typed, setTyped] = React.useState(readScheme);
  const known = typed ?? scheme;

  const ask = (initial: string): string | undefined => {
    const answer = window.prompt("Your app's URL scheme, so this can open it:", initial);
    const trimmed = answer?.trim();
    if (trimmed === undefined || trimmed === "") return undefined;
    setTyped(trimmed);
    storeScheme(trimmed);
    return trimmed;
  };

  const open = (event: React.MouseEvent) => {
    if (known !== undefined) return;
    event.preventDefault();
    const answer = ask("");
    if (answer !== undefined) window.location.assign(devServerLink(answer, origin));
  };

  return (
    <div className="flex items-center gap-2">
      {known !== undefined && (
        <button
          className="sw-btn sw-btn--icon"
          type="button"
          aria-label="Edit app URL scheme"
          onClick={() => ask(known)}
        >
          <svg className="sw-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      )}
      <a
        className="sw-btn sw-btn--primary"
        href={known === undefined ? "#" : devServerLink(known, origin)}
        onClick={open}
      >
        Open In App
      </a>
    </div>
  );
};
