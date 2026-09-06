// paperScene.ts builds the Omni manuscript sculpture. Loaded only in the browser.
import * as THREE from "three";

export function createPaperScene(host: HTMLElement): {
    setPaused: (paused: boolean) => void;
    dispose: () => void;
} {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 50);
    camera.position.set(0, 0, 13);
    const sculpture = new THREE.Group();
    scene.add(sculpture);
    scene.add(new THREE.AmbientLight(0xfff8ea, 1.4));
    const key = new THREE.DirectionalLight(0xfff8e9, 2.4);
    key.position.set(-3, 5, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    key.shadow.normalBias = 0.035;
    key.shadow.bias = -0.0003;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9bbcf8, 0.7);
    rim.position.set(5, -2, 3);
    scene.add(rim);
    // A diffuse shadow behind the sculpture gives the floating sheets a shared depth.
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = shadowCanvas.height = 128;
    const shadowContext = shadowCanvas.getContext("2d");
    if (shadowContext) {
        const gradient = shadowContext.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, "rgba(61,65,63,0.2)");
        gradient.addColorStop(1, "rgba(61,65,63,0)");
        shadowContext.fillStyle = gradient;
        shadowContext.fillRect(0, 0, 128, 128);
    }
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 5),
        new THREE.MeshBasicMaterial({
            map: shadowTexture,
            transparent: true,
            depthWrite: false,
        }),
    );
    shadow.position.set(0.3, -1.2, -3);
    scene.add(shadow);
    const textures: THREE.Texture[] = [shadowTexture];

    function paperTexture(index: number): THREE.CanvasTexture {
        const canvas = document.createElement("canvas");
        canvas.width = 768;
        canvas.height = 1024;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.fillStyle = "#f6f0e4";
        ctx.fillRect(0, 0, 768, 1024);
        // Deterministic flecks give the paper a tactile grain without image downloads.
        for (let i = 0; i < 6500; i++) {
            ctx.fillStyle = i % 2 ? "rgba(101,80,52,.04)" : "rgba(255,255,255,.2)";
            ctx.fillRect((i * 173.7) % 768, (i * 91.3) % 1024, 1.5, 1.5);
        }
        ctx.fillStyle = "#756f64";
        ctx.font = "16px sans-serif";
        ctx.fillText("THE LIGHTHOUSE", 78, 83);
        ctx.fillText(`0${index + 1}`, 652, 83);
        ctx.fillStyle = "#393a35";
        ctx.font = "italic 54px Georgia";
        ctx.fillText(index === 0 ? "A little further." : "Across the water.", 78, 180);
        ctx.fillStyle = "#d5dfed";
        ctx.fillRect(78, 239, 472, 34);
        const lines = [
            "The lighthouse swept its beam across",
            "the water. On the other shore, someone",
            "was still awake. She wondered if they",
            "could see the same light from there.",
            "",
            "For a moment, the distance between",
            "them felt like something she could fold",
            "into a letter, and send.",
        ];
        ctx.fillStyle = "#5b5c54";
        ctx.font = "25px Georgia";
        lines.forEach((line, i) => ctx.fillText(line, 78, 264 + i * 44));
        for (let i = 0; i < 8; i++) {
            ctx.fillStyle = "#c2bfb3";
            ctx.fillRect(78, 676 + i * 25, 400 + ((i * 47) % 180), 3);
        }
        ctx.strokeStyle = "#c0b8a7";
        ctx.beginPath();
        ctx.moveTo(78, 946);
        ctx.lineTo(690, 946);
        ctx.stroke();
        ctx.font = "14px sans-serif";
        ctx.fillStyle = "#817d73";
        ctx.fillText("QUILLIUM   /   A WORK IN PROGRESS", 78, 976);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
        textures.push(texture);
        return texture;
    }

    const papers: { mesh: THREE.Mesh; home: THREE.Vector3; phase: number }[] = [];
    const arrangements = [
        { p: [0.1, 0.05, 1.1], r: [-0.13, -0.3, -0.14], s: 1.05 },
        { p: [-1.8, 1.16, -0.7], r: [0.25, 0.42, 0.38], s: 0.73 },
        { p: [1.65, -0.92, -0.35], r: [-0.22, -0.62, -0.35], s: 0.73 },
        { p: [1.6, 1.9, -1.6], r: [0.45, -0.22, -0.42], s: 0.48 },
        { p: [-1.8, -1.6, -1.25], r: [-0.28, 0.5, 0.28], s: 0.46 },
    ];
    arrangements.forEach((item, index) => {
        const geometry = new THREE.PlaneGeometry(2.4, 3.2, 32, 40);
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            positions.setZ(i, 0.15 * x * x + 0.065 * Math.sin(y * 1.8 + index) * x);
        }
        geometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({
            map: paperTexture(index),
            side: THREE.DoubleSide,
            roughness: 0.85,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...(item.p as [number, number, number]));
        mesh.rotation.set(...(item.r as [number, number, number]));
        mesh.scale.setScalar(item.s);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        sculpture.add(mesh);
        papers.push({ mesh, home: mesh.position.clone(), phase: index * 1.7 });
    });

    // Two tilted orbital paths pass in front of and behind the manuscripts.
    const tracks: { curve: THREE.CatmullRomCurve3; beads: THREE.Mesh[] }[] = [];
    for (let ring = 0; ring < 2; ring++) {
        const points = Array.from({ length: 97 }, (_, i) => {
            const t = (i / 96) * Math.PI * 2;
            return new THREE.Vector3(
                Math.cos(t) * (3.05 + ring * 0.22),
                Math.sin(t) * (1.08 + ring * 0.3),
                Math.sin(t) * 1.4,
            ).applyAxisAngle(new THREE.Vector3(0, 0, 1), ring ? -0.65 : 0.45);
        });
        const curve = new THREE.CatmullRomCurve3(points, true);
        const rail = new THREE.Mesh(
            new THREE.TubeGeometry(curve, 180, 0.009, 5, true),
            new THREE.MeshBasicMaterial({ color: 0x789bcc, transparent: true, opacity: 0.46 }),
        );
        sculpture.add(rail);
        const beads = Array.from({ length: 3 }, () => {
            const bead = new THREE.Mesh(
                new THREE.SphereGeometry(0.042, 12, 8),
                new THREE.MeshBasicMaterial({ color: 0x417ac3 }),
            );
            sculpture.add(bead);
            return bead;
        });
        tracks.push({ curve, beads });
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let paused = false;
    let visible = false;
    let disposed = false;
    let frame = 0;
    let time = 0;
    let last = 0;
    let pointerX = 0;
    let pointerY = 0;
    let scroll = 0;

    function draw(): void {
        sculpture.rotation.y += (pointerX * 0.12 - sculpture.rotation.y) * 0.045;
        sculpture.rotation.x += (pointerY * 0.08 - sculpture.rotation.x) * 0.045;
        sculpture.rotation.z = Math.sin(time * 0.12) * 0.035 - scroll * 0.1;
        for (const { mesh, home, phase } of papers) {
            mesh.position.y = home.y + Math.sin(time * 0.65 + phase) * 0.11;
            mesh.position.x = home.x * (1 + scroll * 0.15);
        }
        tracks.forEach(({ curve, beads }, ring) => {
            beads.forEach((bead, i) => {
                bead.position.copy(curve.getPointAt((time * 0.045 + i / 3 + ring * 0.15) % 1));
            });
        });
        renderer.render(scene, camera);
    }
    function tick(now: number): void {
        time += last ? Math.min((now - last) / 1000, 0.05) : 0;
        last = now;
        draw();
        frame = requestAnimationFrame(tick);
    }
    function updatePlayback(): void {
        cancelAnimationFrame(frame);
        last = 0;
        if (disposed) return;
        if (visible && !paused && !reduced.matches && !document.hidden) {
            frame = requestAnimationFrame(tick);
        } else {
            draw();
        }
    }
    function resize(): void {
        const { width, height } = host.getBoundingClientRect();
        renderer.setSize(width, height);
        camera.aspect = width / Math.max(height, 1);
        camera.position.z = camera.aspect < 0.9 ? 15 : 13;
        camera.updateProjectionMatrix();
        draw();
    }
    function pointer(event: PointerEvent): void {
        if (reduced.matches || paused || event.pointerType === "touch") return;
        const rect = host.getBoundingClientRect();
        pointerX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
        pointerY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    }
    function onScroll(): void {
        if (!reduced.matches && !paused) scroll = Math.min(window.scrollY / 900, 1);
    }
    const observer = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        updatePlayback();
    });
    const resizer = new ResizeObserver(resize);
    observer.observe(host);
    resizer.observe(host);
    host.addEventListener("pointermove", pointer);
    window.addEventListener("scroll", onScroll, { passive: true });
    reduced.addEventListener("change", updatePlayback);
    document.addEventListener("visibilitychange", updatePlayback);
    resize();

    return {
        setPaused(value) {
            paused = value;
            updatePlayback();
        },
        dispose() {
            disposed = true;
            cancelAnimationFrame(frame);
            observer.disconnect();
            resizer.disconnect();
            host.removeEventListener("pointermove", pointer);
            window.removeEventListener("scroll", onScroll);
            reduced.removeEventListener("change", updatePlayback);
            document.removeEventListener("visibilitychange", updatePlayback);
            scene.traverse((object) => {
                if (object instanceof THREE.Mesh) {
                    object.geometry.dispose();
                    const materials = Array.isArray(object.material)
                        ? object.material
                        : [object.material];
                    for (const material of materials) material.dispose();
                }
            });
            for (const texture of textures) texture.dispose();
            renderer.dispose();
            renderer.domElement.remove();
        },
    };
}
