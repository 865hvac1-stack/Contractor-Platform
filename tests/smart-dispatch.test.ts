import { describe, expect, it } from "vitest";
import { locationConfidenceWeight, locationFreshness, locationFreshnessLabel } from "@/lib/maps/freshness";
import { mapsBrowserKey, mapsServerKey } from "@/lib/maps/keys";
import {
  combineScore,
  driveTimeScore,
  historicalPerformanceScore,
  routeImpactScore,
  scheduleFitScore,
  skillFitScore,
} from "@/lib/smart-dispatch/score";
import { DEFAULT_DISPATCH_WEIGHTS } from "@/lib/smart-dispatch/policy";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

describe("location freshness", () => {
  const now = new Date("2026-09-15T18:00:00Z");
  it("labels live, recent, stale, and unavailable without inventing GPS", () => {
    expect(locationFreshness(new Date(now.getTime() - 30_000), now)).toBe("LIVE");
    expect(locationFreshness(new Date(now.getTime() - 4 * 60_000), now)).toBe("RECENT");
    expect(locationFreshness(new Date(now.getTime() - 24 * 60_000), now)).toBe("STALE");
    expect(locationFreshness(new Date(now.getTime() - 2 * 60 * 60_000), now)).toBe("UNAVAILABLE");
    expect(locationFreshness(null, now)).toBe("UNAVAILABLE");
    expect(locationConfidenceWeight("STALE")).toBeLessThan(locationConfidenceWeight("LIVE"));
    expect(locationFreshnessLabel({ freshness: "LIVE", capturedAt: new Date(now.getTime() - 32_000), now })).toContain("Live");
    expect(locationFreshnessLabel({ freshness: "RECENT", capturedAt: now, source: "CURRENT_JOB", now })).toContain("current job");
  });
});

describe("Smart Match scoring", () => {
  it("does not let closest drive time beat a healthier route and stronger no-cool fit", () => {
    const johnny = combineScore(
      {
        skillFit: skillFitScore(5),
        historicalPerformance: historicalPerformanceScore({
          firstTimeCompletionRate: 91,
          callbackRate: 3.2,
          completedJobs: 92,
          confidence: "HIGH",
        }),
        familiarity: 40,
        driveTime: driveTimeScore(11 * 60, 1),
        routeImpact: routeImpactScore(-5),
        scheduleFit: scheduleFitScore({ canMakeWindow: true, jeopardizesNext: false, conflict: false }),
        workload: 70,
        partsReadiness: 70,
      },
      DEFAULT_DISPATCH_WEIGHTS,
      "HIGH"
    );
    const jr = combineScore(
      {
        skillFit: skillFitScore(4),
        historicalPerformance: historicalPerformanceScore({
          firstTimeCompletionRate: 82,
          callbackRate: 6,
          completedJobs: 40,
          confidence: "MEDIUM",
        }),
        familiarity: 10,
        driveTime: driveTimeScore(7 * 60, 1),
        routeImpact: routeImpactScore(31),
        scheduleFit: scheduleFitScore({ canMakeWindow: true, jeopardizesNext: true, conflict: false }),
        workload: 80,
        partsReadiness: 70,
      },
      DEFAULT_DISPATCH_WEIGHTS,
      "MEDIUM"
    );
    const travis = combineScore(
      {
        skillFit: skillFitScore(3),
        historicalPerformance: historicalPerformanceScore({
          firstTimeCompletionRate: 70,
          callbackRate: 9,
          completedJobs: 20,
          confidence: "MEDIUM",
        }),
        familiarity: null,
        driveTime: driveTimeScore(18 * 60, 1),
        routeImpact: routeImpactScore(4),
        scheduleFit: scheduleFitScore({ canMakeWindow: true, jeopardizesNext: false, conflict: false }),
        workload: 75,
        partsReadiness: 70,
      },
      DEFAULT_DISPATCH_WEIGHTS,
      "MEDIUM"
    );
    expect(johnny.total).toBeGreaterThan(jr.total);
    expect(johnny.total).toBeGreaterThan(travis.total);
    expect(jr.components.scheduleFit).toBeLessThan(johnny.components.scheduleFit ?? 100);
  });

  it("damps tiny samples so they cannot look like 94.7632% certainty", () => {
    const low = historicalPerformanceScore({
      firstTimeCompletionRate: 100,
      callbackRate: 0,
      completedJobs: 2,
      confidence: "INSUFFICIENT",
    });
    const high = historicalPerformanceScore({
      firstTimeCompletionRate: 91,
      callbackRate: 3,
      completedJobs: 148,
      confidence: "HIGH",
    });
    expect(low).not.toBeNull();
    expect(high).not.toBeNull();
    expect(low!).toBeLessThan(high!);
  });
});

describe("maps keys", () => {
  it("never treats the browser key helper as a server-key source", () => {
    const previousServer = process.env.GOOGLE_MAPS_SERVER_API_KEY;
    const previousBrowser = process.env.GOOGLE_MAPS_BROWSER_API_KEY;
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "server-secret-key";
    process.env.GOOGLE_MAPS_BROWSER_API_KEY = "browser-public-key";
    expect(mapsServerKey()).toBe("server-secret-key");
    expect(mapsBrowserKey()).toBe("browser-public-key");
    expect(mapsBrowserKey()).not.toBe(mapsServerKey());
    if (previousServer) process.env.GOOGLE_MAPS_SERVER_API_KEY = previousServer;
    else delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
    if (previousBrowser) process.env.GOOGLE_MAPS_BROWSER_API_KEY = previousBrowser;
    else delete process.env.GOOGLE_MAPS_BROWSER_API_KEY;
  });

  it("does not reference the server key from client components", () => {
    const root = join(process.cwd(), "src/components");
    const files: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".tsx") || path.endsWith(".ts")) files.push(path);
      }
    }
    if (existsSync(root)) walk(root);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text.includes("GOOGLE_MAPS_SERVER_API_KEY")).toBe(false);
    }
  });
});
