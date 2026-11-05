import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkMetricQuery,
  parseFilters,
  readoutProblem,
  seriesProblem,
  summarizeSeries,
} from "@/core/workspaces/series";
import { METRIC_LIMITS, READOUT_LIMITS } from "@/core/workspaces/wire";

const t = "2026-10-01T00:00:00Z";

test("a good series has no problem", () => {
  assert.equal(seriesProblem({ points: [{ t, value: 1 }, { t, value: 2, breakdown: "a" }, { t, value: 0, breakdown: null }] }), undefined);
});

test("each way a series can be wrong says so", () => {
  assert.match(seriesProblem(null)!, /must return/);
  assert.match(seriesProblem({ points: [{ t: "2026-10-01", value: 1 }] })!, /ISO 8601/);
  assert.match(seriesProblem({ points: [{ value: 1 }] })!, /ISO 8601/);
  assert.match(seriesProblem({ points: [{ t, value: "1" }] })!, /finite number/);
  assert.match(seriesProblem({ points: [{ t, value: Number.NaN }] })!, /finite number/);
  assert.match(seriesProblem({ points: [{ t, value: 1, breakdown: "" }] })!, /1 to 128/);
  const many = (count: number, breakdown: (index: number) => string | undefined) => ({
    points: Array.from({ length: count }, (_, index) => ({ t, value: 1, breakdown: breakdown(index) })),
  });
  assert.match(seriesProblem(many(METRIC_LIMITS.maxPoints + 1, () => undefined))!, /5001 points/);
  assert.match(seriesProblem(many(51, (index) => `b${index}`))!, /51 breakdown values/);
  assert.match(seriesProblem({ points: [{ t, value: 1, breakdown: "x" }], padding: "y".repeat(METRIC_LIMITS.maxBytes) })!, /bytes/);
});

test("readouts: each variant once, in the audience, with an interval that holds the value", () => {
  assert.equal(readoutProblem({ variants: [{ variantId: 1, value: 2, interval: [1, 3] }, { variantId: 2, value: null }] }, [1, 2]), undefined);
  assert.equal(readoutProblem({ variants: [{ variantId: 9, value: 1 }] }, []), undefined);
  assert.match(readoutProblem({}, [])!, /must return/);
  assert.match(readoutProblem({ variants: [{ value: 2 }] }, [])!, /variantId/);
  assert.match(readoutProblem({ variants: [{ variantId: 1.5, value: 2 }] }, [])!, /variantId/);
  assert.match(readoutProblem({ variants: [null] }, [])!, /variantId/);
  for (const interval of ["13", ["1", "3"], null, [1], [1, 2, 3], [Number.NaN, 3]]) {
    assert.match(readoutProblem({ variants: [{ variantId: 1, value: 2, interval }] }, [])!, /isn't two finite numbers/, String(interval));
  }
  assert.match(readoutProblem({ variants: [{ variantId: 1, value: 1 }, { variantId: 1, value: 2 }] }, [1])!, /appears twice/);
  assert.match(readoutProblem({ variants: [{ variantId: 3, value: 1 }] }, [1])!, /isn't one of/);
  assert.match(readoutProblem({ variants: [{ variantId: 1, value: "1" }] }, [1])!, /finite/);
  assert.match(readoutProblem({ variants: [{ variantId: 1, value: 9, interval: [1, 3] }] }, [1])!, /doesn't hold/);
  assert.match(readoutProblem({ variants: [{ variantId: 1, value: null, interval: [1, 3] }] }, [1])!, /doesn't hold/);
  assert.match(readoutProblem({ variants: [], padding: "y".repeat(READOUT_LIMITS.maxBytes) }, [])!, /bytes/);
});

test("only what the metric declares can be asked for", () => {
  const metric = {
    breakdowns: [{ key: "store", name: "Store" }],
    filters: [{ key: "store", name: "Store", values: [{ value: "A", label: "A" }] }],
  };
  checkMetricQuery(metric, { breakdown: "store", filters: { store: ["A"] } });
  checkMetricQuery(undefined, {});
  checkMetricQuery(metric, { breakdown: null });
  assert.throws(() => checkMetricQuery(metric, { breakdown: "plan" }), /`plan` is not a breakdown/);
  assert.throws(() => checkMetricQuery(undefined, { breakdown: "plan" }), /`plan` is not a breakdown/);
  assert.throws(() => checkMetricQuery(metric, { filters: { store: ["B"] } }), /`store` has a filter or value/);
  assert.throws(() => checkMetricQuery(metric, { filters: { plan: ["A"] } }), /`plan` has a filter or value/);
  assert.throws(() => checkMetricQuery(undefined, { filters: { plan: ["A"] } }), /`plan` has a filter or value/);
});

test("--filter gathers repeated keys and refuses anything else", () => {
  assert.deepEqual({ ...parseFilters(["a=1", "a=2", "b=x=y"]) }, { a: ["1", "2"], b: ["x=y"] });
  for (const key of ["constructor", "toString", "__proto__"]) {
    const filters = parseFilters([`${key}=A`, `${key}=B`]);
    assert.deepEqual(filters[key], ["A", "B"], key);
    assert.deepEqual(JSON.parse(JSON.stringify(filters))[key], ["A", "B"], key);
  }
  for (const bad of ["a", "=1", "a="]) assert.throws(() => parseFilters([bad]), /takes key=value/);
});

test("a summary has one row per series, with its latest point by time", () => {
  assert.deepEqual(
    summarizeSeries({
      points: [
        { t: "2026-10-02T01:00:00+02:00", value: 2, breakdown: "a" },
        { t: "2026-10-02T00:00:00Z", value: 1, breakdown: "a" },
        { t, value: 5 },
      ],
    }),
    [
      { name: "a", breakdown: "a", points: 2, sum: 3, lastAt: "2026-10-02T00:00:00Z", last: 1 },
      { name: "All", breakdown: null, points: 1, sum: 5, lastAt: t, last: 5 },
    ],
  );
});

test("a breakdown named All stays apart from the series with none", () => {
  const rows = summarizeSeries({ points: [{ t, value: 1 }, { t, value: 2, breakdown: "All" }, { t, value: 3, breakdown: null }] });
  assert.deepEqual(rows.map((row) => [row.breakdown, row.sum]), [[null, 4], ["All", 2]]);
});
