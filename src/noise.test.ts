import { afterEach, describe, expect, it, vi } from "vitest";
import { Color, PerspectiveCamera, Scene, Texture } from "three";
import { QuadMesh } from "three/webgpu";
import { texture } from "three/tsl";
import { N8AONode } from "./N8AONode.js";

vi.mock("three/webgpu", async (importOriginal) => {
  const original = await importOriginal<typeof import("three/webgpu")>();
  return {
    ...original,
    RendererUtils: {
      ...original.RendererUtils,
      resetRendererState: vi.fn(() => ({})),
      restoreRendererState: vi.fn(),
    },
  };
});

function createNode() {
  const beauty = new Texture();
  const depth = new Texture();
  return new N8AONode({
    beautyNode: texture(beauty), beautyTexture: beauty,
    depthNode: texture(depth), depthTexture: depth,
    scene: new Scene(), camera: new PerspectiveCamera(),
  });
}

function render(node: N8AONode) {
  const passes: string[] = [];
  const clear = vi.fn();
  vi.spyOn(QuadMesh.prototype, "render").mockImplementation(function () {
    passes.push(this.name);
  });
  const renderer = {
    getDrawingBufferSize: (size: any) => size.set(5, 3),
    getRenderTarget: () => null, setRenderTarget: vi.fn(),
    getClearColor: (color: Color) => color.set(0), getClearAlpha: () => 1,
    setClearColor: vi.fn(), clear, xr: { enabled: false },
  };
  node.updateBefore({ renderer });
  return { passes, clear };
}

afterEach(() => vi.restoreAllMocks());

describe("noise selection", () => {
  it("defaults to blue noise and rebuilds both passes when switched", () => {
    const node = createNode();
    const state = node as any;
    expect(node.configuration.noiseType).toBe("blueNoise");
    const originalTexture = state.blueNoiseTexture;
    const disposed = vi.spyOn(originalTexture, "dispose");
    render(node);
    const ao = state.aoMaterial.fragmentNode;
    const blur = state.blurMaterial.fragmentNode;
    node.configuration.noiseType = "ign";
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(state.blueNoiseTexture).toBeNull();
    expect(state.blueNoiseNode).toBeNull();
    expect(state.aoMaterial.fragmentNode).not.toBe(ao);
    expect(state.blurMaterial.fragmentNode).not.toBe(blur);
    render(node);
    const ignAo = state.aoMaterial.fragmentNode;
    const ignBlur = state.blurMaterial.fragmentNode;
    node.configuration.noiseType = "ign";
    expect(state.aoMaterial.fragmentNode).toBe(ignAo);
    expect(state.blurMaterial.fragmentNode).toBe(ignBlur);
    expect(state.blueNoiseTexture).toBeNull();
    node.configuration.noiseType = "blueNoise";
    expect(state.blueNoiseTexture).not.toBe(originalTexture);
    expect(state.blueNoiseTexture.image.width).toBe(128);
    render(node);
    expect(state.blueNoiseTexture).not.toBeNull();
    const nextDisposed = vi.spyOn(state.blueNoiseTexture, "dispose");
    node.dispose();
    expect(nextDisposed).toHaveBeenCalledTimes(1);
    expect(state.blueNoiseTexture).toBeNull();
  });

  it("rejects invalid modes without changing configuration or resources", () => {
    const node = createNode();
    const state = node as any;
    const originalTexture = state.blueNoiseTexture;
    const ao = state.aoMaterial.fragmentNode;
    const blur = state.blurMaterial.fragmentNode;
    const historyReset = state.needsFrame;
    expect(() => { (node.configuration as any).noiseType = "invalid"; })
      .toThrow(/noiseType/);
    expect(node.configuration.noiseType).toBe("blueNoise");
    expect(state.blueNoiseTexture).toBe(originalTexture);
    expect(state.aoMaterial.fragmentNode).toBe(ao);
    expect(state.blurMaterial.fragmentNode).toBe(blur);
    expect(state.needsFrame).toBe(historyReset);
    node.dispose();
  });

  it.each(["blueNoise", "ign"] as const)("preserves disabled accumulation and odd half-res dimensions with %s", (mode) => {
    const node = createNode();
    node.configuration.noiseType = mode;
    node.configuration.halfRes = true;
    const result = render(node);
    expect(result.passes).toEqual(["N8AO.Downsample", "N8AO.AO", "N8AO.Blur", "N8AO.Blur", "N8AO.Composite"]);
    expect(result.clear).not.toHaveBeenCalled();
    expect((node as any).resolutionNode.value.toArray()).toEqual([2, 1]);
    expect((node as any).frameNode.value).toBe(0);
    node.dispose();
  });

  it("resets accumulated history after changing the noise source", () => {
    const node = createNode();
    node.configuration.accumulate = true;
    render(node);
    render(node);
    expect((node as any).frameNode.value).toBe(1);
    node.configuration.noiseType = "ign";
    const result = render(node);
    expect((node as any).frameNode.value).toBe(0);
    expect(result.clear).toHaveBeenCalledTimes(2);
    expect(result.passes).toContain("N8AO.Accumulation");
    render(node);
    expect((node as any).frameNode.value).toBe(1);
    node.configuration.noiseType = "blueNoise";
    expect(render(node).clear).toHaveBeenCalledTimes(2);
    expect((node as any).frameNode.value).toBe(0);
    node.dispose();
  });

  it.each(["blueNoise", "ign"] as const)("preserves the temporal frame sequence for %s", (mode) => {
    const node = createNode();
    node.configuration.noiseType = mode;
    node.configuration.aoSamples = 8;
    node.configuration.accumulate = true;
    for (let frame = 0; frame <= 65; frame += 1) render(node);
    expect((node as any).frameNode.value).toBe(mode === "ign" ? 1 : 65);
    node.dispose();
  });
});
