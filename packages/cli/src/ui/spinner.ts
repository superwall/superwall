import { ui } from "./index";

export async function withSpinner<T>(label: string, work: () => Promise<T>): Promise<T> {
  const spin = ui.spinner();
  spin.start(label);
  try {
    const result = await work();
    spin.stop(label);
    return result;
  } catch (e) {
    spin.stop("Failed");
    throw e;
  }
}
