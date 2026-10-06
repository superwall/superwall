import * as React from "react";
import { PencilIcon } from "./icons";
import { Tooltip } from "./Tooltip";
import { devServerLink, readScheme, storeScheme } from "../lib/scheme";

export const OpenInApp = ({ origin, scheme }: { origin: string; scheme?: string }) => {
  const [typed, setTyped] = React.useState(readScheme);
  const known = typed ?? scheme;

  const ask = (initial: string): string | undefined => {
    const answer = window.prompt("Your app’s URL scheme, so this can open it:", initial);
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
        <Tooltip hint="Edit app URL scheme">
          <button
            className="sw-btn sw-btn--sm sw-btn--icon sw-btn--ghost"
            type="button"
            aria-label="Edit app URL scheme"
            onClick={() => ask(known)}
          >
            <PencilIcon />
          </button>
        </Tooltip>
      )}
      <a
        className="sw-btn sw-btn--sm sw-btn--primary"
        href={known === undefined ? "#" : devServerLink(known, origin)}
        onClick={open}
      >
        Open in app
      </a>
    </div>
  );
};
