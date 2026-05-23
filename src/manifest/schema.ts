import { z } from 'zod';

const atField = {
  at: z.number().nonnegative().optional(),
  at_word: z.string().min(1).optional(),
  at_occurrence: z.number().int().positive().optional(),
};

const selectorField = z.union([z.string().min(1), z.array(z.string().min(1)).nonempty()]);
export type SelectorSpec = z.infer<typeof selectorField>;

const idleAction = z.object({ type: z.literal('idle'), ...atField });
const clickAction = z.object({ type: z.literal('click'), selector: selectorField, ...atField });
const fillAction = z.object({
  type: z.literal('fill'),
  selector: selectorField,
  value: z.string(),
  ...atField,
});
const typeAction = z.object({
  type: z.literal('type'),
  selector: selectorField,
  value: z.string(),
  ...atField,
});
const hoverAction = z.object({ type: z.literal('hover'), selector: selectorField, ...atField });
const scrollAction = z.object({
  type: z.literal('scroll'),
  selector: selectorField,
  direction: z.enum(['up', 'down']),
  ...atField,
});
const navigateAction = z.object({ type: z.literal('navigate'), url: z.string(), ...atField });
const waitForAction = z.object({ type: z.literal('wait_for'), selector: selectorField, ...atField });
const waitForUrlAction = z.object({
  type: z.literal('wait_for_url'),
  pattern: z.string(),
  ...atField,
});
const waitAction = z.object({
  type: z.literal('wait'),
  ms: z.number().int().nonnegative(),
  ...atField,
});
const assertVisibleAction = z.object({
  type: z.literal('assert_visible'),
  selector: selectorField,
  ...atField,
});
const pressAction = z.object({
  type: z.literal('press'),
  key: z.string(),
  selector: selectorField.optional(),
  ...atField,
});
const customAction = z.object({ type: z.literal('custom'), js: z.string(), ...atField });

export const actionSchema = z.discriminatedUnion('type', [
  idleAction,
  clickAction,
  fillAction,
  typeAction,
  hoverAction,
  scrollAction,
  navigateAction,
  waitForAction,
  waitForUrlAction,
  waitAction,
  assertVisibleAction,
  pressAction,
  customAction,
]);

const transitionSchema = z
  .enum(['cut', 'fade', 'fade_in', 'fade_out', 'dissolve'])
  .default('cut');

export const segmentSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    start: z.number().nonnegative(),
    end: z.number().positive(),
    vo_line: z.string(),
    actions: z.array(actionSchema).default([{ type: 'idle' }]),
    transition: transitionSchema,
  })
  .refine((s) => s.end > s.start, {
    message: 'segment.end must be greater than segment.start',
    path: ['end'],
  });

export const manifestSchema = z
  .object({
    total_duration_seconds: z.number().positive(),
    generated_from: z.string().default('product_model.json'),
    segments: z.array(segmentSchema).min(1),
  })
  .superRefine((m, ctx) => {
    for (let i = 1; i < m.segments.length; i++) {
      const prev = m.segments[i - 1]!;
      const cur = m.segments[i]!;
      if (cur.start < prev.end - 1e-6) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['segments', i, 'start'],
          message: `segment "${cur.id}" starts before previous segment "${prev.id}" ends`,
        });
      }
    }
    const lastEnd = m.segments[m.segments.length - 1]!.end;
    if (Math.abs(lastEnd - m.total_duration_seconds) > 0.5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['total_duration_seconds'],
        message: `total_duration_seconds (${m.total_duration_seconds}) does not match last segment end (${lastEnd})`,
      });
    }
  });

export type Manifest = z.infer<typeof manifestSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type Action = z.infer<typeof actionSchema>;
export type Transition = z.infer<typeof transitionSchema>;

export const ACTION_TYPES = [
  'idle',
  'click',
  'fill',
  'type',
  'hover',
  'scroll',
  'navigate',
  'wait_for',
  'wait_for_url',
  'wait',
  'assert_visible',
  'press',
  'custom',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
