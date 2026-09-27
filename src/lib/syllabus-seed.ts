// ─── JEE Main 2026 syllabus seed ─────────────────────────────────────────────
// Tier badges per the rescue plan:
//   Tier 1 = ~30% of the paper, highest yield (spec filter #5)
//   Tier 2 = solid yield   Tier 3 = low yield / long tail
// Deleted chapters (Mathematical Reasoning, Communication Systems, Solid State,
// plus the other chapters removed from the 2024+ syllabus) are EXCLUDED entirely.

import type { Subject, SyllabusRow } from "./types";
import { uid } from "./types";

type ChapterSeed = [name: string, tier: 1 | 2 | 3];

const PHYSICS: ChapterSeed[] = [
  ["Units, Dimensions & Measurement", 3],
  ["Kinematics", 2],
  ["Laws of Motion", 1],
  ["Work, Energy & Power", 2],
  ["Rotational Motion", 1],
  ["Gravitation", 2],
  ["Mechanical Properties of Solids & Fluids", 3],
  ["Thermal Properties of Matter", 3],
  ["Thermodynamics", 2],
  ["Kinetic Theory of Gases", 2],
  ["Oscillations (SHM)", 2],
  ["Waves & Sound", 3],
  ["Electrostatics", 1],
  ["Capacitance", 2],
  ["Current Electricity", 1],
  ["Magnetic Effects of Current & Magnetism", 1],
  ["Electromagnetic Induction & AC", 1],
  ["Electromagnetic Waves", 3],
  ["Ray Optics", 2],
  ["Wave Optics", 2],
  ["Dual Nature of Matter & Radiation", 1],
  ["Atoms & Nuclei", 1],
  ["Semiconductors & Electronic Devices", 2],
  ["Experimental Skills", 3],
];

const CHEMISTRY: ChapterSeed[] = [
  ["Some Basic Concepts of Chemistry (Mole Concept)", 2],
  ["Atomic Structure", 2],
  ["Chemical Bonding & Molecular Structure", 2],
  ["Chemical Thermodynamics", 2],
  ["Solutions", 2],
  ["Equilibrium (Chemical + Ionic)", 1],
  ["Redox Reactions & Electrochemistry", 2],
  ["Chemical Kinetics", 2],
  ["Classification of Elements & Periodicity", 2],
  ["p-Block Elements", 1],
  ["d & f Block Elements", 2],
  ["Coordination Compounds", 1],
  ["Purification & Characterisation of Organic Compounds", 3],
  ["General Principles of Organic Chemistry (GOC)", 1],
  ["Hydrocarbons", 2],
  ["Haloalkanes & Haloarenes", 2],
  ["Alcohols, Phenols & Ethers", 2],
  ["Aldehydes, Ketones & Carboxylic Acids", 1],
  ["Amines (Nitrogen-containing Compounds)", 2],
  ["Biomolecules", 3],
];

const MATHEMATICS: ChapterSeed[] = [
  ["Sets, Relations & Functions", 2],
  ["Complex Numbers & Quadratic Equations", 2],
  ["Sequences & Series", 2],
  ["Permutations & Combinations", 2],
  ["Binomial Theorem", 2],
  ["Trigonometry (Ratios, Equations, Identities)", 2],
  ["Inverse Trigonometric Functions", 3],
  ["Height & Distance", 3],
  ["Limits, Continuity & Differentiability", 1],
  ["Application of Derivatives (AOD)", 1],
  ["Indefinite Integration", 1],
  ["Definite Integration & Area", 1],
  ["Differential Equations", 2],
  ["Straight Lines", 2],
  ["Circles", 2],
  ["Conic Sections (Parabola / Ellipse / Hyperbola)", 2],
  ["Three Dimensional Geometry (3D)", 1],
  ["Vector Algebra", 2],
  ["Matrices & Determinants", 1],
  ["Probability", 2],
  ["Statistics", 3],
];

// Explicitly deleted from the current syllabus → never seeded, never tracked:
//   Mathematical Reasoning, Mathematical Induction (Math)
//   Communication Systems (Physics)
//   Solid State, States of Matter, Surface Chemistry, Hydrogen,
//   General Principles & Processes of Isolation of Metals (Metallurgy),
//   Environmental Chemistry, Polymers, Chemistry in Everyday Life (Chemistry)

const MAP: [Subject, ChapterSeed[]][] = [
  ["Physics", PHYSICS],
  ["Chemistry", CHEMISTRY],
  ["Mathematics", MATHEMATICS],
];

export function buildSyllabusSeed(): SyllabusRow[] {
  const rows: SyllabusRow[] = [];
  for (const [subject, chapters] of MAP) {
    for (const [chapter, tier] of chapters) {
      rows.push({
        id: `${subject}:${chapter}`,
        chapter,
        subject,
        tier,
        status: "Not Started",
        notes: "",
        last_revised: null,
        revision_stage: 0,
        next_revision: null,
      });
    }
  }
  return rows;
}

export const SYLLABUS_SEED = buildSyllabusSeed();

export function makeSyllabusRow(subject: Subject, chapter: string): SyllabusRow {
  return {
    id: `${subject}:${chapter}`,
    chapter,
    subject,
    tier: 2,
    status: "Not Started",
    notes: "",
    last_revised: null,
    revision_stage: 0,
    next_revision: null,
  };
}

export { uid };
