import { expect, it, vi } from "vitest";

// WGSLNodeBuilder imports Three's source modules. Keep graph objects in the
// same module registry rather than mixing source and bundled TSL instances.
vi.mock("three", () => import("three/src/Three.Core.js"));
vi.mock("three/webgpu", () => import("three/src/Three.WebGPU.js"));
vi.mock("three/tsl", () => import("three/src/nodes/TSL.js"));

import { Mesh, PerspectiveCamera, PlaneGeometry, Scene, Texture } from "three";
import { WebGPURenderer } from "three/webgpu";
import { texture } from "three/tsl";
import WGSLNodeBuilder from "three/src/renderers/webgpu/nodes/WGSLNodeBuilder.js";
import bluenoiseBits from "./BlueNoise.js";
import { N8AONode } from "./N8AONode.js";

it("generates WGSL with blue-noise texture dependencies only in blue-noise mode", () => {
  const beauty = new Texture();
  const depth = new Texture();
  const camera = new PerspectiveCamera();
  const scene = new Scene();
  const node = new N8AONode({
    beautyNode: texture(beauty), beautyTexture: beauty,
    depthNode: texture(depth), depthTexture: depth,
    camera, scene,
  });
  const renderer = new WebGPURenderer({
    canvas: {
      width: 5, height: 3, style: {},
      addEventListener() {}, removeEventListener() {},
      getContext() { return null; },
    } as any,
  });
  renderer.hasFeature = () => false;
  const state = node as any;

  try {
    for (const mode of ["blueNoise", "ign", "blueNoise"] as const) {
      node.configuration.noiseType = mode;
      for (const material of [state.aoMaterial, state.blurMaterial]) {
        const geometry = new PlaneGeometry();
        try {
          const builder = new WGSLNodeBuilder(new Mesh(geometry, material), renderer);
          builder.camera = camera;
          builder.scene = scene;
          builder.build();
          expect(builder.fragmentShader).toContain("@fragment");
          const usesBlueNoise = builder.nodes.some((entry: any) =>
            entry.isTextureNode && entry.value?.image?.data === bluenoiseBits,
          );
          expect(usesBlueNoise).toBe(mode === "blueNoise");
        } finally {
          geometry.dispose();
        }
      }
    }
  } finally {
    node.dispose();
    beauty.dispose();
    depth.dispose();
  }
});
