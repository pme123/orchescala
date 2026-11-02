// The cases of an ADT and the fields they share — one judgment for every way a
// type comes in: the BPMN import, the catalog import of a service collection, an
// In or Out from the catalog, the button in the class builder.
//
// Shared are the fields the domain declares as `def` in the enum body and those
// that appear in all cases with the same name and the same type.
import type { Field } from './types.ts';

/**
 * Fields that are the same in all cases: same name, same type and
 * the same wrappers (optional, multiple, map, variant, constraint).
 * Description and default come from the first case that has them. With a
 * single case there is nothing shared to recognize.
 */
export function sharedFields(cases: Field[][]): Field[] {
  if (cases.length < 2) return [];
  const key = (f: Field) => JSON.stringify([f.type, !!f.optional, !!f.collection, !!f.map, f.enumCase ?? '', f.constraint ?? '']);
  return cases[0].flatMap(f => {
    const k = key(f);
    const twins = cases.map(c => c.find(x => x.name === f.name && key(x) === k));
    if (twins.some(x => !x)) return [];
    const described = twins.find(x => x!.description);
    const dflt = twins.map(x => x!.default).find(Boolean);
    return [{
      ...f,
      ...(described ? { description: described.description, descriptionExpr: described.descriptionExpr } : {}),
      ...(dflt ? { default: dflt } : {}),
    }];
  });
}

/**
 * The fields of an ADT split: the `def` fields of the domain (`common`) and those all
 * cases have alike go to the type, each case keeps only its own. `shared` are those
 * recognized beyond the `def` ones.
 */
export function shareCaseFields<C extends { fields: Field[] }>(common: Field[], cases: C[]): { fields: Field[]; shared: Field[]; cases: C[] } {
  const commonNames = new Set(common.map(f => f.name));
  const own = cases.map(c => ({ ...c, fields: c.fields.filter(f => !commonNames.has(f.name)) }));
  const shared = sharedFields(own.filter(c => c.fields.length).map(c => c.fields));
  const names = new Set(shared.map(f => f.name));
  return { fields: [...common, ...shared], shared, cases: own.map(c => ({ ...c, fields: c.fields.filter(f => !names.has(f.name)) })) };
}
