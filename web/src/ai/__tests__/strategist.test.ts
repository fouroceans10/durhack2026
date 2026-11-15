import { describe, expect, it } from "vitest";
import {
  AIStrategist,
  DEFAULT_MODEL,
  listLocalModels,
  realizeApproachDegrees,
} from "../strategist";

describe("Local LLM Strategist & Ollama Integration", () => {
  it("lists installed local models from /api/local-llm/tags and excludes cloud aliases", async () => {
    const models = await listLocalModels(
      undefined,
      async () =>
        new Response(
          JSON.stringify({
            models: [
              { name: "qwen3:1.7b" },
              { name: "llama3.2:latest" },
              { name: "deepseek:cloud" },
              { name: "remote-proxy", remote_host: "https://example.com" },
            ],
          }),
          { status: 200 },
        ),
    );

    expect(models).toEqual(["qwen3:1.7b", "llama3.2:latest"]);
  });

  it("requests constrained JSON strategy via /api/local-llm/chat and updates BrainStatus to playing", async () => {
    const capturedBodies: Array<Record<string, unknown>> = [];
    const strategist = new AIStrategist({
      enabled: true,
      endpointUrl: "/api/local-llm",
      model: DEFAULT_MODEL,
      fetchImpl: async (_url, init) => {
        capturedBodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            message: {
              content: JSON.stringify({
                respondTo: "piano",
                approach: "counterpoint",
                gesture: "mordent",
                interval: 1,
                scaleDegrees: [0, 2, 4, 7, 5, 4, 2, 0],
                rhythmSteps: [0, 2, 4, 6, 8, 10, 12, 14],
                energyDelta: 0.1,
                tensionDelta: -0.05,
                rationale: "Counterpoint against piano with mordent turn.",
              }),
            },
          }),
          { status: 200 },
        );
      },
    });

    const suggestion = await strategist.requestSuggestion({
      role: "lead",
      partitionGroupId: "part:lead-piano",
      modeState: "partitioned",
      bpm: 112,
      keyRoot: "A",
      mode: "minor",
      energy: 0.6,
      tension: 0.5,
      barNumber: 8,
      hasDrumsInGroup: false,
      reachableRoles: ["piano", "lead"],
      neighbourMotifDegrees: [0, 2, 4, 5, 4, 2, 1, 0],
    });

    expect(suggestion.source).toBe("ai");
    expect(suggestion.approach).toBe("counterpoint");
    expect(suggestion.gesture).toBe("mordent");
    expect(capturedBodies[0].model).toBe("qwen3:1.7b");
    expect(capturedBodies[0].stream).toBe(false);
    expect(capturedBodies[0].think).toBe(false);

    const status = strategist.getStatus("lead");
    expect(status.phase).toBe("playing");
    expect(status.decisions).toBe(1);
    expect(status.approach).toBe("counterpoint");
    expect(status.detail).toContain("Counterpoint against piano");
  });

  it("realizeApproachDegrees produces distinct contrapuntal lines for echo, counterpoint, support, contrast, and develop", () => {
    const source = [0, 2, 4, 6, 5, 3, 2, 1];
    const own = [0, 1, 2, 3, 4, 5, 6, 0];

    const echo = realizeApproachDegrees(source, own, "echo", 0);
    const counterpoint = realizeApproachDegrees(source, own, "counterpoint", 0);
    const contrast = realizeApproachDegrees(source, own, "contrast", 0);

    expect(echo).not.toEqual(counterpoint);
    expect(counterpoint).not.toEqual(contrast);
    expect(echo).toHaveLength(8);
  });

  it("rejects cloud model aliases in setModel", () => {
    const strategist = new AIStrategist();
    expect(() => strategist.setModel("gpt-remote:cloud")).toThrow(/cloud/i);
  });
});
