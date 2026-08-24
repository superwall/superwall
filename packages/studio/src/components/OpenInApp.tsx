import * as React from "react";

const STORAGE_KEY = "superwall-device-scheme";

const readStored = (): string | undefined => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

const store = (value: string) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* private browsing */
  }
};

const linkFor = (scheme: string, origin: string): string =>
  `${scheme}://?superwall_dev=${encodeURIComponent(origin)}`;

export const OpenInApp = ({ origin, scheme }: { origin: string; scheme?: string }) => {
  const [typed, setTyped] = React.useState(readStored);
  const known = typed ?? scheme;

  const ask = (initial: string): string | undefined => {
    const answer = window.prompt("Your app's URL scheme, so this can open it:", initial);
    const trimmed = answer?.trim();
    if (trimmed === undefined || trimmed === "") return undefined;
    setTyped(trimmed);
    store(trimmed);
    return trimmed;
  };

  const open = (event: React.MouseEvent) => {
    if (known !== undefined) return;
    event.preventDefault();
    const answer = ask("");
    if (answer !== undefined) window.location.assign(linkFor(answer, origin));
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
        href={known === undefined ? "#" : linkFor(known, origin)}
        onClick={open}
      >
        Open In App
      </a>
    </div>
  );
};
