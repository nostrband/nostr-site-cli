import { Filter } from "..";

const MAX_FILTER_PERMS = 100;

export function getStandardFilterFields() {
  const names = ["ids", "authors", "kinds"];
  const tags = "abcdefghijklmnopqrstuvwxyzABCDEFJHIJKLMNOPQRST".split("");
  for (const t of tags) names.push(`#${t}`);
  return names;
}

export function isStandardFilter(filter: Filter, validKeys: string[]) {
  const keys = Object.keys(filter);
  return !keys.find((k) => !validKeys.includes(k));
}

export function normalizeFilter(input: Filter) {
  const output = { ...input };

  // sort+dedup of known fields
  const names = getStandardFilterFields();
  for (const name of names) {
    // @ts-ignore
    if (output[name]) output[name] = [...new Set(output[name])];
  }

  return output;
}

export function calcPermCount(filter: Filter, validKeys: string[]) {
  let c = 1;
  for (const k of validKeys) {
    // @ts-ignore
    if (k in filter) c *= filter[k].length;
  }
  return c;
}

export function isReplaceableKind(k: number) {
  return k === 0 || k === 3 || (k >= 10000 && k < 20000);
}

export function isAddressableKind(k: number) {
  return k >= 30000 && k < 40000;
}

export function isReplaceableFilter(filter: Filter) {
  if (!filter.authors?.length || !filter.kinds?.length) return false;
  return !filter.kinds.find((k) => !isReplaceableKind(k));
}

export function isAddressableFilter(filter: Filter) {
  if (!filter.authors?.length || !filter.kinds?.length || !filter["#d"]?.length)
    return false;
  return !filter.kinds.find((k) => !isAddressableKind(k));
}

export function addFilterToGroup(group: Filter, filter: Filter, validKeys: string[]) {
  let result: Filter | undefined;

  const merge = (fields: ("ids" | "kinds" | "authors" | "#d")[]) => {
    // merge and clear other fields
    // NOTE: we will fetch the target events, put them to cache
    // and then each active query will check it for
    // the match against all other filter fields
    const newFilter: Filter = {};
    for (const k of fields) {
      // a funny way to make typescript happy
      if (k === "kinds")
        newFilter[k] = [...new Set([...group[k]!, ...filter[k]!])];
      else newFilter[k] = [...new Set([...group[k]!, ...filter[k]!])];
    }

    // make sure limit matches the number of permutations
    newFilter.limit = calcPermCount(newFilter, validKeys);

    // check limit
    if (newFilter.limit <= MAX_FILTER_PERMS) return newFilter;

    // stop grouping!
    return undefined;
  };

  // both are ids filters?
  if (group.ids?.length && filter.ids?.length) {
    result = merge(["ids"]);
  } else if (isReplaceableFilter(group) && isReplaceableFilter(filter)) {
    result = merge(["kinds", "authors"]);
  } else if (isAddressableFilter(group) && isAddressableFilter(filter)) {
    result = merge(["kinds", "authors", "#d"]);
  }

  // all other filter types aren't practically groupable
  // bcs one of the grouped filters could head-of-line-block
  // all the others and that's very unpredictable.
  // besides, ids/addr grouping is basically
  // the only real reason we're doing the grouping, so
  // we're keeping it simple here

  return result;
}
