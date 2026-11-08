import * as THREE from "three";
import { glowTexture } from "./textures.js";

const DEPTH = 13;
const ORBIT_SECONDS = 8;
const TARGET_TRANSIT_SECONDS = 1.15;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smooth = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function randomPortalPoint() {
  return { x: -0.78 + Math.random() * 0.86, y: -0.54 + Math.random() * 1.08 };
}

function cubic(a, b, c, d, t) {
  const inverse = 1 - t;
  return inverse ** 3 * a + 3 * inverse ** 2 * t * b + 3 * inverse * t ** 2 * c + t ** 3 * d;
}

function cubicTangent(a, b, c, d, t) {
  const inverse = 1 - t;
  return 3 * inverse ** 2 * (b - a) + 6 * inverse * t * (c - b) + 3 * t ** 2 * (d - c);
}

function curvedPath(from, to, bend = 1) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(0.001, Math.hypot(dx, dy));
  const offset = bend * Math.min(0.24, Math.max(0.1, distance * 0.2));
  const normalX = -dy / distance;
  const normalY = dx / distance;
  return {
    from: { ...from },
    c1: { x: from.x + dx * 0.28 + normalX * offset, y: from.y + dy * 0.28 + normalY * offset },
    c2: { x: from.x + dx * 0.72 + normalX * offset, y: from.y + dy * 0.72 + normalY * offset },
    to: { ...to }
  };
}

function portalShader() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpen: { value: 0 }, uSeed: { value: Math.random() * 20 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpen;
      uniform float uSeed;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float angle = atan(p.y, p.x);
        float edge = 1.0 - smoothstep(0.78, 1.0, r);
        float rim = exp(-pow((r - 0.78) * 30.0, 2.0));
        float swirl = 0.5 + 0.5 * sin(angle * 4.0 - r * 25.0 - uTime * 5.0 + uSeed);
        float bands = 0.5 + 0.5 * sin(r * 38.0 - angle * 2.0 - uTime * 6.0 + swirl * 2.2);
        float core = 1.0 - smoothstep(0.04, 0.5, r);
        float light = edge * (0.32 + bands * 0.18 + swirl * 0.12) + rim * 0.8 + core * 0.25;
        vec3 fringe = mix(vec3(0.48, 0.72, 1.0), vec3(0.82, 0.65, 1.0), swirl);
        vec3 color = mix(vec3(0.82, 0.93, 1.0), vec3(1.0), clamp(rim + core * 0.6, 0.0, 1.0));
        color = mix(fringe, color, 0.78);
        gl_FragColor = vec4(color * light, edge * (0.32 + 0.48 * bands) + rim * 0.35 + core * 0.12);
        gl_FragColor.a *= uOpen;
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
}

function makePortal(sceneRoot, camera) {
  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 20;
  const apertureMaterial = portalShader();
  const aperture = new THREE.Mesh(new THREE.CircleGeometry(0.92, 64), apertureMaterial);
  aperture.position.z = -0.08;
  aperture.renderOrder = 20;
  group.add(aperture);

  const rings = [];
  const ringData = [
    { radius: 0.91, tube: 0.035, color: 0xffffff, opacity: 0.95 },
    { radius: 1.0, tube: 0.013, color: 0xdff8ff, opacity: 0.8 },
    { radius: 1.12, tube: 0.008, color: 0xb2caff, opacity: 0.6 }
  ];
  for (const [index, item] of ringData.entries()) {
    const material = new THREE.MeshBasicMaterial({
      color: item.color,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(item.radius, item.tube, 8, 80), material);
    ring.rotation.x = index % 2 ? 0.06 : -0.04;
    ring.rotation.y = index === 2 ? 0.08 : 0;
    ring.position.z = index * 0.015;
    ring.renderOrder = 21 + index;
    group.add(ring);
    rings.push({ mesh: ring, material, baseOpacity: item.opacity, index });
  }

  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture(), color: 0xf2f8ff, transparent: true, opacity: 0,
    depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const glow = new THREE.Sprite(glowMaterial);
  glow.scale.set(3.8, 4.7, 1);
  glow.position.z = -0.18;
  glow.renderOrder = 19;
  group.add(glow);
  sceneRoot.add(group);

  return {
    group,
    aperture,
    apertureMaterial,
    rings,
    glowMaterial,
    glow,
    point: randomPortalPoint(),
    progress: 0,
    visible: false,
    setPoint(point) { this.point = point; },
    setForeground(foreground) {
      this.glow.renderOrder = foreground ? 49 : 19;
      this.aperture.renderOrder = foreground ? 50 : 20;
      for (const item of this.rings) item.mesh.renderOrder = foreground ? 51 + item.index : 21 + item.index;
    },
    setEntryMask(enabled) {
      this.apertureMaterial.depthWrite = enabled;
      this.apertureMaterial.needsUpdate = true;
    },
    show(opening, time, depth = DEPTH) {
      this.visible = opening > 0.005;
      this.progress = opening;
      this.group.visible = this.visible;
      if (!this.visible) return;
      const depthHeight = depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      this.group.position.set(this.point.x * depthHeight * camera.aspect, this.point.y * depthHeight, -depth);
      const eased = smooth(opening);
      const pulse = 1 + Math.sin(time * 11) * 0.025 * eased;
      this.group.scale.set(eased * pulse, eased * pulse * 1.23, eased);
      this.apertureMaterial.uniforms.uTime.value = time;
      this.apertureMaterial.uniforms.uOpen.value = eased;
      this.glowMaterial.opacity = 0.7 * eased;
      this.glow.scale.set(3.8 + eased * 0.45, 4.7 + eased * 0.6, 1);
      for (const item of this.rings) {
        item.material.opacity = item.baseOpacity * eased * (0.85 + Math.sin(time * 7 + item.index) * 0.15);
        item.mesh.rotation.z = time * (item.index % 2 ? -0.48 : 0.35) + item.index * 0.7;
      }
    },
    dispose() {
      this.group.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) object.material.dispose();
      });
    }
  };
}

function makeShip(root) {
  const ship = new THREE.Group();
  ship.visible = false;
  ship.renderOrder = 60;
  const materials = [];
  const metal = (color, options = {}) => {
    const material = new THREE.MeshPhongMaterial({
      color,
      specular: 0x5c6268,
      shininess: 16,
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      ...options
    });
    materials.push(material);
    return material;
  };
  const lineMaterial = (color, opacity = 1) => {
    const material = new THREE.LineBasicMaterial({ color, opacity, transparent: opacity < 1, depthTest: false, depthWrite: false, toneMapped: false });
    materials.push(material);
    return material;
  };
  const addMesh = (geometry, material, position, order = 62) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.renderOrder = order;
    ship.add(mesh);
    return mesh;
  };
  const addBar = (width, height, depth, color, x, y, z, angle = 0, order = 63) => {
    const bar = addMesh(new THREE.BoxGeometry(width, height, depth), metal(color, { shininess: 12 }), new THREE.Vector3(x, y, z), order);
    bar.rotation.z = angle;
    return bar;
  };

  // The split forward mandibles and offset cockpit give the hull its
  // recognizable freighter profile. Extrusion and bevels make its rim read
  // as a solid metal body while it banks through the camera-facing flight.
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-0.62, -0.35);
  hullShape.quadraticCurveTo(-0.76, 0, -0.62, 0.35);
  hullShape.quadraticCurveTo(-0.4, 0.64, 0.04, 0.64);
  hullShape.quadraticCurveTo(0.37, 0.62, 0.55, 0.46);
  hullShape.lineTo(0.76, 0.34);
  hullShape.lineTo(0.64, 0.18);
  hullShape.lineTo(0.09, 0.105);
  hullShape.quadraticCurveTo(0.045, 0, 0.09, -0.105);
  hullShape.lineTo(0.64, -0.18);
  hullShape.lineTo(0.76, -0.34);
  hullShape.lineTo(0.55, -0.46);
  hullShape.quadraticCurveTo(0.37, -0.62, 0.04, -0.64);
  hullShape.quadraticCurveTo(-0.4, -0.64, -0.62, -0.35);
  hullShape.closePath();

  const hullGeometry = new THREE.ExtrudeGeometry(hullShape, {
    depth: 0.16,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.025,
    bevelThickness: 0.035,
    curveSegments: 12
  });
  hullGeometry.translate(0, 0, -0.08);
  addMesh(hullGeometry, metal(0xb9b5aa, { specular: 0x8b877d, shininess: 22 }), new THREE.Vector3(), 60);

  // A raised circular hull ring and inset plates break up the broad saucer.
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.018, 6, 48), metal(0x6e7d8e, { shininess: 42 }));
  rim.position.set(-0.12, 0.02, 0.125);
  rim.renderOrder = 62;
  ship.add(rim);
  const plateColor = 0x7f8d9d;
  addBar(0.24, 0.12, 0.026, plateColor, -0.42, 0.28, 0.12, -0.28);
  addBar(0.2, 0.1, 0.026, 0xb3bdc8, -0.42, -0.31, 0.12, 0.28);
  addBar(0.22, 0.085, 0.026, 0x768596, 0.06, 0.49, 0.12, 0.12);
  addBar(0.2, 0.08, 0.026, 0x768596, 0.06, -0.49, 0.12, -0.12);
  addBar(0.2, 0.055, 0.025, 0xc0cad4, -0.12, 0.02, 0.13);

  // Fine hull seams and inset panels make the top surface legible at orbit
  // scale without relying on an external model or texture asset.
  const outlinePoints = hullShape.getPoints(72).map((point) => new THREE.Vector3(point.x, point.y, 0.105));
  const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(outlinePoints), lineMaterial(0xd0dae4, 0.72));
  outline.renderOrder = 64;
  ship.add(outline);
  const seamMaterial = lineMaterial(0x445465, 0.8);
  const seamPaths = [
    [[-0.56, 0.06], [-0.37, 0.09], [-0.2, 0.03]],
    [[-0.5, -0.14], [-0.27, -0.1], [-0.12, -0.2]],
    [[-0.36, 0.43], [-0.2, 0.31], [-0.02, 0.29]],
    [[-0.36, -0.43], [-0.2, -0.31], [-0.02, -0.29]],
    [[0.23, 0.47], [0.34, 0.38], [0.48, 0.34]],
    [[0.23, -0.47], [0.34, -0.38], [0.48, -0.34]]
  ];
  for (const path of seamPaths) {
    const seam = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path.map(([x, y]) => new THREE.Vector3(x, y, 0.13))), seamMaterial);
    seam.renderOrder = 65;
    ship.add(seam);
  }

  // The offset cylindrical cockpit pod and its dark viewports sit along the
  // right side of the hull, ahead of the dish.
  const cockpitPod = addMesh(new THREE.CylinderGeometry(0.082, 0.096, 0.38, 12), metal(0xb0bac5, { shininess: 34 }), new THREE.Vector3(0.69, 0.22, 0.015), 66);
  cockpitPod.rotation.z = -Math.PI / 2;
  const cockpitNose = addMesh(new THREE.SphereGeometry(0.09, 14, 10), metal(0x8d9aa8), new THREE.Vector3(0.87, 0.22, 0.015), 66);
  cockpitNose.scale.set(1.2, 0.88, 0.86);
  const windowMaterial = metal(0x162737, { specular: 0x8fdcf5, shininess: 70 });
  addBar(0.075, 0.035, 0.018, 0x172b3a, 0.73, 0.22, 0.103, 0, 68);
  addBar(0.045, 0.034, 0.018, 0x172b3a, 0.81, 0.22, 0.103, 0, 68);
  // Small blue glints on the viewports keep them readable against the hull.
  const viewportGlow = addMesh(new THREE.BoxGeometry(0.012, 0.02, 0.008), windowMaterial, new THREE.Vector3(0.73, 0.22, 0.114), 69);
  viewportGlow.rotation.z = 0.08;

  // A layered, shallow parabolic dish on the dorsal hull.
  const dishBase = addMesh(new THREE.CylinderGeometry(0.135, 0.16, 0.045, 24), metal(0x778696, { shininess: 38 }), new THREE.Vector3(-0.22, 0.27, 0.12), 66);
  dishBase.rotation.x = Math.PI / 2;
  addMesh(new THREE.CircleGeometry(0.125, 32), metal(0x293847, { specular: 0x91a9c1, shininess: 62 }), new THREE.Vector3(-0.22, 0.27, 0.147), 67);
  const dishRim = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 6, 32), metal(0xc2ccd5, { shininess: 50 }));
  dishRim.position.set(-0.22, 0.27, 0.152);
  dishRim.renderOrder = 68;
  ship.add(dishRim);
  addBar(0.116, 0.015, 0.012, 0x9caaba, -0.22, 0.27, 0.16, -0.25, 69);

  // Twin dorsal turrets, small cannon barrels, and cooling vents.
  for (const y of [0]) {
    const turret = addMesh(new THREE.CylinderGeometry(0.082, 0.09, 0.055, 16), metal(0x8795a5, { shininess: 40 }), new THREE.Vector3(-0.02, y, 0.13), 66);
    turret.rotation.x = Math.PI / 2;
    const turretTop = addMesh(new THREE.SphereGeometry(0.065, 12, 8), metal(0xa9b5c1), new THREE.Vector3(-0.02, y, 0.16), 67);
    turretTop.scale.set(1, 0.82, 0.5);
    addBar(0.19, 0.022, 0.022, 0x566576, 0.07, y, 0.17, 0, 68);
  }
  for (let index = 0; index < 5; index++) {
    addBar(0.018, 0.09, 0.018, 0x53687d, -0.61 + index * 0.045, -0.045, 0.08, 0, 64);
  }

  // Six circular exhaust vents across the aft deck.
  for (const x of [-0.48, -0.29]) {
    for (const y of [-0.28, 0, 0.28]) {
      const vent = addMesh(new THREE.CylinderGeometry(0.073, 0.073, 0.024, 24),
        metal(0x242a2d), new THREE.Vector3(x, y, 0.13), 67);
      vent.rotation.x = Math.PI / 2;
      addMesh(new THREE.TorusGeometry(0.075, 0.009, 6, 24),
        metal(0x8d8b82), new THREE.Vector3(x, y, 0.147), 68);
      for (let slit = -2; slit <= 2; slit++) {
        addBar(0.105, 0.006, 0.008, 0x686c68, x, y + slit * 0.022, 0.15, 0, 69);
      }
    }
  }
  // Asymmetric, weathered armor markings and mandible recesses.
  for (const y of [-0.29, 0.29]) {
    addBar(0.29, 0.085, 0.018, 0x42474a, 0.43, y, 0.124, y > 0 ? 0.13 : -0.13);
    addBar(0.19, 0.025, 0.025, 0xbbb7ac, 0.44, y, 0.14);
  }
  addBar(0.18, 0.06, 0.018, 0x764c42, -0.13, -0.5, 0.135, -0.2);
  addBar(0.12, 0.045, 0.018, 0x764c42, 0.15, 0.48, 0.135, 0.2);

  // Raise the deck toward its center, including the attached surface detail.
  // This creates the Falcon's shallow lenticular saucer rather than a slab.
  const deckHeight = (x, y) => 0.13 * Math.max(0, 1 - Math.hypot(x + 0.12, y) / 0.7);
  const hullVertices = hullGeometry.attributes.position;
  for (let i = 0; i < hullVertices.count; i++) {
    const z = hullVertices.getZ(i);
    hullVertices.setZ(i, z + Math.sign(z) * deckHeight(hullVertices.getX(i), hullVertices.getY(i)));
  }
  hullGeometry.computeVertexNormals();
  for (const part of ship.children) {
    if (!part.isLine) continue;
    const vertices = part.geometry.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
      vertices.setZ(i, vertices.getZ(i) + deckHeight(vertices.getX(i), vertices.getY(i)));
    }
  }
  for (const part of ship.children) {
    if (part.geometry === hullGeometry) continue;
    if (part.position.z > 0.07) part.position.z += deckHeight(part.position.x, part.position.y);
  }

  rim.position.z = 0.125 + deckHeight(0.34, 0.02);

  // Carry the cockpit outboard on its angled access corridor.
  const cockpitParts = [cockpitPod, cockpitNose, viewportGlow];
  for (const part of ship.children) {
    if (part.position.x > 0.68 && !cockpitParts.includes(part)) cockpitParts.push(part);
  }
  for (const part of cockpitParts) part.position.y += 0.3;
  const corridor = addMesh(new THREE.CylinderGeometry(0.085, 0.095, 0.43, 16),
    metal(0xa6a59c), new THREE.Vector3(0.42, 0.45, 0.06), 66);
  corridor.rotation.z = -1.05;

  // Lift and tilt the radar dish on a short pedestal.
  const radar = new THREE.Group();
  radar.position.set(-0.22, 0.27, 0.24);
  for (const part of [...ship.children]) {
    if (Math.abs(part.position.x + 0.22) < 0.001 && Math.abs(part.position.y - 0.27) < 0.001) {
      part.position.sub(radar.position);
      radar.add(part);
    }
  }
  radar.rotation.x = 0.48;
  ship.add(radar);
  addBar(0.025, 0.025, 0.14, 0x787d7b, -0.22, 0.27, 0.24);

  // A continuous blue engine band follows the curved stern.
  const enginePoints = [];
  for (let i = 0; i <= 32; i++) {
    const angle = Math.PI * (0.73 + i / 32 * 0.54);
    enginePoints.push(new THREE.Vector3(-0.1 + Math.cos(angle) * 0.62, Math.sin(angle) * 0.62, 0));
  }
  const engineMaterial = new THREE.MeshBasicMaterial({ color: 0x83eaff, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, toneMapped: false });
  materials.push(engineMaterial);
  const engine = addMesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(enginePoints), 48, 0.025, 8, false),
    engineMaterial, new THREE.Vector3(), 70);
  // Keep the animation's exhaust handle while replacing the rocket cone.
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x69dfff,
    transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
  flame.position.set(-0.71, 0, -0.025);
  flame.scale.set(0.25, 0.8, 1);
  flame.renderOrder = 39;
  ship.add(flame);

  // A fixed oblique presentation exposes the rim, underside and raised deck.
  const model = new THREE.Group();
  for (const part of [...ship.children]) model.add(part);
  model.rotation.set(0.46, -0.18, 0);
  ship.add(model);

  // Soft, local lighting gives the beveled armor real light falloff while
  // staying independent of the galaxy's scene lighting.
  ship.add(new THREE.AmbientLight(0xa8bed6, 1.15));
  const keyLight = new THREE.PointLight(0xe0f3ff, 3.4, 7, 2);
  keyLight.position.set(-0.25, 0.55, 2.2);
  ship.add(keyLight);
  const rimLight = new THREE.PointLight(0x58dfff, 1.8, 4, 2);
  rimLight.position.set(-0.7, -0.1, 0.6);
  ship.add(rimLight);

  root.add(ship);
  return {
    group: ship, flame, engine,
    setDepthTest(enabled) {
      for (const material of materials) material.depthTest = enabled;
      flame.material.depthTest = enabled;
    }
  };
}

function makeTrail(root, color, opacity, offset, count = 18) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 38;
  line.visible = false;
  root.add(line);
  const history = Array.from({ length: count }, () => ({ x: 0, y: 0, z: -DEPTH }));
  return { line, geometry, positions, history, timer: 0, offset };
}

function makeTimeVortex(root) {
  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 52;
  const rings = [];
  for (const [index, radius] of [0.76, 1.02, 1.3, 1.48].entries()) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, index === 1 ? .018 : index === 3 ? .012 : .01, 6, 96), new THREE.MeshBasicMaterial({
      color: index === 1 ? 0xb2f7ff : index === 0 ? 0x71d7ff : index === 2 ? 0xa98cff : 0x77e5ff,
      transparent: true, opacity: index === 1 ? .88 : index === 3 ? .7 : .52, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    ring.renderOrder = 52 + index;
    group.add(ring);
    rings.push(ring);
  }
  const ticks = [];
  for (let index = 0; index < 60; index++) {
    const angle = index / 60 * Math.PI * 2;
    const major = index % 5 === 0;
    const inner = major ? 1.08 : 1.17;
    const outer = major ? 1.39 : 1.34;
    ticks.push(Math.cos(angle) * inner, Math.sin(angle) * inner, .01,
      Math.cos(angle) * outer, Math.sin(angle) * outer, .01);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(ticks, 3));
  const marks = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xb4f5ff, transparent: true, opacity: .78, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  marks.renderOrder = 55;
  group.add(marks);

  // Clock hands and a luminous hub make the time tunnel read as an actual
  // instrument face while its tick marks rotate around the ship.
  const makeHand = (length, width, color, z) => {
    const pivot = new THREE.Group();
    const hand = new THREE.Mesh(new THREE.BoxGeometry(width, length, .012), new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: .9, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    hand.position.set(0, length / 2, z);
    hand.renderOrder = 57;
    pivot.add(hand);
    group.add(pivot);
    return pivot;
  };
  const hourHand = makeHand(.46, .045, 0xe1faff, .035);
  const minuteHand = makeHand(.76, .024, 0x9cf4ff, .045);
  const secondHand = makeHand(.96, .012, 0x70dfff, .055);
  const hub = new THREE.Mesh(new THREE.CircleGeometry(.075, 20), new THREE.MeshBasicMaterial({
    color: 0xe8fcff, transparent: true, opacity: .95, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending
  }));
  hub.position.z = .07;
  hub.renderOrder = 58;
  group.add(hub);
  root.add(group);
  return { group, rings, hourHand, minuteHand, secondHand };
}

// A camera-facing white wormhole and explorer ship. Its animation never
// changes the user's camera, so it can play over the existing live scene.
export function createExplorerFlight(scene, camera, { getArrivalStar, getOrbitTargets, positionOf, orbitRadius = 0.135, shipScale = 0.5, trailLength = 18 } = {}) {
  const rig = new THREE.Group();
  rig.renderOrder = 18;
  scene.add(rig);
  const portal = makePortal(rig, camera);
  const ship = makeShip(rig);
  const timeVortex = makeTimeVortex(rig);
  const trails = [makeTrail(rig, 0xeafaff, 0.82, -0.014, trailLength), makeTrail(rig, 0x54d8ff, 0.68, 0.014, trailLength)];
  const historyPoints = [new THREE.Vector3(), new THREE.Vector3()];
  const shipLocal = new THREE.Vector3();

  let phase = "idle";
  let elapsed = 0;
  let time = 0;
  let exitRequested = false;
  let timelineStyle = false;
  let current = { x: -0.3, y: 0.05 };
  let heading = 0;
  let travel = null;
  let entryPath = null;
  let entryPoint = { ...current };
  let entryBend = 1;
  let exitPoint = { ...current };
  let exitBend = -1;
  let arrivalStarId = null;
  let arrivalWorldPoint = null;
  let previousExitPoint = null;
  let tourTargets = [];
  let tourTargetIndex = 0;
  let orbitPhaseOffset = 0;
  const BLACK_HOLE_TARGET = "__black-hole__";
  const TIMELINE_END_TARGET = "__timeline-end__";

  function localFromNdc(point, depth = DEPTH, target = new THREE.Vector3()) {
    const halfHeight = depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const halfWidth = halfHeight * camera.aspect;
    return target.set(point.x * halfWidth, point.y * halfHeight, -depth);
  }

  function updateRig() {
    rig.position.copy(camera.position);
    rig.quaternion.copy(camera.quaternion);
  }

  function arrivalPointOnScreen() {
    const livePosition = arrivalStarId && positionOf ? positionOf(arrivalStarId) : null;
    if (livePosition && arrivalWorldPoint) arrivalWorldPoint.copy(livePosition);
    if (!arrivalWorldPoint) return { x: 0, y: 0 };
    camera.updateMatrixWorld(true);
    const point = arrivalWorldPoint.clone().project(camera);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.z < -1 || point.z > 1) return { x: 0, y: 0 };
    return {
      x: THREE.MathUtils.clamp(point.x, -0.76, 0.76),
      y: THREE.MathUtils.clamp(point.y, -0.7, 0.7)
    };
  }

  function buildTourTargets() {
    const byId = new Map();
    for (const target of (getOrbitTargets ? getOrbitTargets() : []) || []) {
      if (target && target.id != null && String(target.id) !== BLACK_HOLE_TARGET) {
        byId.set(String(target.id), { id: String(target.id), kind: "star", position: target.position || null });
      }
    }
    if (arrivalStarId && !byId.has(arrivalStarId)) {
      byId.set(arrivalStarId, { id: arrivalStarId, kind: "star", position: arrivalWorldPoint });
    }
    const targets = [...byId.values()];
    if (timelineStyle) {
      targets.sort((a, b) => targetPointOnScreen(a).x - targetPointOnScreen(b).x);
      if (targets.length <= 1) targets.push({ id: TIMELINE_END_TARGET, kind: "timeline-end" });
    } else if (targets.length <= 1) targets.push({ id: BLACK_HOLE_TARGET, kind: "black-hole" });
    return targets;
  }

  function targetPointOnScreen(target) {
    if (!target) return { x: 0, y: 0 };
    if (target.kind === "timeline-end") return { x: 0.82, y: 0 };
    const world = target.kind === "black-hole"
      ? new THREE.Vector3()
      : (positionOf && positionOf(target.id)) || target.position;
    if (!world) return { x: 0, y: 0 };
    camera.updateMatrixWorld(true);
    const projected = world.clone().project(camera);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.z < -1 || projected.z > 1) return { x: 0, y: 0 };
    return {
      x: THREE.MathUtils.clamp(projected.x, -0.76, 0.76),
      y: THREE.MathUtils.clamp(projected.y, -0.7, 0.7)
    };
  }

  function resetTrails(point) {
    for (const trail of trails) {
      trail.timer = 0.035;
      trail.line.visible = false;
      trail.history.forEach((item) => { item.x = point.x; item.y = point.y; });
    }
  }

  function showShip(point, depth = DEPTH, scale = 1, angle = 0) {
    ship.group.visible = true;
    ship.group.position.copy(localFromNdc(point, depth, shipLocal));
    ship.group.scale.setScalar(scale * shipScale);
    ship.group.rotation.z = angle;
    heading = angle;
    ship.flame.scale.y = 0.86 + Math.sin(time * 24) * 0.18;
    ship.engine.material.opacity = 0.78 + Math.sin(time * 19) * 0.16;
  }

  function openPortal(point) {
    portal.setPoint(point);
    portal.group.visible = true;
  }

  function makeDifferentPortalPoint(from) {
    let point = randomPortalPoint();
    for (let attempt = 0; attempt < 16; attempt++) {
      point = randomPortalPoint();
      const awayFromShip = Math.hypot(point.x - from.x, point.y - from.y) > 0.42;
      const awayFromLastPortal = !previousExitPoint || Math.hypot(point.x - previousExitPoint.x, point.y - previousExitPoint.y) > 0.28;
      if (awayFromShip && awayFromLastPortal) break;
    }
    previousExitPoint = { ...point };
    return point;
  }

  function arriveAtStar() {
    portal.show(0, time);
    portal.group.visible = false;
    portal.setEntryMask(false);
    ship.setDepthTest(false);
    phase = "hold";
    elapsed = 0;
    const timelineTarget = timelineStyle && tourTargets[tourTargetIndex];
    current = timelineTarget ? targetPointOnScreen(timelineTarget) : arrivalPointOnScreen();
    orbitPhaseOffset = Math.random() * Math.PI * 2;
    ship.group.visible = true;
    showShip(current, DEPTH - 0.8, 1, heading);
    for (const trail of trails) trail.line.visible = false;
    if (exitRequested) beginExit();
  }

  function beginExit() {
    phase = "exit";
    elapsed = 0;
    exitPoint = timelineStyle
      ? { x: 0.98, y: THREE.MathUtils.clamp(current.y, -0.48, 0.48) }
      : makeDifferentPortalPoint(current);
    portal.setForeground(true);
    openPortal(exitPoint);
    exitBend = Math.random() < 0.5 ? -1 : 1;
    travel = curvedPath(current, exitPoint, exitBend);
    ship.setDepthTest(false);
    resetTrails(current);
  }

  function beginNextTarget() {
    const currentTarget = tourTargets[tourTargetIndex];
    const targets = buildTourTargets();
    const currentIndex = currentTarget ? targets.findIndex(target => target.id === currentTarget.id) : -1;
    tourTargets = targets;
    tourTargetIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % targets.length;
    if (timelineStyle && currentIndex >= targets.length - 1) {
      tourTargetIndex = Math.max(0, currentIndex);
      beginExit();
      return;
    }
    phase = "transit";
    elapsed = 0;
    travel = curvedPath(current, targetPointOnScreen(tourTargets[tourTargetIndex]), Math.random() < 0.5 ? -1 : 1);
    portal.group.visible = false;
    ship.setDepthTest(false);
    resetTrails(current);
  }

  function orbitTarget(delta) {
    const center = targetPointOnScreen(tourTargets[tourTargetIndex]);
    const angle = orbitPhaseOffset + elapsed * (Math.PI * 2 / ORBIT_SECONDS);
    const radius = smooth(elapsed / 0.55);
    const radiusY = orbitRadius * radius;
    const radiusX = radiusY / Math.max(0.65, camera.aspect);
    current.x = center.x + Math.cos(angle) * radiusX;
    current.y = center.y + Math.sin(angle) * radiusY;
    heading = Math.atan2(Math.cos(angle) * radiusY, -Math.sin(angle) * radiusX);
    showShip(current, DEPTH - 0.8, 1, heading);
    updateTrails(current, delta);
  }

  function updateTrails(point, delta) {
    for (const trail of trails) {
      trail.timer += delta;
      if (trail.timer >= 0.035) {
        trail.timer = 0;
        for (let index = trail.history.length - 1; index > 0; index--) {
          trail.history[index].x = trail.history[index - 1].x;
          trail.history[index].y = trail.history[index - 1].y;
        }
        trail.history[0].x = point.x;
        trail.history[0].y = point.y;
      }
      for (let index = 0; index < trail.history.length; index++) {
        const item = trail.history[index];
        const before = trail.history[Math.max(0, index - 1)];
        const after = trail.history[Math.min(trail.history.length - 1, index + 1)];
        let tangentX = before.x - after.x;
        let tangentY = before.y - after.y;
        let tangentLength = Math.hypot(tangentX, tangentY);
        if (tangentLength < 0.001) {
          tangentX = Math.cos(heading);
          tangentY = Math.sin(heading);
          tangentLength = 1;
        }
        const pointWithOffset = {
          x: item.x - tangentY / tangentLength * trail.offset,
          y: item.y + tangentX / tangentLength * trail.offset
        };
        const local = localFromNdc(pointWithOffset, DEPTH + 0.2, historyPoints[index % historyPoints.length]);
        const offset = index * 3;
        trail.positions[offset] = local.x;
        trail.positions[offset + 1] = local.y;
        trail.positions[offset + 2] = local.z;
      }
      trail.geometry.attributes.position.needsUpdate = true;
      trail.line.visible = ship.group.visible && (phase === "entry" || phase === "hold" || phase === "transit" || phase === "exit");
    }
  }

  function setShipAlongTravel(path, progress, depth = DEPTH) {
    const t = smooth(progress);
    current.x = cubic(path.from.x, path.c1.x, path.c2.x, path.to.x, t);
    current.y = cubic(path.from.y, path.c1.y, path.c2.y, path.to.y, t);
    const dx = cubicTangent(path.from.x, path.c1.x, path.c2.x, path.to.x, t);
    const dy = cubicTangent(path.from.y, path.c1.y, path.c2.y, path.to.y, t);
    const angle = Math.atan2(dy, dx);
    heading = angle;
    const scale = phase === "exit" ? 1 - smooth((progress - 0.72) / 0.28) * 0.98 : 0.85 + smooth(progress) * 0.15;
    showShip(current, depth, Math.max(0.015, scale), angle);
    return current;
  }

  function start({ timeline = false } = {}) {
    cancel();
    timelineStyle = Boolean(timeline);
    updateRig();
    phase = "entry";
    elapsed = 0;
    exitRequested = false;
    const star = getArrivalStar ? getArrivalStar() : null;
    arrivalStarId = star && star.id != null ? String(star.id) : null;
    arrivalWorldPoint = star && star.position && star.position.isVector3 ? star.position.clone() : null;
    tourTargets = buildTourTargets();
    const arrivalIndex = arrivalStarId ? tourTargets.findIndex(target => target.id === arrivalStarId) : -1;
    if (arrivalIndex > 0) tourTargets = [...tourTargets.slice(arrivalIndex), ...tourTargets.slice(0, arrivalIndex)];
    tourTargetIndex = 0;
    entryPoint = timelineStyle
      ? { x: -1.02, y: -.5 + Math.random() }
      : randomPortalPoint();
    entryBend = Math.random() < 0.5 ? -1 : 1;
    current = { ...entryPoint };
    const entryTarget = timelineStyle && tourTargets[tourTargetIndex]
      ? targetPointOnScreen(tourTargets[tourTargetIndex])
      : arrivalPointOnScreen();
    entryPath = curvedPath(entryPoint, entryTarget, entryBend);
    portal.setForeground(false);
    portal.setEntryMask(true);
    ship.setDepthTest(true);
    openPortal(entryPoint);
    ship.group.visible = false;
    resetTrails(entryPoint);
  }

  function finish() {
    if (phase === "idle" || phase === "exit") return;
    exitRequested = true;
    if (phase === "hold" || phase === "transit") beginExit();
  }

  function cancel() {
    phase = "idle";
    elapsed = 0;
    exitRequested = false;
    travel = null;
    portal.setForeground(false);
    portal.setEntryMask(false);
    ship.setDepthTest(false);
    portal.group.visible = false;
    ship.group.visible = false;
    timeVortex.group.visible = false;
    arrivalStarId = null;
    arrivalWorldPoint = null;
    entryPath = null;
    tourTargets = [];
    tourTargetIndex = 0;
    for (const trail of trails) trail.line.visible = false;
  }

  function update(now, delta) {
    if (phase === "idle") return false;
    time = now;
    updateRig();
    if (phase === "entry") {
      elapsed += delta;
      const opening = smooth(elapsed / 0.26);
      const closing = 1 - smooth((elapsed - 0.95) / 0.36);
      portal.show(opening * closing, time);
      const emergence = clamp01((elapsed - 0.22) / 0.82);
      const entryTarget = timelineStyle && tourTargets[tourTargetIndex]
        ? targetPointOnScreen(tourTargets[tourTargetIndex])
        : arrivalPointOnScreen();
      entryPath = curvedPath(entryPoint, entryTarget, entryBend);
      if (emergence > 0) {
        setShipAlongTravel(entryPath, emergence, DEPTH + (1 - emergence) * 2.5 - emergence * 3);
        updateTrails(current, delta);
      }
      if (elapsed >= 1.34) arriveAtStar();
    } else if (phase === "hold") {
      elapsed += delta;
      orbitTarget(delta);
      if (elapsed >= ORBIT_SECONDS) beginNextTarget();
    } else if (phase === "transit") {
      elapsed += delta;
      setShipAlongTravel(travel, clamp01(elapsed / TARGET_TRANSIT_SECONDS), DEPTH - 0.8);
      updateTrails(current, delta);
      if (elapsed >= TARGET_TRANSIT_SECONDS) {
        phase = "hold";
        elapsed = 0;
        current = targetPointOnScreen(tourTargets[tourTargetIndex]);
        orbitPhaseOffset = Math.random() * Math.PI * 2;
        showShip(current, DEPTH - 0.8, 1, heading);
        resetTrails(current);
      }
    } else if (phase === "exit") {
      elapsed += delta;
      const opening = smooth(elapsed / 0.36);
      const closing = 1 - smooth((elapsed - 1.08) / 0.38);
      portal.show(opening * closing, time);
      const progress = clamp01((elapsed - 0.12) / 0.98);
      setShipAlongTravel(travel, progress, DEPTH - 0.8 + smooth((progress - 0.72) / 0.28) * 3.3);
      updateTrails(current, delta);
      if (elapsed >= 1.48) {
        portal.show(0, time);
        ship.group.visible = false;
        timeVortex.group.visible = false;
        for (const trail of trails) trail.line.visible = false;
        if (timelineStyle && !exitRequested) {
          start({ timeline: true });
          return false;
        }
        phase = "idle";
        return true;
      }
    }
    if (timelineStyle && ship.group.visible) {
      timeVortex.group.visible = true;
      timeVortex.group.position.copy(ship.group.position);
      const clockSpeed = phase === "hold" ? .42 : phase === "exit" ? -1.65 : 1.25;
      timeVortex.group.rotation.z = time * clockSpeed;
      const pulse = .94 + Math.sin(time * (phase === "hold" ? 9 : 16)) * .075;
      timeVortex.group.scale.setScalar(pulse);
      timeVortex.hourHand.rotation.z = -time * .12;
      timeVortex.minuteHand.rotation.z = time * .8;
      timeVortex.secondHand.rotation.z = -time * 5.2;
      for (const [index, ring] of timeVortex.rings.entries()) {
        ring.material.opacity = (index === 1 ? .88 : index === 3 ? .7 : .52) * (.86 + Math.sin(time * (5 + index * 1.7) + index) * .14);
      }
    } else timeVortex.group.visible = false;
    return false;
  }

  return { start, finish, cancel, update };
}
