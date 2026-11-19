import { useEffect, useRef, useState } from "react";
import {
  Box3,
  DirectionalLight,
  HemisphereLight,
  Line,
  LoadingManager,
  type Material,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Points,
  Scene,
  Sphere,
  Texture,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

function disposeModel(model: Object3D) {
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  model.traverse((node) => {
    if (!(node instanceof Mesh || node instanceof Line || node instanceof Points)) return;
    node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof Texture) textures.add(value);
    }
  });
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    if (texture.image instanceof ImageBitmap) texture.image.close();
    texture.dispose();
  }
}

export default function PropModelPreview({ url }: { url: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const element = canvas.current!;
    const abort = new AbortController();
    let renderer: WebGLRenderer | undefined;
    const scene = new Scene();
    const camera = new PerspectiveCamera(40);
    const controls = new OrbitControls(camera, element);
    controls.enablePan = false;
    scene.add(new HemisphereLight(0xffffff, 0x68615a, 2));
    const key = new DirectionalLight(0xffffff, 2);
    key.position.set(3, 5, 4);
    scene.add(key);
    let model: Object3D | undefined;
    const draw = () => {
      if (model && !abort.signal.aborted) renderer?.render(scene, camera);
    };
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = element;
      if (!renderer || !width || !height) return;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    controls.addEventListener("change", draw);
    const keydown = (event: KeyboardEvent) => {
      const step = Math.PI / 12;
      if (event.key === "ArrowLeft") controls.rotateLeft(step);
      else if (event.key === "ArrowRight") controls.rotateLeft(-step);
      else if (event.key === "ArrowUp") controls.rotateUp(step);
      else if (event.key === "ArrowDown") controls.rotateUp(-step);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    element.addEventListener("keydown", keydown);

    const load = async () => {
      const response = await fetch(url, { signal: abort.signal, redirect: "error" });
      if (!response.ok) throw new Error("Model unavailable");
      const bytes = await response.arrayBuffer();
      if (abort.signal.aborted) return;
      // Local previews are self-contained. A dropped file must not issue requests for model dependencies.
      const manager = new LoadingManager().setURLModifier((uri) =>
        uri.startsWith("blob:") || uri.startsWith("data:") ? uri : "data:,",
      );
      const { scene: loaded } = await new GLTFLoader(manager).parseAsync(bytes, "");
      if (abort.signal.aborted) {
        disposeModel(loaded);
        return;
      }
      model = loaded;
      const bounds = new Box3().setFromObject(model);
      if (bounds.isEmpty()) throw new Error("Model is empty");
      renderer = new WebGLRenderer({ canvas: element, alpha: true, antialias: true });
      const { center, radius } = bounds.getBoundingSphere(new Sphere());
      const size = Math.max(radius, 0.001);
      const aspect = element.clientWidth / Math.max(element.clientHeight, 1);
      const distance = (size * 3.5) / Math.min(aspect || 1, 1);
      camera.near = size / 100;
      camera.far = Math.max(size * 50, distance * 2);
      camera.position.copy(center).addScaledVector(key.position.clone().normalize(), distance);
      controls.target.copy(center);
      controls.minDistance = size * 1.1;
      controls.maxDistance = Math.max(size * 12, distance);
      scene.add(model);
      controls.update();
      resize();
      setStatus("ready");
    };
    void load().catch(() => {
      if (!abort.signal.aborted) setStatus("error");
    });
    return () => {
      abort.abort();
      element.removeEventListener("keydown", keydown);
      controls.removeEventListener("change", draw);
      controls.dispose();
      observer.disconnect();
      if (model) disposeModel(model);
      renderer?.dispose();
    };
  }, [url]);

  return (
    <div className="relative">
      <canvas
        ref={canvas}
        aria-label="3D preview. Use arrow keys to rotate."
        tabIndex={status === "ready" ? 0 : -1}
        className="bg-background focus-visible:ring-ring aspect-[4/3] max-h-[65dvh] w-full rounded-md focus-visible:ring-2"
      />
      {status !== "ready" && (
        <p
          role="status"
          className="text-muted-foreground pointer-events-none absolute inset-0 grid place-items-center px-4 text-center"
        >
          {status === "loading" ? "Loading 3D preview…" : "Could not open this 3D preview."}
        </p>
      )}
    </div>
  );
}
