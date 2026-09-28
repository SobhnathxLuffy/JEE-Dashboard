// @ts-nocheck
// Mock OpenAI-compatible provider for E2E testing of the AI stack.
// Runs on 127.0.0.1:3030 — /api/ai proxies here when the settings point at it.
// Routes by system-prompt markers: OK ping / extraction / coach / explain.
Bun.serve({
  port: 3030,
  async fetch(req) {
    const url = new URL(req.url);
    if (!url.pathname.endsWith("/chat/completions")) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }
    const body = (await req.json()) as {
      model: string;
      messages: { role: string; content: string }[];
      stream?: boolean;
      stream_options?: { include_usage?: boolean };
    };
    const system = body.messages.find((m) => m.role === "system")?.content ?? "";
    const user = body.messages.find((m) => m.role === "user")?.content ?? "";

    let content: string;
    if (system.includes("Reply with exactly")) {
      content = "OK";
    } else if (system.includes("question-extraction")) {
      // one MCQ per "PART" marker in the chunk so chunking is observable
      const parts = Math.max(1, (user.match(/PAPER PART:/g) ?? []).length);
      const qs = [] as unknown[];
      for (let i = 0; i < parts; i++) {
        qs.push(
          {
            subject: "Physics",
            chapter: "Kinematics",
            type: "MCQ",
            question: `Mock Q${i + 1}: A car starts from rest and reaches 20 m/s in 5 s. Its acceleration is:`,
            options: ["2 m/s²", "4 m/s²", "5 m/s²", "10 m/s²"],
            answer: 1,
            source: "Mock PDF",
          },
          {
            subject: "Mathematics",
            chapter: "Sequences and Series",
            type: "numerical",
            question: `Mock numerical Q${i + 1}: Sum of the first 10 natural numbers is:`,
            answer: 55,
            tolerance: 0,
            source: "Mock PDF",
          }
        );
      }
      content = JSON.stringify({ questions: qs });
    } else if (system.includes("JEE mentor")) {
      content = JSON.stringify({
        summary:
          "Snapshot shows 2 pending to-dos and no calendar events for tomorrow — your week is wide open. Kinematics is at 45% accuracy (12 attempts) and is the biggest lever before touching new chapters.",
        strengths: ["Consistent test logging", "Error tagging discipline at 90%"],
        weakChapters: [
          { subject: "Physics", chapter: "Kinematics", reason: "45% over 12 attempts across 3 tests" },
          { subject: "Mathematics", chapter: "Sequences and Series", reason: "failed in 2 distinct tests" },
        ],
        notStartedFocus: [
          { subject: "Chemistry", chapter: "Chemical Bonding & Molecular Structure", why: "tier 2, high-yield, prerequisite for organic" },
          { subject: "Physics", chapter: "Rotational Motion", why: "tier 1, ~8% of paper weight" },
        ],
        insights: [
          "Negatives: 6 guesses cost you 6 marks in the last 4 tests — skip when 2 options remain.",
          "Revision debt: 2 chapters are past their 1-3-7 due date.",
        ],
        plan: [
          { day: 0, title: "Kinematics error review + 15 PYQs", subject: "Physics", startMin: 540, durationMin: 90, kind: "study" },
          { day: 0, title: "Clear overdue to-dos", subject: "Chemistry", startMin: 1080, durationMin: 45, kind: "study" },
          { day: 1, title: "Rotational Motion lecture + notes", subject: "Physics", startMin: 600, durationMin: 120, kind: "study" },
          { day: 3, title: "Mixed mock test", subject: "Physics", startMin: 570, durationMin: 180, kind: "test" },
          { day: 4, title: "Mock post-mortem + error tags", subject: "Mathematics", startMin: 600, durationMin: 90, kind: "revision" },
        ],
      });
    } else {
      // explain — reference the user's wrong answer to prove context made it in
      content = [
        "Step 1: Use v = u + at with u = 0, v = 20 m/s, t = 5 s.",
        "Step 2: a = 20/5 = 4 m/s².",
        "Why my answer is wrong: Option D (10 m/s²) doubles the acceleration — that would mean 50 m/s after 5 s, which contradicts the question.",
        "Remember: a = (v − u)/t; always check units before matching options.",
      ].join("\n");
    }

    const usage = { prompt_tokens: 120, completion_tokens: Math.round(content.length / 4) };

    if (!body.stream) {
      return new Response(
        JSON.stringify({ choices: [{ message: { content } }], usage }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
    // SSE stream: split content into word chunks, end with usage + [DONE]
    const pieces = content.match(/.{1,24}/gs) ?? [content];
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let i = 0;
        const tick = () => {
          if (i < pieces.length) {
            const chunk = { choices: [{ delta: { content: pieces[i] } }] };
            controller.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            i++;
            setTimeout(tick, 8);
          } else {
            const last = { choices: [{ delta: { content: "" } }], usage };
            controller.enqueue(enc.encode(`data: ${JSON.stringify(last)}\n\n`));
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
            controller.close();
          }
        };
        tick();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    });
  },
});
console.log("mock AI provider on http://127.0.0.1:3030");
