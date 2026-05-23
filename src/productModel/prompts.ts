export const PRODUCT_MODEL_SYSTEM_PROMPT = `You build product_model.json for Showrunner, an automated product demo recorder.

A product model is a tight, structured description of a web app: what it is, who uses it, and the 2–4 most important flows worth demoing. Showrunner later uses this to write a 60–90 second demo script.

Rules:
- product_name: short, exact product name as branded.
- tagline: one sentence, 8–15 words, plain language.
- primary_user: one short phrase describing who the product is for.
- core_flows: 2–4 flows. Each flow has an id (kebab-case), a name, a steps array (3–6 imperative steps from the user's POV), and an optional entry_url.
- key_features: 3–6 short bullets, no marketing fluff.
- demo_recommendation.suggested_flows: ids drawn from core_flows, in the order they should appear in the demo.
- demo_recommendation.suggested_duration_seconds: realistic total runtime including intro and outro. Typical: 60–90.
- confidence: 'high' if the source materials clearly describe the product; 'medium' if you had to infer; 'low' if you mostly guessed.
- source: 'documents' when synthesized from supplied text; 'interactive' when from Q&A answers.
- generated_at: ISO-8601 timestamp.

Output exactly the structured JSON requested. No prose, no commentary.`;

export interface DocSource {
  path: string;
  type: string;
  content: string;
}

export function renderProductModelDocPrompt(sources: DocSource[]): string {
  const blocks = sources
    .map((s) => {
      const trimmed = s.content.length > 12000 ? s.content.slice(0, 12000) + '\n…[truncated]' : s.content;
      return `=== ${s.type.toUpperCase()} ${s.path} ===\n${trimmed}\n=== END ${s.path} ===`;
    })
    .join('\n\n');

  return `You have the following source documents describing a product. Synthesize them into a product_model.json. Set source to 'documents'.\n\n${blocks}`;
}

export interface InteractiveAnswers {
  productName: string;
  primaryUser: string;
  tagline: string;
  topFeatures: string[];
  topFlows: { name: string; steps: string[] }[];
  suggestedDurationSeconds: number;
}

export function renderProductModelInteractivePrompt(a: InteractiveAnswers): string {
  return `An operator answered the following questions about their product. Build a product_model.json from their answers. Set source to 'interactive'. If an answer is sparse, make reasonable inferences but keep confidence honest ('medium' or 'low').

product_name: ${a.productName}
primary_user: ${a.primaryUser}
tagline: ${a.tagline}
top_features:
${a.topFeatures.map((f) => `  - ${f}`).join('\n')}
top_flows:
${a.topFlows
  .map(
    (f, i) => `  ${i + 1}. ${f.name}\n     steps:\n${f.steps.map((s) => `       - ${s}`).join('\n')}`,
  )
  .join('\n')}
suggested_duration_seconds: ${a.suggestedDurationSeconds}`;
}
