import type { RouteName } from "./index";

export const REPLAY_LIMIT = 100;

let entering: ReadonlySet<string> | undefined;

export const whileEntering = <T>(routes: Iterable<string>, run: () => T): T => {
  const outer = entering;
  entering = new Set(routes);
  try {
    return run();
  } finally {
    entering = outer;
  }
};

const isKnown = (name: string): name is RouteName => entering?.has(name) ?? true;

const stepTo = (
  to: unknown,
  stack: readonly RouteName[],
): { route: RouteName } | { refused: string } => {
  if (typeof to !== "string" || to === "") {
    return { refused: `returned ${JSON.stringify(to)}, not a route` };
  }
  if (!isKnown(to)) return { refused: `returned "${to}", which this surface does not have` };
  if (stack.includes(to)) return { refused: `returned "${to}" again, which would loop forever` };
  if (stack.length >= REPLAY_LIMIT) return { refused: `went past ${REPLAY_LIMIT} routes` };
  return { route: to };
};

/**
 * Replays a flow from `start`, the way the user tapped through it: each
 * answered route is followed by the one `next` says comes after it, until a
 * route is not answered yet or the flow ends. Returns the stack, bottom to
 * top, for `entry` to open on — the first unanswered route on top.
 *
 * Pass the same `next` the pages navigate with, so a branching flow resumes
 * down the branch the user actually took. It never loops: a route `next`
 * returns twice, an empty or non-string name, a name the surface does not
 * have (checked when called from `entry`), or a stack longer than
 * 100 routes ends the replay where it is, with a console warning.
 *
 * ```ts
 * export const entry: Entry = ({ user }) =>
 *   replayStack("index", (route) => next(route, user), (route) => answered(route, user));
 * ```
 *
 * @param start The route the flow begins on, always the bottom of the stack.
 * @param next The route after `route`, or `undefined` where the flow ends.
 * @param answered Whether the user has already given what `route` asks for.
 */
export const replayStack = (
  start: RouteName,
  next: (route: RouteName) => RouteName | undefined,
  answered: (route: RouteName) => boolean,
): RouteName[] => {
  const stack: RouteName[] = [start];
  let current = start;
  while (answered(current)) {
    const following: unknown = next(current);
    if (following === undefined) break;
    const step = stepTo(following, stack);
    if ("refused" in step) {
      console.warn(
        `replayStack() stopped at "${current}": next("${current}") ${step.refused}. The flow resumes there.`,
      );
      break;
    }
    current = step.route;
    stack.push(current);
  }
  return stack;
};
