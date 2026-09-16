import {
  AdditiveBlending,
  AmbientLight,
  CanvasTexture,
  Color,
  ConeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  Sprite,
  SpriteMaterial,
  TorusKnotGeometry,
  WebGLRenderer,
} from 'three';
import type { HoloConfig } from '../holo.config';
import { perspectiveScale } from '../scene/scene.math';
import type { SceneObject, SceneState } from '../scene/scene.types';

/** Palette. Kept here rather than in the engine — colour is a rendering concern. */
const COLOR = {
  orb: 0x35d6ff,
  orbOpen: 0x7ef0c0,
  card: 0x9fb6ff,
  prop: 0xc9a6ff,
  held: 0xffd166,
  hover: 0xffffff,
  selected: 0x7ef0c0,
  cursor: 0x35d6ff,
};

interface Tracked {
  group: Group;
  body: Mesh;
  halo: Sprite;
  label: Sprite;
  material: MeshStandardMaterial;
}

/**
 * Draws a SceneState with three.js. The only file in the subsystem that imports
 * three — everything above it works in plain world coordinates, so this can be
 * swapped for a 2D fallback without touching the interaction model.
 *
 * It owns no interaction state: give it a state, it paints it. That is what lets
 * the whole interaction layer be tested without a WebGL context. Effects are
 * read from config every frame, so switching them off takes effect immediately
 * and never changes what is interactable.
 */
export class ThreeSceneRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly world = new Group();
  private readonly tracked = new Map<string, Tracked>();
  private readonly cursor: Mesh;
  private readonly labelCache = new Map<string, CanvasTexture>();

  constructor(
    canvas: HTMLCanvasElement,
    private config: HoloConfig,
  ) {
    this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
    // The hand tracker already owns the GPU; a retina-density scene on top of it
    // is what pushes this box into thermal throttling. 1.5 is the visual plateau.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    this.camera = new PerspectiveCamera((config.scene.fov * 180) / Math.PI, 1, 0.1, 100);
    this.camera.position.set(0, 0, config.scene.focal);

    this.scene.add(this.world);
    this.scene.add(new AmbientLight(0x6fd8ff, 0.55));
    const key = new PointLight(0x9fe8ff, 90, 60);
    key.position.set(3, 4, 8);
    this.scene.add(key);

    this.cursor = new Mesh(
      new IcosahedronGeometry(0.09, 2),
      new MeshBasicMaterial({ color: COLOR.cursor, transparent: true, opacity: 0.9 }),
    );
    this.scene.add(this.cursor);

    this.resize();
  }

  configure(config: HoloConfig): void {
    this.config = config;
  }

  /** Canvas buffers are not CSS-sized; without this the scene renders at 300×150. */
  resize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = height === 0 ? 1 : width / height;
    this.camera.updateProjectionMatrix();
  }

  render(state: SceneState): void {
    this.syncObjects(state);

    this.world.scale.setScalar(state.camera.zoom);
    this.world.position.set(
      state.camera.pan.x * state.camera.zoom,
      state.camera.pan.y * state.camera.zoom,
      0,
    );
    this.world.rotation.z = state.camera.rotation;

    if (state.cursor) {
      this.cursor.visible = true;
      this.cursor.position.set(state.cursor.x, state.cursor.y, state.cursor.z);
      // Counter-scale so the cursor stays a constant size on screen while zoomed.
      this.cursor.scale.setScalar(1 / state.camera.zoom);
    } else {
      this.cursor.visible = false;
    }

    this.renderer.render(this.scene, this.camera);
  }

  /** Frees GPU resources. A route change without this leaks the context, and
   *  browsers hand out a small fixed number of them. */
  dispose(): void {
    for (const entry of this.tracked.values()) {
      this.world.remove(entry.group);
      entry.body.geometry.dispose();
      entry.material.dispose();
      // Sprites carry their own material per object; only the label's texture is
      // shared, and that is disposed once from the cache below.
      (entry.halo.material as SpriteMaterial).dispose();
      (entry.label.material as SpriteMaterial).dispose();
    }
    this.tracked.clear();
    for (const texture of this.labelCache.values()) {
      texture.dispose();
    }
    this.labelCache.clear();
    this.cursor.geometry.dispose();
    (this.cursor.material as MeshBasicMaterial).dispose();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------------ objects

  private syncObjects(state: SceneState): void {
    const live = new Set<string>();

    for (const object of state.objects) {
      if (!object.visible) {
        continue;
      }
      live.add(object.id);
      const entry = this.tracked.get(object.id) ?? this.create(object);
      this.paint(entry, object, state);
    }

    // Cards folded back into a closed orb stop being drawn, but keep their meshes:
    // rebuilding geometry every open/close is what makes a deck stutter.
    for (const [id, entry] of this.tracked) {
      entry.group.visible = live.has(id);
    }
  }

  /**
   * Props are procedural on purpose. The backend advertises .glb props, but no
   * model files ship with this repo, so loading them would mean a permanently
   * broken fetch. Generated geometry gives the same grab/throw/spin behaviour
   * with nothing to download.
   */
  private geometryFor(object: SceneObject): Mesh['geometry'] {
    switch (object.kind) {
      case 'orb':
        return new IcosahedronGeometry(object.radius, 3);
      case 'prop':
        return object.id.endsWith('relic')
          ? new ConeGeometry(object.radius * 0.8, object.radius * 2, 6)
          : new TorusKnotGeometry(object.radius * 0.62, object.radius * 0.2, 96, 12);
      default:
        return new PlaneGeometry(object.radius * 2.1, object.radius * 1.45);
    }
  }

  private baseColor(object: SceneObject): number {
    if (object.kind === 'prop') {
      return COLOR.prop;
    }
    if (object.kind === 'orb') {
      return object.open ? COLOR.orbOpen : COLOR.orb;
    }
    return COLOR.card;
  }

  private create(object: SceneObject): Tracked {
    const group = new Group();
    const base = this.baseColor(object);

    const material = new MeshStandardMaterial({
      color: base,
      emissive: new Color(base),
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.86,
      roughness: 0.25,
      metalness: 0.1,
    });

    const body = new Mesh(this.geometryFor(object), material);

    const halo = new Sprite(
      new SpriteMaterial({
        color: base,
        transparent: true,
        opacity: 0.18,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.scale.setScalar(object.radius * 4);

    const label = new Sprite(
      new SpriteMaterial({ map: this.labelTexture(object.label), transparent: true, depthWrite: false }),
    );
    label.scale.set(object.radius * 3.2, object.radius * 0.8, 1);
    label.position.y = -object.radius * 1.55;

    group.add(halo, body, label);
    this.world.add(group);

    const entry: Tracked = { group, body, halo, label, material };
    this.tracked.set(object.id, entry);
    return entry;
  }

  private paint(entry: Tracked, object: SceneObject, state: SceneState): void {
    entry.group.position.set(object.position.x, object.position.y, object.position.z);
    entry.group.scale.setScalar(object.scale);

    const effects = this.config.effects;
    const focused = state.focusId === object.id;
    const hovered = state.hoverId === object.id;
    const selected = state.selectedId === object.id;

    const colour = object.heldBy
      ? COLOR.held
      : hovered
        ? COLOR.hover
        : selected
          ? COLOR.selected
          : this.baseColor(object);

    entry.material.color.setHex(colour);
    entry.material.emissive.setHex(colour);

    if (effects.effectsEnabled) {
      const glow = Math.min(Math.max(effects.glowIntensity, 0), 1);
      entry.material.emissiveIntensity = (object.heldBy ? 1.2 : hovered || selected ? 0.9 : 0.45) * glow;
      (entry.halo.material as SpriteMaterial).opacity =
        (object.heldBy || hovered ? 0.34 : 0.16) * glow;
      entry.halo.visible = true;
    } else {
      // Flat mode still distinguishes every interaction state by colour alone.
      entry.material.emissiveIntensity = 0.2;
      entry.halo.visible = false;
    }
    (entry.halo.material as SpriteMaterial).color.setHex(colour);
    entry.material.opacity = focused ? 1 : 0.86;

    // Cards face the camera; a spinning sheet of text is unreadable. Props and
    // orbs keep whatever spin a flick gave them.
    if (object.kind === 'card') {
      entry.body.lookAt(0, 0, this.config.scene.focal);
    } else {
      entry.body.rotation.z = object.rotation;
      entry.body.rotation.y = object.rotation * 0.6;
    }

    // Fade with depth, using the same projection the hit test picks with.
    const depth = perspectiveScale(object.position.z, this.config.scene.focal);
    entry.material.opacity *= Math.min(1, 0.55 + depth * 0.35);
  }

  /** Text as a texture — three has no text primitive, and a full font loader is
   *  far more weight than a label on an orb justifies. */
  private labelTexture(text: string): CanvasTexture {
    const cached = this.labelCache.get(text);
    if (cached) {
      return cached;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = '600 56px system-ui, sans-serif';
      ctx.fillStyle = '#dff6ff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.75)';
      ctx.shadowBlur = 10;
      const clipped = text.length > 22 ? `${text.slice(0, 21)}…` : text;
      ctx.fillText(clipped, canvas.width / 2, canvas.height / 2);
    }
    const texture = new CanvasTexture(canvas);
    this.labelCache.set(text, texture);
    return texture;
  }
}
