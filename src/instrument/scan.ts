import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import type {
  JSXAttribute,
  JSXOpeningElement,
  JSXIdentifier,
} from '@babel/types';

// @babel/traverse ships CJS default in an ESM-incompatible way; unwrap it.
const traverse = (_traverse as unknown as { default: typeof _traverse }).default ?? _traverse;

const TARGET_TAGS = new Set([
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'form',
  'Button',
  'Link',
  'Input',
  'TextField',
  'Form',
]);

export interface InstrumentCandidate {
  file: string;
  line: number;
  column: number;
  tag: string;
  snippet: string;
  hasRole: boolean;
  hasTestId: boolean;
  hasAriaLabel: boolean;
}

export async function scanFile(filePath: string): Promise<InstrumentCandidate[]> {
  const source = await readFile(filePath, 'utf8');
  let ast;
  try {
    ast = parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });
  } catch {
    return [];
  }

  const lines = source.split(/\r?\n/);
  const candidates: InstrumentCandidate[] = [];

  traverse(ast, {
    JSXOpeningElement(path: NodePath<JSXOpeningElement>) {
      const tag = jsxTagName(path.node);
      if (!tag) return;
      const hasRole = pickAttr(path.node, 'role') !== null;
      const hasTestId =
        pickAttr(path.node, 'data-testid') !== null || pickAttr(path.node, 'data-test-id') !== null;
      const hasAriaLabel = pickAttr(path.node, 'aria-label') !== null;

      const isTargetTag = TARGET_TAGS.has(tag);
      const isTargetByRole = hasRole;
      if (!isTargetTag && !isTargetByRole) return;

      if (hasTestId || hasAriaLabel) return; // already labeled

      const loc = path.node.loc;
      if (!loc) return;
      const lineIdx = loc.start.line - 1;
      const snippet = lines[lineIdx] ?? '';

      candidates.push({
        file: filePath,
        line: loc.start.line,
        column: loc.start.column,
        tag,
        snippet,
        hasRole,
        hasTestId,
        hasAriaLabel,
      });
    },
  });

  return candidates;
}

function jsxTagName(node: JSXOpeningElement): string | null {
  const name = node.name;
  if (name.type === 'JSXIdentifier') {
    return (name as JSXIdentifier).name;
  }
  return null;
}

function pickAttr(node: JSXOpeningElement, attr: string): JSXAttribute | null {
  for (const a of node.attributes) {
    if (a.type !== 'JSXAttribute') continue;
    if (a.name.type !== 'JSXIdentifier') continue;
    if (a.name.name === attr) return a;
  }
  return null;
}
