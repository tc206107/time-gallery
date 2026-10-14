import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createPostFX(renderer, scene, camera, options = {}) {
  const { ssao: withSSAO = true } = options;
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  if (withSSAO) {
    const ssao = new SSAOPass(scene, camera, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
    ssao.kernelRadius = 0.65;
    ssao.minDistance = 0.003;
    ssao.maxDistance = 0.09;
    composer.addPass(ssao);
  }

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(renderer.domElement.clientWidth, renderer.domElement.clientHeight),
    0.18,
    0.45,
    0.72,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return composer;
}
