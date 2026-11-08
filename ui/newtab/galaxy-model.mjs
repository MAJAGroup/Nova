// Procedural, local geometry: no downloaded star catalogues or reference-site assets.
export const GALAXY_STRIDE = 7;
export function createGalaxyParticles(count = 180000, seed = 54137) {
  const data = new Float32Array(count * GALAXY_STRIDE);
  let state = seed >>> 0 || 1;
  function random() {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  }
  function normal() { return Math.sqrt(-2 * Math.log(Math.max(1e-7, random()))) * Math.cos(random() * Math.PI * 2); }
  const knots = Array.from({ length: 92 }, (_, index) => {
    const radius = .14 + random() * .85;
    const angle = Math.log(radius + .08) * 4.8 + (index % 4) * Math.PI / 2;
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, seed: random() };
  });
  for (let i = 0; i < count; i++) {
    const kind = random();
    let radius, angle, height, light, population = 0, phase = random();
    if (kind < .42) {
      radius = .09 + Math.pow(random(), .68) * 1.04;
      const arm = random() < .7 ? (random() < .5 ? 0 : 2) : (random() < .5 ? 1 : 3);
      angle = Math.log(radius + .08) * 4.8 + arm * Math.PI / 2 + normal() * (.07 + radius * .11);
      height = normal() * (.006 + radius * .009);
      light = .21 + random() * .46;
    } else if (kind < .69) {
      radius = Math.min(1.28, -Math.log(Math.max(1e-7, random() * random())) * .16);
      angle = random() * Math.PI * 2; height = normal() * (.012 + radius * .008); light = .12 + random() * .17;
    } else if (kind < .86) {
      const x = normal() * .105, z = normal() * .077;
      radius = Math.hypot(x, z); angle = Math.atan2(z, x); height = normal() * .049;
      light = .16 + random() * .22; population = 1;
    } else if (kind < .94) {
      const along = normal() * .19, across = normal() * .03;
      const x = along * .92 - across * .39, z = along * .39 + across * .92;
      radius = Math.hypot(x, z); angle = Math.atan2(z, x); height = normal() * .025;
      light = .15 + random() * .16; population = 1;
    } else if (kind < .98) {
      radius = .2 + random() * 1.25; angle = random() * Math.PI * 2; height = normal() * .16;
      light = .025 + random() * .04; population = 2;
    } else {
      const knot = knots[Math.floor(random() * knots.length)];
      const x = knot.x + normal() * .006, z = knot.z + normal() * .006;
      radius = Math.hypot(x, z); angle = Math.atan2(z, x); height = normal() * .008;
      light = .28 + random() * .5; phase = knot.seed; population = 3;
    }
    data.set([radius, angle, height, light, .7 + random() * 1.1, phase, population], i * GALAXY_STRIDE);
  }
  return data;
}
