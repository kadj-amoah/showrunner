import { z } from 'zod';

const coreFlowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  steps: z.array(z.string()).default([]),
  entry_url: z.string().optional(),
});

const demoRecommendationSchema = z.object({
  suggested_flows: z.array(z.string()).default([]),
  suggested_duration_seconds: z.number().int().positive().default(90),
});

export const productModelSchema = z.object({
  product_name: z.string().min(1),
  tagline: z.string().default(''),
  primary_user: z.string().default(''),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  source: z.enum(['documents', 'interactive']).default('documents'),
  generated_at: z.string().default(() => new Date().toISOString()),
  core_flows: z.array(coreFlowSchema).default([]),
  key_features: z.array(z.string()).default([]),
  demo_recommendation: demoRecommendationSchema.default({
    suggested_flows: [],
    suggested_duration_seconds: 90,
  }),
});

export type ProductModel = z.infer<typeof productModelSchema>;
export type CoreFlow = z.infer<typeof coreFlowSchema>;
