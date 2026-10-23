import { describe, expect, it } from 'vitest';
import { a32AliasesFromIncluded } from './fieldData.js';
import type { JsonApiResource } from './types.js';

function datum(
  definitionId: string,
  owner: { key: 'customizable' | 'person'; id: string } | null,
  value: unknown,
  type = 'FieldDatum',
): JsonApiResource {
  return {
    id: `datum-${definitionId}-${owner?.id ?? 'none'}`,
    type,
    attributes: { value },
    relationships: {
      field_definition: { data: { type: 'FieldDefinition', id: definitionId } },
      ...(owner ? { [owner.key]: { data: { type: 'Person', id: owner.id } } } : {}),
    },
  };
}

describe('a32AliasesFromIncluded', () => {
  it('reads the owner from customizable, or from person on older shapes', () => {
    const aliases = a32AliasesFromIncluded(
      [
        datum('7', { key: 'customizable', id: 'p1' }, 'uuid-1'),
        datum('7', { key: 'person', id: 'p2' }, 'uuid-2'),
      ],
      '7',
    );

    expect(aliases).toEqual({ p1: 'uuid-1', p2: 'uuid-2' });
  });

  it('trims values and skips blanks, non-strings, other fields and other types', () => {
    const aliases = a32AliasesFromIncluded(
      [
        datum('7', { key: 'customizable', id: 'p1' }, '  uuid-1  '),
        datum('7', { key: 'customizable', id: 'p2' }, '   '),
        datum('7', { key: 'customizable', id: 'p3' }, 42),
        datum('8', { key: 'customizable', id: 'p4' }, 'other-field'),
        datum('7', { key: 'customizable', id: 'p5' }, 'not-a-datum', 'Email'),
        datum('7', null, 'ownerless'),
      ],
      '7',
    );

    expect(aliases).toEqual({ p1: 'uuid-1' });
  });
});
