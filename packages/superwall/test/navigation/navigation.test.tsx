import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Link, PaywallRouter, useRouter, type PaywallRoute } from "../../src/navigation/index";

const Home = () => {
  const { path, canGoBack } = useRouter();
  return (
    <div>
      <span>home page</span>
      <span data-testid="path">{path}</span>
      <span data-testid="can-go-back">{String(canGoBack)}</span>
      <Link href="offer">Go to offer</Link>
      <Link href="/terms" replace>
        Replace with terms
      </Link>
    </div>
  );
};

const Offer = () => {
  const { back } = useRouter();
  return (
    <div>
      <span>offer page</span>
      <button type="button" onClick={back}>
        Back
      </button>
    </div>
  );
};

const Terms = () => <span>terms page</span>;

const routes: PaywallRoute[] = [
  { path: "/", Component: Home },
  { path: "/offer", Component: Offer },
  { path: "/terms", Component: Terms },
];

describe("PaywallRouter", () => {
  it("mounts the initial route and navigates push/back with a history stack", () => {
    const onNavigate = vi.fn();
    render(<PaywallRouter routes={routes} onNavigate={onNavigate} />);

    expect(screen.getByText("home page")).toBeDefined();
    expect(screen.getByTestId("can-go-back").textContent).toBe("false");
    expect(onNavigate).toHaveBeenLastCalledWith("/");

    // Link normalizes "offer" → "/offer".
    fireEvent.click(screen.getByText("Go to offer"));
    expect(screen.getByText("offer page")).toBeDefined();
    expect(onNavigate).toHaveBeenLastCalledWith("/offer");

    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText("home page")).toBeDefined();
    expect(screen.getByTestId("can-go-back").textContent).toBe("false");
  });

  it("replace swaps the current entry instead of stacking", () => {
    render(<PaywallRouter routes={routes} />);

    fireEvent.click(screen.getByText("Replace with terms"));
    expect(screen.getByText("terms page")).toBeDefined();
    // Replaced "/" — there is nothing to go back to, so back is a no-op and
    // the terms page stays (it has no back affordance to assert against).
  });

  it("falls back to the first route for unknown paths and honors initialPath", () => {
    render(<PaywallRouter routes={routes} initialPath="/offer/" />);
    // Trailing slash normalizes away.
    expect(screen.getByText("offer page")).toBeDefined();

    render(<PaywallRouter routes={routes} initialPath="/nope" />);
    expect(screen.getByText("home page")).toBeDefined();
  });

  it("renders nothing without routes and wraps pages in the Layout", () => {
    const { container } = render(<PaywallRouter routes={[]} />);
    expect(container.innerHTML).toBe("");

    render(
      <PaywallRouter
        routes={routes}
        Layout={({ children }) => <section data-testid="layout">{children}</section>}
      />,
    );
    expect(screen.getByTestId("layout").textContent).toContain("home page");
  });

  it("useRouter throws outside a mounted paywall", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useRouter())).toThrow(/inside a paywall/);
    } finally {
      consoleError.mockRestore();
    }
  });
});
