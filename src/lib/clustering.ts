/**
 * K-means clustering for hospital resistance profiles.
 * Each hospital is represented as a vector of mean resistance rates per antibiotic.
 */

export interface HospitalVector {
  hospitalId: string;
  hospitalName: string;
  features: number[];  // one value per antibiotic (resistance %)
  antibiotics: string[];
}

export interface ClusterResult {
  clusterId: number;
  hospitalId: string;
  hospitalName: string;
  distanceToCentroid: number;
}

function euclidean(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
}

function centroid(points: number[][]): number[] {
  if (points.length === 0) return [];
  const dim = points[0].length;
  return Array.from({ length: dim }, (_, d) =>
    points.reduce((s, p) => s + p[d], 0) / points.length,
  );
}

export function kMeans(
  vectors: HospitalVector[],
  k: number,
  maxIter = 100,
): ClusterResult[] {
  if (vectors.length === 0 || k <= 0) return [];
  const kActual = Math.min(k, vectors.length);
  const features = vectors.map((v) => v.features);

  // k-means++ initialisation
  const centroids: number[][] = [features[Math.floor(Math.random() * features.length)]];
  while (centroids.length < kActual) {
    const dists = features.map((f) => Math.min(...centroids.map((c) => euclidean(f, c) ** 2)));
    const total = dists.reduce((s, d) => s + d, 0);
    let r = Math.random() * total;
    for (let i = 0; i < features.length; i++) {
      r -= dists[i];
      if (r <= 0) { centroids.push(features[i]); break; }
    }
    if (centroids.length < kActual) centroids.push(features[features.length - 1]);
  }

  let assignments = new Array<number>(vectors.length).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const newAssignments = features.map((f) => {
      let best = 0;
      let bestDist = Infinity;
      centroids.forEach((c, ci) => {
        const d = euclidean(f, c);
        if (d < bestDist) { bestDist = d; best = ci; }
      });
      return best;
    });
    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;
    if (!changed) break;
    // Recompute centroids
    for (let ci = 0; ci < kActual; ci++) {
      const members = features.filter((_, i) => assignments[i] === ci);
      if (members.length > 0) centroids[ci] = centroid(members);
    }
  }

  return vectors.map((v, i) => ({
    clusterId: assignments[i],
    hospitalId: v.hospitalId,
    hospitalName: v.hospitalName,
    distanceToCentroid: euclidean(v.features, centroids[assignments[i]]),
  }));
}

/** Build hospital feature vectors from flat antibiogram rows. */
export function buildHospitalVectors(
  rows: { hospital_id: string; antibiotic: string; susceptible_count: number; total_tested: number }[],
  hospitalNames: Record<string, string>,
): HospitalVector[] {
  const abSet = new Set<string>();
  rows.forEach((r) => abSet.add(r.antibiotic));
  const antibiotics = [...abSet].sort();

  const map = new Map<string, Record<string, { s: number; n: number }>>();
  rows.forEach((r) => {
    if (!map.has(r.hospital_id)) map.set(r.hospital_id, {});
    const hMap = map.get(r.hospital_id)!;
    if (!hMap[r.antibiotic]) hMap[r.antibiotic] = { s: 0, n: 0 };
    hMap[r.antibiotic].s += r.susceptible_count;
    hMap[r.antibiotic].n += r.total_tested;
  });

  return [...map.entries()].map(([hospitalId, abMap]) => ({
    hospitalId,
    hospitalName: hospitalNames[hospitalId] || hospitalId,
    antibiotics,
    features: antibiotics.map((ab) => {
      const d = abMap[ab];
      return d && d.n > 0 ? 100 - (d.s / d.n) * 100 : 50; // default 50% if missing
    }),
  }));
}
