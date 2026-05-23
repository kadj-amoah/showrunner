import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { productModelSchema, type ProductModel } from './schema.js';

export class ProductModelError extends Error {
  override readonly name = 'ProductModelError';
  constructor(
    message: string,
    readonly issues?: z.ZodIssue[],
  ) {
    super(message);
  }
}

export async function readProductModel(path: string): Promise<ProductModel> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new ProductModelError(`Failed to read product model at ${path}: ${cause}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new ProductModelError(`Invalid JSON in ${path}: ${cause}`);
  }
  const result = productModelSchema.safeParse(parsed);
  if (!result.success) {
    const lines = result.error.issues.map((i) => {
      const p = i.path.length > 0 ? i.path.join('.') : '<root>';
      return `  ${p}: ${i.message}`;
    });
    throw new ProductModelError(
      `Product model failed validation:\n${lines.join('\n')}`,
      result.error.issues,
    );
  }
  return result.data;
}
