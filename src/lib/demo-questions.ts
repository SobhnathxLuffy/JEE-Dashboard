// ─── 12 demo questions so the CBT can be tried instantly ────────────────────
import type { Question } from "./types";
import { uid } from "./types";

export function buildDemoQuestions(): Question[] {
  const mk = (
    subject: Question["subject"],
    chapter: string,
    type: Question["type"],
    question: string,
    options: string[],
    answer: number | string
  ): Question => ({
    id: uid(),
    question,
    options,
    answer,
    tolerance: 0,
    type,
    subject,
    chapter,
    source: "demo",
    created_at: Date.now(),
  });

  return [
    // Physics ×4
    mk("Physics", "Kinematics", "MCQ",
      "A car starts from rest and reaches 20 m/s in 5 s with uniform acceleration. Its acceleration is:",
      ["2 m/s²", "4 m/s²", "5 m/s²", "10 m/s²"], 1),
    mk("Physics", "Units, Dimensions & Measurement", "MCQ",
      "The dimensional formula of force is:",
      ["M L T^-1", "M L T^-2", "M L^2 T^-2", "M L^-1 T^-2"], 1),
    mk("Physics", "Laws of Motion", "numerical",
      "A net force of 10 N acts on a 5 kg block (frictionless). Its acceleration in m/s² is:",
      [], 2),
    mk("Physics", "Work, Energy & Power", "MCQ",
      "The SI unit of power is:",
      ["Joule", "Newton", "Watt", "Pascal"], 2),
    // Chemistry ×4
    mk("Chemistry", "Some Basic Concepts of Chemistry (Mole Concept)", "MCQ",
      "The number of moles in 44 g of CO₂ is:",
      ["0.5", "1", "2", "44"], 1),
    mk("Chemistry", "Classification of Elements & Periodicity", "MCQ",
      "Which of the following is a noble gas?",
      ["N₂", "O₂", "Ar", "H₂"], 2),
    mk("Chemistry", "Some Basic Concepts of Chemistry (Mole Concept)", "numerical",
      "The mass of 0.5 mol of water (H₂O) in grams is:",
      [], 9),
    mk("Chemistry", "Equilibrium (Chemical + Ionic)", "MCQ",
      "The pH of a neutral aqueous solution at 25 °C is:",
      ["0", "7", "14", "1"], 1),
    // Mathematics ×4
    mk("Mathematics", "Limits, Continuity & Differentiability", "MCQ",
      "The derivative of x² with respect to x is:",
      ["x", "2x", "x²/2", "2"], 1),
    mk("Mathematics", "Trigonometry (Ratios, Equations, Identities)", "MCQ",
      "The value of sin 30° is:",
      ["1/2", "√3/2", "1", "0"], 0),
    mk("Mathematics", "Definite Integration & Area", "numerical",
      "Evaluate the definite integral of 2x dx from 0 to 1:",
      [], 1),
    mk("Mathematics", "Matrices & Determinants", "MCQ",
      "If A is a 3×3 matrix with det(A) = 2, then det(2A) equals:",
      ["4", "8", "16", "32"], 2),
  ];
}
