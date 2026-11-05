import type { Theme } from "@superwall/workspace-sdk/bridge";
import { connect } from "@superwall/workspace-sdk/client";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// The dashboard sends its theme and this page's context over the bridge.
const applyTheme = ({ tokens }: Theme) => {
  for (const [name, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(`--${name}`, value);
  }
};

type Projects = ReadonlyArray<{ name: string }> | "loading" | "failed";

const Home = () => {
  const [projects, setProjects] = useState<Projects>("loading");

  useEffect(() => {
    void connect().then((bridge) => {
      applyTheme(bridge.theme);
      bridge.onTheme(applyTheme);
    });
    void fetch("/api/projects")
      .then(async (response) => {
        if (!response.ok) throw new Error(`The API answered ${response.status}.`);
        return ((await response.json()) as { data: ReadonlyArray<{ name: string }> }).data;
      })
      .then(setProjects, () => setProjects("failed"));
  }, []);

  return (
    <main>
      <h1>My workspace</h1>
      <p>Edit src/client.tsx to change this page. Your projects:</p>
      {projects === "loading" && <p>Loading…</p>}
      {projects === "failed" && <p>Your projects didn't load.</p>}
      {typeof projects === "object" && (
        <ul>
          {projects.length === 0 && <li>None you can see.</li>}
          {projects.map((project) => (
            <li key={project.name}>{project.name}</li>
          ))}
        </ul>
      )}
    </main>
  );
};

createRoot(document.getElementById("root")!).render(<Home />);
