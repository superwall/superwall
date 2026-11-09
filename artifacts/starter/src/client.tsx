import type { Theme } from "@superwall/artifact-sdk/bridge";
import { connect } from "@superwall/artifact-sdk/client";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// The dashboard sends its theme and this page's context over the bridge.
const applyTheme = ({ tokens }: Theme) => {
  for (const [name, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(`--${name}`, value);
  }
};

type Projects = ReadonlyArray<{ name: string }>;

// The API says why it refused, so show that. A 403 usually means a scope superwall.json doesn't declare,
// or a route this slot can't reach.
const readProjects = async (response: Response): Promise<Projects> => {
  const body = (await response.json().catch(() => null)) as {
    data?: Projects;
    message?: string;
  } | null;
  if (response.ok && body?.data) return body.data;
  throw new Error(body?.message ?? `The API answered ${response.status}.`);
};

const Home = () => {
  const [projects, setProjects] = useState<Projects | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    void connect().then((bridge) => {
      applyTheme(bridge.theme);
      bridge.onTheme(applyTheme);
    });
    void fetch("/api/projects")
      .then(readProjects)
      .then(setProjects, (error: Error) => setFailure(error.message));
  }, []);

  return (
    <main>
      <h1>My artifact</h1>
      <p>Edit src/client.tsx to change this page. Your projects:</p>
      {failure !== null && <p role="alert">Your projects didn't load: {failure}</p>}
      {failure === null && projects === null && <p>Loading…</p>}
      {projects !== null && (
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
